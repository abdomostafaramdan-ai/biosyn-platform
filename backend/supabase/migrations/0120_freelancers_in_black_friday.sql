-- 0120: Black Friday «everyone» waves (today / code) also reach the freelancers, unless they already get it as a
-- platform user or old-platform contact, have a live subscription, or opted out. The one-time import function is gone.
drop function if exists public.fl_import(text, jsonb);
delete from security_state where key = 'fl_import_key';
update security_state set value = value - 'fl_import' where key = 'anon_fn_allow';

do $$
declare d text := pg_get_functiondef('public.bf_send(text, text, text, text, text, text, text, timestamptz)'::regprocedure);
begin
  if position('freelance_contacts' in d) = 0 then
    d := replace(d, $q$    union all
    select lower(u.email), p.full_name, p.id from subscriptions s$q$,
                    $q$    union all
    select f.email, f.name, null::uuid from freelance_contacts f
     where p_audience in ('bf_all', 'bf_friday')
       and not exists (select 1 from auth.users u join subscriptions s on s.user_id = u.id and s.ends_at > now() where lower(u.email) = f.email)
    union all
    select lower(u.email), p.full_name, p.id from subscriptions s$q$);
    if position('freelance_contacts' in d) = 0 then raise exception 'bf_send patch did not apply'; end if;
    execute d;
  end if;
end $$;
