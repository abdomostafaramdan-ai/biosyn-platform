-- 0113: two-step verification (TOTP, e.g. Google Authenticator) for admin and support accounts.
-- Supabase Auth issues the authenticator factor; once an account has a verified factor, admin/support powers only work
-- in a session that entered the code (JWT aal = 'aal2'). A stolen password alone is then not enough.
-- Every admin check in the database, the RLS policies and the edge functions goes through is_admin() / is_staff().
-- Lost phone: remove the factor in Supabase → Authentication → Users → the user → MFA factors (or ask Claude to run SQL).

create or replace function public.mfa_ok() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin') and mfa_ok();
$$;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'support')) and mfa_ok();
$$;

-- for the dashboard: does this account have the authenticator set up, and is this session verified?
create or replace function public.my_mfa() returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'));
$$;

revoke execute on function public.mfa_ok(), public.my_mfa() from public, anon;
grant execute on function public.mfa_ok(), public.my_mfa() to authenticated;

-- watchdog: an admin/support account without the authenticator is an open warning until it is set up
do $$
declare d text := pg_get_functiondef('public.security_watchdog()'::regprocedure);
begin
  if position('cond:mfa:' in d) = 0 then
    d := replace(d, $q$  perform sec_clear('cond:', v_seen);$q$,
                    $q$  for r in select p.id, p.full_name, p.role::text as role from profiles p
              where p.role::text in ('admin', 'support')
                and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') loop
    perform sec_alert('cond:mfa:' || r.id, 'warning', 'vuln', 'حساب ' || case when r.role = 'admin' then 'أدمن' else 'دعم' end || ' من غير تحقق بخطوتين',
      coalesce(r.full_name, '') || ': لو كلمة المرور اتسرقت، اللي سرقها يتحكم في المنصة. فعّل التحقق بخطوتين من «مركز الأمان».', null);
    v_seen := array_append(v_seen, 'cond:mfa:' || r.id);
  end loop;
  perform sec_clear('cond:', v_seen);$q$);
    if position('cond:mfa:' in d) = 0 then raise exception 'watchdog patch did not apply'; end if;
    execute d;
  end if;
end $$;
