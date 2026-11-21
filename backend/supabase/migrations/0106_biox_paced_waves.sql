-- biox 50% campaign, paced sending.
-- 1) email_outbox.send_after: a queued row is not claimed before this time (null = send now, as before).
--    claim_emails() only returns due rows, and the 15-minute "stuck in sending" reset counts from send_after.
-- 2) biox_wave(): builds the audience at send time and queues it at 1 email/second, with a 10-minute pause after every
--    1,000 emails. Follow-up waves (p_only_unopened) skip anyone who opened or clicked an earlier biox email.
--    Everyone with an active subscription, the owner's accounts and opt-outs are always skipped.
-- 3) Waves: now (21 Nov evening), 23 Nov 10:00, 25 Nov 18:00, 27 Nov 10:00, 28 Nov 18:00 (Cairo). Code expires 30 Nov.
-- 4) The daily reactivation batches pause during the campaign week, so old users don't get two emails a day.

alter table public.email_outbox add column if not exists send_after timestamptz;
create index if not exists email_outbox_due_idx on public.email_outbox (status, send_after) where status = 'pending';

create or replace function public.claim_emails(p_n integer default 20)
returns setof email_outbox
language plpgsql security definer set search_path = public
as $function$
begin
  update email_outbox set status = 'pending'
   where status = 'sending' and coalesce(send_after, created_at) < now() - interval '15 minutes' and sent_at is null;
  return query
    update email_outbox e set status = 'sending', attempts = e.attempts + 1
     where e.id in (select id from email_outbox
                     where status = 'pending' and attempts < 5 and (send_after is null or send_after <= now())
                     order by coalesce(send_after, created_at) limit p_n for update skip locked)
    returning e.*;
end $function$;

-- the cron only wakes the sender when something is due
select cron.alter_job((select jobid from cron.job where jobname = 'flush-emails'), command := $c$
  select net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/send-emails',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 120000)
   where exists (select 1 from public.email_outbox where status = 'pending' and attempts < 5 and (send_after is null or send_after <= now()))
$c$);

create or replace function public.biox_wave(p_name text, p_subject text, p_only_unopened boolean, p_job text default null)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  t email_campaigns; c email_campaigns; v_id uuid; v_n int := 0; r record; m record; v_start timestamptz := now() + interval '30 seconds';
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  select * into t from email_campaigns where name = 'biox 50% · template' limit 1;
  if t.id is null then raise exception 'biox template not found'; end if;

  insert into email_campaigns (name, subject, heading, body, cta_label, cta_url, audience, status, started_at)
  values (p_name, p_subject, t.heading, t.body, t.cta_label, t.cta_url,
          case when p_only_unopened then 'biox_unopened' else 'non_subscribers+legacy' end, 'sending', now())
  returning id into v_id;

  insert into campaign_recipients (campaign_id, email, name, user_id)
  select distinct on (x.email) v_id, x.email, x.name, x.user_id from (
    select a.email, a.name, a.user_id, 1 pri from campaign_audience('non_subscribers') a
    union all
    select a.email, a.name, a.user_id, 2 from campaign_audience('legacy_all') a
     where not exists (select 1 from auth.users u where lower(u.email) = a.email)) x
  where not is_excluded_email(x.email)
    and not exists (select 1 from email_optouts o where o.email = lower(x.email))
    and not (p_only_unopened and exists (
          select 1 from email_events e
            join campaign_recipients cr on cr.id = e.ref_id
            join email_campaigns ec on ec.id = cr.campaign_id
           where e.source = 'campaign' and ec.name like 'biox 50%% · %%' and ec.id <> v_id and lower(cr.email) = lower(x.email)))
  order by x.email, x.pri;

  select * into c from email_campaigns where id = v_id;
  for r in select cr.*, (row_number() over (order by cr.email) - 1) as i from campaign_recipients cr where cr.campaign_id = v_id loop
    select * into m from campaign_mail(c, r.name, r.token);
    perform enqueue_email('campaign:' || r.id, r.email, m.subject, m.html);
    update email_outbox
       set send_after = v_start + r.i * interval '1 second' + (r.i / 1000) * interval '10 minutes'
     where dedupe_key = 'campaign:' || r.id;
    update campaign_recipients set status = 'sent', sent_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;

  update email_campaigns set status = 'done', total = v_n, sent = v_n, finished_at = now() where id = v_id;
  if p_job is not null then perform cron.unschedule(p_job); end if;
  return json_build_object('campaign', v_id, 'queued', v_n,
    'first_at', v_start, 'last_at', v_start + greatest(v_n - 1, 0) * interval '1 second' + (greatest(v_n - 1, 0) / 1000) * interval '10 minutes');
end $function$;
revoke all on function public.biox_wave(text, text, boolean, text) from public, anon, authenticated;

-- the earlier one-shot launcher is replaced by biox_wave
drop function if exists public.biox_campaign_launch();

-- the template heading without a name placeholder (some old users have no name on file)
update email_campaigns set heading = 'هدية منّا لك 🎁' where name = 'biox 50% · template';

-- pause reactivation batches until the campaign week ends; resumes 29 Nov 10:00 Cairo
update site_content set data = data || '{"enabled": false}', updated_at = now() where key = 'reactivation';
select cron.schedule('biox-resume-reactivation', '0 8 29 11 *',
  $$update public.site_content set data = data || '{"enabled": true}', updated_at = now() where key = 'reactivation';
    select cron.unschedule('biox-resume-reactivation');$$);

-- follow-up waves (UTC times; Cairo = UTC+2)
select cron.schedule('biox-wave-2', '0 8 23 11 *',
  $$select public.biox_wave('biox 50% · تذكير 1 (23 نوفمبر 10:00)', '{name}، لسه ما شفتش عرض biox؟ خصم 50٪ مستنيك ⏳', true, 'biox-wave-2')$$);
select cron.schedule('biox-wave-3', '0 16 25 11 *',
  $$select public.biox_wave('biox 50% · تذكير 2 (25 نوفمبر 18:00)', '{name}، الباقة نصف السنوية بنص السعر مع كود biox', true, 'biox-wave-3')$$);
select cron.schedule('biox-wave-4', '0 8 27 11 *',
  $$select public.biox_wave('biox 50% · تذكير 3 (27 نوفمبر 10:00)', 'باقي 3 أيام على خصم 50٪ بكود biox يا {name}', true, 'biox-wave-4')$$);
select cron.schedule('biox-wave-5', '0 16 28 11 *',
  $$select public.biox_wave('biox 50% · آخر تذكير (28 نوفمبر 18:00)', 'آخر تذكير يا {name}: كود biox ينتهي 30 نوفمبر 🔥', true, 'biox-wave-5')$$);
