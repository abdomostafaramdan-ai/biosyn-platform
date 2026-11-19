-- Resend Pro (50,000 emails/month, no daily limit) from 2026-11-19.
-- 1) The reactivation campaign warms the sending domain up gradually instead of jumping to thousands a day:
--    cfg.ramp = per-day limits counted from cfg.ramp_start (Cairo date); after the last step the last value holds.
--    The effective daily limit is least(daily_limit, ramp step).
-- 2) The daily batch runs from pg_cron (10:13 Cairo) so it no longer depends on an external scheduled task.

create or replace function public.reactivation_day_limit(cfg jsonb)
returns int
language sql stable set search_path = public
as $function$
  select least(
    coalesce((cfg->>'daily_limit')::int, 80),
    coalesce(case
      when jsonb_typeof(cfg->'ramp') = 'array' and jsonb_array_length(cfg->'ramp') > 0 and cfg->>'ramp_start' ~ '^\d{4}-\d{2}-\d{2}$' then
        (cfg->'ramp'->>least(greatest((now() at time zone 'Africa/Cairo')::date - (cfg->>'ramp_start')::date, 0),
                             jsonb_array_length(cfg->'ramp') - 1))::int
    end, 2147483647));
$function$;
revoke all on function public.reactivation_day_limit(jsonb) from public, anon, authenticated;

create or replace function public.reactivation_send_batch(p_max integer default null::integer)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_limit int := reactivation_day_limit(cfg);
  v_today int; v_all int; v_n int; v_sent int := 0; v_bad int := 0; v_linked int; r legacy_users; m record; v_var text;
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  v_linked := legacy_link_existing();
  if not coalesce((cfg->>'enabled')::boolean, false) then
    return json_build_object('skipped', 'disabled', 'linked', v_linked, 'queued', (select count(*) from legacy_users where status = 'queued'));
  end if;
  select count(*) into v_today from legacy_users where sent_at is not null and (sent_at at time zone 'Africa/Cairo')::date = v_day;
  select count(*) into v_all from email_outbox where created_at > now() - interval '24 hours';
  v_n := least(coalesce(p_max, 5000), v_limit - v_today, coalesce((cfg->>'total_daily_cap')::int, 95) - v_all);
  if v_n > 0 then
    for r in select * from legacy_users where status = 'queued'
              order by priority desc, coalesce(last_active_at, legacy_created_at) desc nulls last, created_at limit v_n for update skip locked loop
      if r.email !~* '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
        update legacy_users set status = 'skipped', note = 'invalid email' where id = r.id; v_bad := v_bad + 1; continue;
      end if;
      v_var := case when abs(hashtext(lower(r.email))) % 2 = 0 then 'A' else 'B' end;
      select * into m from reactivation_mail(r, v_var);
      perform enqueue_email('reactivation:' || r.id, btrim(r.email), m.subject, m.html);
      update legacy_users set status = 'sent', sent_at = now(), variant = v_var where id = r.id;
      v_sent := v_sent + 1;
    end loop;
  end if;
  return json_build_object('sent', v_sent, 'invalid', v_bad, 'linked', v_linked, 'today', v_today + v_sent, 'day_limit', v_limit,
    'emails_24h', v_all + v_sent, 'queued', (select count(*) from legacy_users where status = 'queued'),
    'activated', (select count(*) from legacy_users where status = 'activated'),
    'days_left', ceil((select count(*) from legacy_users where status = 'queued')::numeric / greatest(v_limit, 1)));
end $function$;

-- the admin page shows today's effective limit
create or replace function public.reactivation_today_limit()
returns int
language sql stable security definer set search_path = public
as $function$ select case when is_admin() then reactivation_day_limit(coalesce((select data from site_content where key = 'reactivation'), '{}')) end; $function$;
revoke all on function public.reactivation_today_limit() from public, anon;
grant execute on function public.reactivation_today_limit() to authenticated;

-- Pro plan settings + warm-up starting today
update site_content
   set data = data || jsonb_build_object('daily_limit', 1000, 'total_daily_cap', 2500, 'plan', 'pro',
                                         'ramp', jsonb_build_array(300, 300, 500, 500, 1000),
                                         'ramp_start', to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD')),
       updated_at = now()
 where key = 'reactivation';

-- daily batch from the database (08:13 UTC = 10:13 Cairo)
select cron.schedule('marketing-daily-batch', '13 8 * * *', 'select public.marketing_daily_batch()');
