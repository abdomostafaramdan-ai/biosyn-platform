-- campaign_send_batch: the closing "queued" count reused the loop variable names c / r as table aliases, so every call
-- that reached it failed with 'column reference "c.id" is ambiguous' (sending a running campaign from the admin panel).
-- Also: the admin check now covers any browser session (JWT role anon/authenticated), not only the authenticator login.
create or replace function public.campaign_send_batch(p_max integer default null::integer)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_all int; v_n int; v_sent int := 0; c email_campaigns; r campaign_recipients; m record;
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  select count(*) into v_all from email_outbox where created_at > now() - interval '24 hours';
  v_n := least(coalesce(p_max, 1000), coalesce((cfg->>'total_daily_cap')::int, 95) - v_all);
  for c in select * from email_campaigns where status = 'sending' order by started_at loop
    exit when v_n <= 0;
    for r in select * from campaign_recipients where campaign_id = c.id and status = 'queued' order by email limit v_n for update skip locked loop
      if exists (select 1 from email_optouts o where o.email = lower(r.email)) then update campaign_recipients set status = 'skipped' where id = r.id; continue; end if;
      select * into m from campaign_mail(c, r.name, r.token);
      perform enqueue_email('campaign:' || r.id, r.email, m.subject, m.html);
      update campaign_recipients set status = 'sent', sent_at = now() where id = r.id;
      v_sent := v_sent + 1; v_n := v_n - 1;
    end loop;
    update email_campaigns set sent = (select count(*) from campaign_recipients where campaign_id = c.id and status = 'sent'),
      status = case when exists (select 1 from campaign_recipients where campaign_id = c.id and status = 'queued') then status else 'done' end,
      finished_at = case when exists (select 1 from campaign_recipients where campaign_id = c.id and status = 'queued') then null else now() end
     where id = c.id;
  end loop;
  return json_build_object('sent', v_sent, 'emails_24h', v_all + v_sent,
    'queued', (select count(*) from campaign_recipients cr join email_campaigns ec on ec.id = cr.campaign_id where ec.status = 'sending' and cr.status = 'queued'));
end $function$;
