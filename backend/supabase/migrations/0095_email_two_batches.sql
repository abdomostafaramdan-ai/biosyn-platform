-- 1) Every insert into email_outbox used to call the send-emails function, so a batch of 300 started dozens of senders at
--    once and Resend answered 429 (max 10 requests/second). The kick now fires at most once every 20 seconds; the sender
--    drains up to 90 emails per run (~4/s) and the 5-minute cron picks up the rest.
-- 2) Reactivation sends twice a day, 300 each (10:13 and 18:30 Cairo): cfg.batch_size per run, cfg.daily_limit per day.
-- 3) Emails that failed only because of the rate limit go back to the queue.

create table if not exists public.mailer_kick (id int primary key default 1 check (id = 1), at timestamptz not null default '-infinity');
insert into public.mailer_kick (id) values (1) on conflict do nothing;
alter table public.mailer_kick enable row level security;
revoke all on public.mailer_kick from anon, authenticated;

create or replace function public.trg_kick_mailer()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  update mailer_kick set at = now() where id = 1 and at < now() - interval '20 seconds';
  if found then
    perform net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/send-emails',
                          headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000);
  end if;
  return null;
exception when others then return null;
end $function$;

create or replace function public.marketing_daily_batch()
returns json
language plpgsql security definer set search_path = public
as $function$
declare a json; b json; v_batch int;
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  select nullif((data->>'batch_size'), '')::int into v_batch from site_content where key = 'reactivation';
  a := reactivation_send_batch(v_batch); b := campaign_send_batch();
  return json_build_object('reactivation', a, 'campaigns', b);
end $function$;

update site_content
   set data = (data - 'ramp' - 'ramp_start') || jsonb_build_object('batch_size', 300, 'daily_limit', 600, 'schedule', jsonb_build_array('10:13', '18:30')),
       updated_at = now()
 where key = 'reactivation';

select cron.schedule('marketing-evening-batch', '30 16 * * *', 'select public.marketing_daily_batch()');

update email_outbox set status = 'pending', attempts = 0, last_error = 'requeued after rate limit'
 where status = 'failed' and last_error like '%resend 429%';
