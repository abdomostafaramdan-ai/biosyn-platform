-- Admin control of active subscriptions: list, extend, pause, resume, cancel.
-- Every access check on the platform compares dates (now() between starts_at and ends_at), so:
--   pause  = freeze what is left (pause_remaining / pause_offset) and close the rows at now()  -> no access while paused
--   resume = reopen the rows from now() with exactly the time that was left
--   cancel = close the rows at now() (status 'cancelled'; payments are not touched — refunds stay in Payments)
-- Every action is logged in subscription_events and the student gets an in-app notification.

alter table public.subscriptions
  add column if not exists status text not null default 'active',
  add column if not exists paused_at timestamptz,
  add column if not exists pause_offset interval,
  add column if not exists pause_remaining interval,
  add column if not exists cancelled_at timestamptz;
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check') then
    alter table public.subscriptions add constraint subscriptions_status_check check (status in ('active', 'paused', 'cancelled'));
  end if;
end $do$;

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('extend', 'pause', 'resume', 'cancel')),
  days int,
  note text,
  by_user uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscription_events_user_idx on public.subscription_events (user_id, created_at desc);
alter table public.subscription_events enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'subscription_events' and policyname = 'sub_events_admin_read') then
    create policy sub_events_admin_read on public.subscription_events for select to authenticated using (is_admin());
  end if;
end $do$;
revoke insert, update, delete, truncate on public.subscription_events from anon, authenticated;

-- one row per student who has time left now or a paused subscription
create or replace function public.admin_active_subscriptions()
returns table (user_id uuid, email text, full_name text, phone text, whatsapp text, plan_name text, source text,
               status text, starts_at timestamptz, ends_at timestamptz, paused_at timestamptz, days_left numeric,
               paid_egp numeric, last_event text, last_event_at timestamptz)
language sql stable security definer set search_path = public
as $function$
  with cur as (
    select s.user_id,
           bool_or(s.status = 'paused') as paused,
           min(s.starts_at) filter (where s.status = 'active') as starts_at,
           max(s.ends_at) filter (where s.status = 'active') as ends_at,
           max(s.paused_at) as paused_at,
           sum(coalesce(s.pause_remaining, interval '0')) filter (where s.status = 'paused') as frozen
      from subscriptions s
     where (s.status = 'active' and s.ends_at > now()) or s.status = 'paused'
     group by s.user_id)
  select c.user_id, u.email::text, p.full_name, p.phone, p.whatsapp,
         (select pl.name from subscriptions s join plans pl on pl.id = s.plan_id
           where s.user_id = c.user_id and s.status in ('active', 'paused') order by s.ends_at desc, s.created_at desc limit 1),
         (select s.source from subscriptions s where s.user_id = c.user_id and s.status in ('active', 'paused') order by s.ends_at desc limit 1),
         case when c.paused then 'paused' else 'active' end,
         c.starts_at, c.ends_at, c.paused_at,
         round(extract(epoch from case when c.paused then c.frozen else c.ends_at - now() end) / 86400, 1),
         coalesce((select sum(py.amount_egp) from payments py where py.user_id = c.user_id and py.status::text = 'paid'), 0),
         (select e.action from subscription_events e where e.user_id = c.user_id order by e.created_at desc limit 1),
         (select e.created_at from subscription_events e where e.user_id = c.user_id order by e.created_at desc limit 1)
    from cur c join profiles p on p.id = c.user_id join auth.users u on u.id = c.user_id
   where is_admin()
   order by case when c.paused then 1 else 0 end, c.ends_at;
$function$;

