-- "15 courses for 100 EGP" campaign (19–20 Nov 2026), code BIOSYN on the monthly plan.
-- promo_campaign_send() copies the template campaign, builds the audience at send time and queues everything at once:
--   platform students without an active subscription (not the owner's accounts, no opt-outs),
--   plus, when p_include_legacy, old-platform users who aren't on the new platform yet.
-- Sends: now (platform + old users), 20 Nov 09:30 and 17:00 Cairo (platform only), each scheduled with pg_cron and
-- removing its own job after it runs.
-- Throughput: flush-emails runs every minute (the sender drains 90 per run at ~4/s), and the 24 h cap is raised to
-- 8,000 so the daily reactivation batches aren't blocked by the campaign (Resend Pro: no daily limit).

create or replace function public.promo_campaign_send(p_template uuid, p_name text, p_subject text, p_include_legacy boolean, p_job text default null)
returns json
language plpgsql security definer set search_path = public
as $function$
declare t email_campaigns; v_id uuid; v_n int; r json; v_paused uuid[];
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  select * into t from email_campaigns where id = p_template;
  if t.id is null then raise exception 'template not found'; end if;
  insert into email_campaigns (name, subject, heading, body, cta_label, cta_url, audience, status)
  values (p_name, coalesce(p_subject, t.subject), t.heading, t.body, t.cta_label, t.cta_url,
          case when p_include_legacy then 'non_subscribers+legacy' else 'non_subscribers' end, 'draft')
  returning id into v_id;

  insert into campaign_recipients (campaign_id, email, name, user_id)
  select distinct on (x.email) v_id, x.email, x.name, x.user_id from (
    select a.email, a.name, a.user_id, 1 pri from campaign_audience('non_subscribers') a where not is_excluded_email(a.email)
    union all
    select a.email, a.name, a.user_id, 2 from campaign_audience('legacy_all') a
     where p_include_legacy and not is_excluded_email(a.email)
       and not exists (select 1 from auth.users u where lower(u.email) = a.email)) x
  order by x.email, x.pri;

  select count(*) into v_n from campaign_recipients where campaign_id = v_id;
  update email_campaigns set status = 'sending', total = v_n, started_at = now() where id = v_id;
  -- queue this campaign completely now
  with p as (update email_campaigns set status = 'paused' where status = 'sending' and id <> v_id returning id)
  select array_agg(id) into v_paused from p;
  r := campaign_send_batch(v_n + 10);
  update email_campaigns set status = 'sending' where id = any (coalesce(v_paused, '{}'));
  if p_job is not null then perform cron.unschedule(p_job); end if;
  return json_build_object('campaign', v_id, 'recipients', v_n, 'batch', r);
end $function$;
revoke all on function public.promo_campaign_send(uuid, text, text, boolean, text) from public, anon, authenticated;

update site_content set data = data || '{"total_daily_cap": 8000}', updated_at = now() where key = 'reactivation';
select cron.alter_job((select jobid from cron.job where jobname = 'flush-emails'), schedule := '* * * * *');

select cron.schedule('promo100-0930', '30 7 20 11 *',
  $$select public.promo_campaign_send('b8cbd2d6-c0a9-4ee0-8908-653539972945', 'عرض 100 جنيه · الإرسال 2 (20 نوفمبر 9:30)', 'تذكير: {name}، 15 دورة كاملة بـ100 جنيه فقط', false, 'promo100-0930')$$);
select cron.schedule('promo100-1700', '0 15 20 11 *',
  $$select public.promo_campaign_send('b8cbd2d6-c0a9-4ee0-8908-653539972945', 'عرض 100 جنيه · الإرسال 3 (20 نوفمبر 5:00)', 'الساعات الأخيرة: {name}، اشترك في 15 دورة بـ100 جنيه فقط', false, 'promo100-1700')$$);
