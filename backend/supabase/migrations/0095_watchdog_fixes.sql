-- 0095: fixes for the first watchdog alerts (2026-11-21)
-- 1) Broken addresses (e.g. ".3692@gmail.com" from the old WordPress site) were queued again and again by campaigns,
--    and Resend refused them every time. enqueue_email() now drops any address that is not a valid e-mail,
--    the old-platform contacts with a broken address are marked "skipped", and the watchdog only alerts on
--    failures that can still succeed on a retry.
-- 2) The Fawaterk sweep and the CRM sync were called with pg_net's default 5-second wait, so every call was
--    logged as a timeout even though the function kept running. They now wait up to 60 seconds.

create or replace function public.valid_email(p text) returns boolean language sql immutable as $$
  select coalesce(p, '') ~* '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$';
$$;

do $$
declare d text := pg_get_functiondef('public.enqueue_email(text, text, text, text)'::regprocedure);
begin
  if position('valid_email(btrim(p_to))' in d) = 0 then
    d := replace(d, $q$if nullif(btrim(p_to), '') is null then return; end if;$q$,
                    $q$if nullif(btrim(p_to), '') is null or not valid_email(btrim(p_to)) then return; end if;$q$);
    if position('valid_email(btrim(p_to))' in d) = 0 then raise exception 'enqueue_email patch did not apply'; end if;
    execute d;
  end if;
end $$;

update legacy_users set status = 'skipped', note = coalesce(note || ' · ', '') || 'بريد غير صالح'
 where not valid_email(email) and status <> 'skipped';

-- failed sends to an address that can never work: stop counting them as an open problem
update email_outbox set attempts = greatest(attempts, 5)
 where status = 'failed' and not valid_email(to_email);

do $$
declare d text := pg_get_functiondef('public.security_watchdog()'::regprocedure);
begin
  d := replace(d, $q$select count(*), max(last_error) into n, v_t from email_outbox where status = 'failed' and created_at > now() - interval '2 days';$q$,
                  $q$select count(*), max(last_error) into n, v_t from email_outbox where status = 'failed' and attempts < 5 and valid_email(to_email)
     and coalesce(last_error, '') !~* '(invalid|skipped|validation_error)' and created_at > now() - interval '2 days';$q$);
  if position('valid_email(to_email)' in d) = 0 then raise exception 'watchdog patch did not apply'; end if;
  execute d;
end $$;

select cron.alter_job(jobid, command := replace(command, $q$body := '{"sweep":true}'::jsonb)$q$, $q$body := '{"sweep":true}'::jsonb, timeout_milliseconds := 60000)$q$))
  from cron.job where jobname = 'fawaterk-sweep' and command not like '%timeout_milliseconds%';
select cron.alter_job(jobid, command := replace(command, $q$body := '{}'::jsonb)$q$, $q$body := '{}'::jsonb, timeout_milliseconds := 60000)$q$))
  from cron.job where jobname in ('crm-sync', 'bunny-stats-refresh') and command not like '%timeout_milliseconds%';

-- the alerts these fixes answer
update security_alerts set status = 'resolved', resolved_at = now(), resolved_by = 'إصلاح 0095'
 where status = 'open' and key in ('cond:mailfail', 'cond:http');