create or replace function public.admin_sub_extend(p_user uuid, p_days int, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid; v_paused boolean;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'days must be 1-3650'; end if;
  select id, status = 'paused' into v_id, v_paused from subscriptions
   where user_id = p_user and ((status = 'active' and ends_at > now()) or status = 'paused')
   order by (status = 'paused') desc, ends_at desc limit 1 for update;
  if v_id is null then raise exception 'no active subscription'; end if;
  if v_paused then
    update subscriptions set pause_remaining = coalesce(pause_remaining, interval '0') + make_interval(days => p_days) where id = v_id;
  else
    update subscriptions set ends_at = ends_at + make_interval(days => p_days) where id = v_id;
  end if;
  insert into subscription_events (user_id, action, days, note, by_user) values (p_user, 'extend', p_days, nullif(btrim(p_note), ''), auth.uid());
  perform notify_user(p_user, 'n:subext:' || gen_random_uuid(), 'success', 'تم تمديد اشتراكك 🎉',
    'أضفنا ' || p_days || ' يوم إلى اشتراكك في Biosyn.', 'account.html#billing');
end $function$;

create or replace function public.admin_sub_pause(p_user uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
declare n int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update subscriptions
     set pause_remaining = ends_at - greatest(starts_at, now()),
         pause_offset = greatest(starts_at - now(), interval '0'),
         starts_at = least(starts_at, now() - interval '1 second'),
         ends_at = now() - interval '1 second', status = 'paused', paused_at = now()
   where user_id = p_user and status = 'active' and ends_at > now();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no active subscription'; end if;
  insert into subscription_events (user_id, action, note, by_user) values (p_user, 'pause', nullif(btrim(p_note), ''), auth.uid());
  perform notify_user(p_user, 'n:subpause:' || gen_random_uuid(), 'info', 'تم إيقاف اشتراكك مؤقتًا',
    'المدة المتبقية من اشتراكك محفوظة بالكامل، وستعود لك كما هي عند الاستئناف.', 'account.html#billing');
end $function$;

create or replace function public.admin_sub_resume(p_user uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
declare n int; v_days numeric;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select round(extract(epoch from sum(pause_remaining)) / 86400, 1) into v_days from subscriptions where user_id = p_user and status = 'paused';
  update subscriptions
     set starts_at = case when coalesce(pause_offset, interval '0') > interval '0' then now() + pause_offset else starts_at end,
         ends_at = now() + coalesce(pause_offset, interval '0') + coalesce(pause_remaining, interval '0'),
         status = 'active', paused_at = null, pause_offset = null, pause_remaining = null
   where user_id = p_user and status = 'paused';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not paused'; end if;
  insert into subscription_events (user_id, action, note, by_user) values (p_user, 'resume', nullif(btrim(p_note), ''), auth.uid());
  perform notify_user(p_user, 'n:subresume:' || gen_random_uuid(), 'success', 'تم استئناف اشتراكك',
    'عاد اشتراكك للعمل، والمتبقي ' || coalesce(v_days, 0) || ' يوم.', 'courses.html');
end $function$;

create or replace function public.admin_sub_cancel(p_user uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
declare n int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update subscriptions
     set status = 'cancelled', cancelled_at = now(),
         starts_at = least(starts_at, now() - interval '1 second'), ends_at = least(ends_at, now() - interval '1 second'),
         paused_at = null, pause_offset = null, pause_remaining = null
   where user_id = p_user and ((status = 'active' and ends_at > now()) or status = 'paused');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no active subscription'; end if;
  insert into subscription_events (user_id, action, note, by_user) values (p_user, 'cancel', nullif(btrim(p_note), ''), auth.uid());
  perform notify_user(p_user, 'n:subcancel:' || gen_random_uuid(), 'warning', 'تم إلغاء اشتراكك',
    'تم إلغاء اشتراكك في Biosyn. تقدّمك وشهاداتك محفوظة، ويمكنك الاشتراك من جديد في أي وقت.', 'pricing.html');
end $function$;

revoke all on function public.admin_active_subscriptions(), public.admin_sub_extend(uuid, int, text), public.admin_sub_pause(uuid, text),
  public.admin_sub_resume(uuid, text), public.admin_sub_cancel(uuid, text) from public, anon;
grant execute on function public.admin_active_subscriptions(), public.admin_sub_extend(uuid, int, text), public.admin_sub_pause(uuid, text),
  public.admin_sub_resume(uuid, text), public.admin_sub_cancel(uuid, text) to authenticated;

-- expiry reminder e-mails skip paused and cancelled subscriptions
do $do$
declare d text := pg_get_functiondef('public.enqueue_expiry_reminders'::regproc);
begin
  if position('s.status = ''active''' in d) = 0 then
    d := replace(d, 'where s.ends_at > now() - interval ''8 days'' and', 'where s.status = ''active'' and s.ends_at > now() - interval ''8 days'' and');
    execute d;
  end if;
end $do$;
