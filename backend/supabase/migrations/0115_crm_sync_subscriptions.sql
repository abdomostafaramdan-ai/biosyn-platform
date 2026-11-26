-- CRM sync, second round
--   * every subscription change (new, renewed, paused, resumed, cancelled, extended) updates the student's card in the CRM:
--     status, plan and end date, so "active members" and "renewing soon" in the CRM match the platform.
--   * a nightly pass sends subscriptions that simply ran out (status stays 'active' but the end date passed).
--   * unsubscribing from platform emails turns off email for that contact in the CRM.
--   * form requests and teach-page applications now go through the signed channel (woo-webhook) instead of the
--     public lead form, which has a per-hour limit meant for strangers. The CRM creates a follow-up task for each.
-- All CRM traffic is signed with HMAC-SHA256 (CRM_WOO_SECRET).

create or replace function public.crm_sub_event(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
declare s record; v_email text; v_name text; v_phone text; v_status text; v_ends date;
begin
  select email into v_email from auth.users where id = p_user;
  if v_email is null or is_excluded_email(v_email) then return; end if;
  -- the subscription that describes the student now: a running one first, then the most recent
  select sb.*, pl.name as plan_name into s
    from subscriptions sb left join plans pl on pl.id = sb.plan_id
   where sb.user_id = p_user
   order by (sb.status = 'active' and sb.ends_at > now()) desc, (sb.status = 'paused') desc, sb.ends_at desc nulls last
   limit 1;
  if not found then return; end if;
  v_status := case when s.status = 'active' and s.ends_at <= now() then 'expired' else s.status end;
  v_ends := case when s.status = 'paused' then null else (s.ends_at at time zone 'Africa/Cairo')::date end;
  select full_name, coalesce(phone, whatsapp) into v_name, v_phone from profiles where id = p_user;
  insert into crm_outbox (dedupe_key, kind, payload) values (
    'sub:' || p_user || ':' || v_status || ':' || coalesce(v_ends::text, '-'), 'order',
    jsonb_build_object('id', 'sub-' || p_user, 'biosyn_event', 'subscription', 'status', v_status,
      'ends_at', coalesce(v_ends::text, ''), 'plan', coalesce(s.plan_name, ''),
      'email', v_email, 'name', left(coalesce(v_name, ''), 80), 'phone', coalesce(v_phone, '')))
  on conflict (dedupe_key) do nothing;
end $function$;
revoke all on function public.crm_sub_event(uuid) from public, anon, authenticated;

create or replace function public.trg_crm_subscription()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.ends_at is not distinct from old.ends_at then return new; end if;
  perform crm_sub_event(new.user_id);
  return new;
end $function$;
revoke all on function public.trg_crm_subscription() from public, anon, authenticated;
drop trigger if exists crm_subscription on public.subscriptions;
create trigger crm_subscription after insert or update of status, ends_at on public.subscriptions
  for each row execute function public.trg_crm_subscription();

create or replace function public.trg_crm_optout()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  insert into crm_outbox (dedupe_key, kind, payload) values ('optout:' || lower(new.email), 'order',
    jsonb_build_object('id', 'optout-' || md5(lower(new.email)), 'biosyn_event', 'optout', 'email', lower(new.email)))
  on conflict (dedupe_key) do nothing;
  return new;
end $function$;
revoke all on function public.trg_crm_optout() from public, anon, authenticated;
drop trigger if exists crm_optout on public.email_optouts;
create trigger crm_optout after insert on public.email_optouts for each row execute function public.trg_crm_optout();

-- nightly: subscriptions that ran out yesterday
create or replace function public.crm_sync_expired()
returns int
language plpgsql security definer set search_path = public
as $function$
declare r record; n int := 0;
begin
  for r in select distinct user_id from subscriptions
            where status = 'active' and ends_at <= now() and ends_at > now() - interval '3 days' loop
    perform crm_sub_event(r.user_id); n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.crm_sync_expired() from public, anon, authenticated;
select cron.unschedule('crm-sync-expired') where exists (select 1 from cron.job where jobname = 'crm-sync-expired');
select cron.schedule('crm-sync-expired', '17 1 * * *', 'select public.crm_sync_expired()');

-- backfill: current state of every subscriber, and every opt-out
select public.crm_sub_event(u.user_id) from (select distinct user_id from subscriptions) u;
insert into crm_outbox (dedupe_key, kind, payload)
select 'optout:' || lower(o.email), 'order',
       jsonb_build_object('id', 'optout-' || md5(lower(o.email)), 'biosyn_event', 'optout', 'email', lower(o.email))
  from email_optouts o
on conflict (dedupe_key) do nothing;
