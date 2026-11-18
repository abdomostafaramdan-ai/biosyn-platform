-- Capture alerts on the watch page: the player reports screenshot / screen-recording shortcuts and open developer tools.
-- Each report is stored, the admins get an in-app notification, and a student who reaches the configured number of
-- capture attempts is banned automatically: no video or file access, subscriptions cancelled, sign-in blocked.
-- Staff and instructors are never auto-banned. Settings live in app_settings 'security' (admin only), defaults below.
-- Note: a browser cannot see an external recorder or a phone camera — the moving watermark covers those.

alter table public.profiles
  add column if not exists banned_at timestamptz,
  add column if not exists banned_reason text;

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('capture_shortcut', 'devtools', 'record_shortcut')),
  lecture_id uuid references public.lectures (id) on delete set null,
  detail jsonb not null default '{}',
  action text not null default 'logged' check (action in ('logged', 'warned', 'banned')),
  created_at timestamptz not null default now()
);
create index if not exists security_incidents_user_idx on public.security_incidents (user_id, created_at desc);
create index if not exists security_incidents_time_idx on public.security_incidents (created_at desc);
alter table public.security_incidents enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'security_incidents' and policyname = 'security_incidents_admin') then
    create policy security_incidents_admin on public.security_incidents for select to authenticated using (is_admin());
  end if;
end $do$;
revoke insert, update, delete, truncate on public.security_incidents from anon, authenticated;

create or replace function public.security_settings()
returns jsonb
language sql stable security definer set search_path = public
as $function$
  select jsonb_build_object('auto_ban', true, 'ban_after', 2) || coalesce((select value::jsonb from app_settings where key = 'security' and value ~ '^\s*\{'), '{}');
$function$;
revoke all on function public.security_settings() from public, anon, authenticated;

