-- 0125: Friday code wave: people who created an account since the offer was announced (24 Nov) are sent first,
-- together with those who clicked a Black/White Friday e-mail. (Text patch of the live bf_send().)
do $$
declare d text; a text := 'case when p_audience = ''bf_friday'' and exists (select 1 from email_events e join campaign_recipients c2 on c2.id = e.ref_id join email_campaigns ec';
begin
  d := pg_get_functiondef('public.bf_send(text,text,text,text,text,text,text,timestamptz)'::regprocedure);
  if strpos(d, a) = 0 then raise exception 'pattern not found'; end if;
  d := replace(d, a, 'case when p_audience = ''bf_friday'' and exists (select 1 from auth.users u where lower(u.email) = lower(cr.email) and u.created_at > timestamptz ''2026-11-24 00:00+02'') then 0
                  when p_audience = ''bf_friday'' and exists (select 1 from email_events e join campaign_recipients c2 on c2.id = e.ref_id join email_campaigns ec');
  execute d;
end $$;
