-- 0117: Black Friday 27 Nov 2026 — teaser e-mails (24-26 Nov), code reveal Friday 14:00 Cairo, upgrade mail for subscribers,
-- and a free month for the 4 subscribers who paid with the 50% «biox» code this week.
-- Every campaign mail carries the existing per-recipient open pixel and tracked button (email_events), so Admin →
-- campaigns shows sent / opened / clicked / new accounts / purchases / revenue per wave.

create or replace function public.bf_send(p_name text, p_subject text, p_heading text, p_body text, p_cta_label text, p_cta_url text,
                                           p_audience text, p_start timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare c email_campaigns; v_id uuid; v_n int := 0; r record; m record; v_start timestamptz := greatest(coalesce(p_start, now()), now()) + interval '20 seconds';
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  if p_audience not in ('bf_all', 'bf_engaged', 'bf_friday', 'bf_upgrade') then raise exception 'bad audience'; end if;
  if exists (select 1 from email_campaigns where name = p_name) then raise exception 'campaign % already exists', p_name; end if;
  insert into email_campaigns (name, subject, heading, body, cta_label, cta_url, audience, status, started_at)
  values (p_name, p_subject, p_heading, p_body, p_cta_label, p_cta_url, p_audience, 'sending', now()) returning * into c;
  v_id := c.id;

  insert into campaign_recipients (campaign_id, email, name, user_id)
  select distinct on (x.email) v_id, x.email, x.name, x.user_id from (
    -- not subscribed yet: platform students without a live subscription + old-platform contacts with no account
    select a.email, a.name, a.user_id from campaign_audience('non_subscribers') a where p_audience <> 'bf_upgrade'
    union all
    select a.email, a.name, a.user_id from campaign_audience('legacy_all') a
     where p_audience <> 'bf_upgrade' and not exists (select 1 from auth.users u where lower(u.email) = a.email)
    union all
    -- subscribers who can move to a longer plan (monthly → 6/12 months, 6 → 12 months)
    select lower(u.email), p.full_name, p.id from subscriptions s join plans pl on pl.id = s.plan_id join profiles p on p.id = s.user_id join auth.users u on u.id = s.user_id
     where p_audience = 'bf_upgrade' and s.ends_at > now() and pl.duration_months < 12
       and not exists (select 1 from email_optouts o where o.email = lower(u.email))) x
  where not is_excluded_email(x.email) and valid_email(x.email)
    and not exists (select 1 from email_optouts o where o.email = lower(x.email))
    and (p_audience <> 'bf_engaged' or exists (select 1 from email_events e join campaign_recipients cr on cr.id = e.ref_id
                                                where e.source = 'campaign' and lower(cr.email) = lower(x.email)))
  order by x.email;

  select * into c from email_campaigns where id = v_id;
  -- Friday: people who clicked a Black Friday mail first, then anyone who ever opened a campaign, then everyone else
  for r in
    select cr.*, row_number() over (order by
             case when p_audience = 'bf_friday' and exists (select 1 from email_events e join campaign_recipients c2 on c2.id = e.ref_id join email_campaigns ec on ec.id = c2.campaign_id
                                                            where e.source = 'campaign' and e.kind = 'click' and ec.name like 'BF · %' and lower(c2.email) = lower(cr.email)) then 0
                  when p_audience = 'bf_friday' and exists (select 1 from email_events e join campaign_recipients c2 on c2.id = e.ref_id
                                                            where e.source = 'campaign' and lower(c2.email) = lower(cr.email)) then 1
                  else 2 end, cr.email) - 1 as i
      from campaign_recipients cr where cr.campaign_id = v_id
  loop
    select * into m from campaign_mail(c, r.name, r.token);
    perform enqueue_email('campaign:' || r.id, r.email, m.subject, m.html);
    update email_outbox set send_after = v_start + r.i * interval '700 milliseconds' where dedupe_key = 'campaign:' || r.id;
    update campaign_recipients set status = 'sent', sent_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  update email_campaigns set status = 'done', total = v_n, sent = v_n, finished_at = now() where id = v_id;
  return json_build_object('campaign', p_name, 'recipients', v_n, 'starts', v_start);
end $$;
revoke execute on function public.bf_send(text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