-- internal: ban + cancel subscriptions + block sign-in (called by the report RPC and the admin button)
create or replace function public.apply_user_ban(p_user uuid, p_reason text, p_by uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
begin
  update profiles set banned_at = coalesce(banned_at, now()), banned_reason = left(p_reason, 300) where id = p_user;
  update subscriptions
     set status = 'cancelled', cancelled_at = now(),
         starts_at = least(starts_at, now() - interval '1 second'), ends_at = least(ends_at, now() - interval '1 second'),
         paused_at = null, pause_offset = null, pause_remaining = null
   where user_id = p_user and ((status = 'active' and ends_at > now()) or status = 'paused');
  if found then
    insert into subscription_events (user_id, action, note, by_user) values (p_user, 'cancel', 'حظر: ' || left(p_reason, 200), p_by);
  end if;
  update auth.users set banned_until = 'infinity' where id = p_user;
end $function$;
revoke all on function public.apply_user_ban(uuid, text, uuid) from public, anon, authenticated;

-- called by the watch page; returns what the page should do: 'logged' | 'warned' | 'banned'
create or replace function public.report_security_incident(p_kind text, p_lecture uuid default null, p_detail jsonb default '{}')
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  v_uid uuid := auth.uid(); v_role text; v_cfg jsonb := security_settings(); v_strikes int; v_action text := 'logged';
  v_name text; v_email text; a record; v_detail jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_kind not in ('capture_shortcut', 'devtools', 'record_shortcut') then raise exception 'bad kind'; end if;
  select role::text, full_name into v_role, v_name from profiles where id = v_uid;
  if (select banned_at from profiles where id = v_uid) is not null then return json_build_object('action', 'banned'); end if;
  if (select count(*) from security_incidents where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    return json_build_object('action', 'logged');
  end if;
  v_detail := jsonb_build_object('ua', left(coalesce(p_detail->>'ua', ''), 300), 'key', left(coalesce(p_detail->>'key', ''), 40),
                                 'screen', left(coalesce(p_detail->>'screen', ''), 40), 'page', left(coalesce(p_detail->>'page', ''), 200));
  select count(*) + 1 into v_strikes from security_incidents
   where user_id = v_uid and kind in ('capture_shortcut', 'record_shortcut') and created_at > now() - interval '30 days';
  if p_kind in ('capture_shortcut', 'record_shortcut') and v_role = 'student' then
    if coalesce((v_cfg->>'auto_ban')::boolean, true) and v_strikes >= greatest(coalesce((v_cfg->>'ban_after')::int, 2), 1) then
      v_action := 'banned';
    else
      v_action := 'warned';
    end if;
  end if;
  insert into security_incidents (user_id, kind, lecture_id, detail, action) values (v_uid, p_kind, p_lecture, v_detail, v_action);
  if v_action = 'banned' then
    perform apply_user_ban(v_uid, 'حظر تلقائي: محاولة تصوير أو تسجيل الشاشة أثناء مشاهدة المحاضرات', null);
  end if;
  -- tell the admins (at most once an hour per student and kind, always on a ban)
  if v_action = 'banned' or not exists (select 1 from security_incidents where user_id = v_uid and kind = p_kind
                                         and created_at > now() - interval '1 hour' and created_at < now()) then
    select email into v_email from auth.users where id = v_uid;
    for a in select id from profiles where role = 'admin' loop
      perform notify_user(a.id, 'n:sec:' || gen_random_uuid(), case when v_action = 'banned' then 'warning' else 'info' end,
        case when v_action = 'banned' then '🚫 تم حظر حساب تلقائيًا' else '⚠️ تنبيه أمني على المحاضرات' end,
        coalesce(v_name, '') || ' (' || coalesce(v_email, '') || ') · ' ||
        case p_kind when 'capture_shortcut' then 'محاولة تصوير الشاشة' when 'record_shortcut' then 'محاولة تسجيل الشاشة' else 'فتح أدوات المطوّر' end
        || case when v_action = 'banned' then ' — الحساب اتحظر واشتراكه اتلغى.' else '' end,
        'admin.html#security');
    end loop;
  end if;
  return json_build_object('action', v_action, 'strikes', v_strikes);
end $function$;
revoke all on function public.report_security_incident(text, uuid, jsonb) from public, anon;
grant execute on function public.report_security_incident(text, uuid, jsonb) to authenticated;

-- admin page: one row per account with incidents
create or replace function public.admin_security_overview()
returns table (user_id uuid, full_name text, email text, phone text, whatsapp text, role text, incidents bigint,
               captures bigint, devtools bigint, last_at timestamptz, last_kind text, banned_at timestamptz, banned_reason text)
language sql stable security definer set search_path = public
as $function$
  select i.user_id, p.full_name, u.email::text, p.phone, p.whatsapp, p.role::text, count(*),
         count(*) filter (where i.kind in ('capture_shortcut', 'record_shortcut')), count(*) filter (where i.kind = 'devtools'),
         max(i.created_at), (array_agg(i.kind order by i.created_at desc))[1], p.banned_at, p.banned_reason
    from security_incidents i join profiles p on p.id = i.user_id join auth.users u on u.id = i.user_id
   where is_admin()
   group by i.user_id, p.full_name, u.email, p.phone, p.whatsapp, p.role, p.banned_at, p.banned_reason
  union all
  select p.id, p.full_name, u.email::text, p.phone, p.whatsapp, p.role::text, 0, 0, 0, null, null, p.banned_at, p.banned_reason
    from profiles p join auth.users u on u.id = p.id
   where is_admin() and p.banned_at is not null and not exists (select 1 from security_incidents i where i.user_id = p.id)
   order by 10 desc nulls last;
$function$;

create or replace function public.admin_ban_user(p_user uuid, p_ban boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if (select role::text from profiles where id = p_user) = 'admin' then raise exception 'cannot ban an admin'; end if;
  if p_ban then
    perform apply_user_ban(p_user, coalesce(nullif(btrim(p_reason), ''), 'حظر من الإدارة'), auth.uid());
  else
    update profiles set banned_at = null, banned_reason = null where id = p_user;
    update auth.users set banned_until = null where id = p_user;
  end if;
end $function$;

create or replace function public.admin_security_settings(p_auto_ban boolean, p_ban_after int)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  v := jsonb_build_object('auto_ban', coalesce(p_auto_ban, true), 'ban_after', least(greatest(coalesce(p_ban_after, 2), 1), 10));
  insert into app_settings (key, value) values ('security', v::text) on conflict (key) do update set value = excluded.value;
  return v;
end $function$;

create or replace function public.admin_security_get()
returns jsonb
language sql stable security definer set search_path = public
as $function$ select case when is_admin() then security_settings() end; $function$;

revoke all on function public.admin_security_overview(), public.admin_ban_user(uuid, boolean, text),
  public.admin_security_settings(boolean, int), public.admin_security_get() from public, anon;
grant execute on function public.admin_security_overview(), public.admin_ban_user(uuid, boolean, text),
  public.admin_security_settings(boolean, int), public.admin_security_get() to authenticated;

-- a banned account can't watch anything (videos and lecture files both go through this check)
create or replace function public.can_watch_lecture(uid uuid, lid uuid)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select not exists (select 1 from profiles where id = uid and banned_at is not null) and (
    exists (select 1 from lectures l join courses c on c.id = l.course_id
             where l.id = lid and c.status = 'published' and c.kind = 'recorded' and l.is_preview and uid is not null)
    or exists (select 1 from lectures l where l.id = lid and can_watch(uid, l.course_id)));
$function$;
