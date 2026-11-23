-- 0114: undo two regressions from 0104_security_and_performance (2026-11-21), found 2026-11-23.
-- 0104 rewrote the RLS policies to wrap auth.uid() in a sub-select (a performance change) and dropped two safeguards:
--  1) profiles_update lost «role = my_role()»: any signed-in user could set their own role to admin.
--     (Checked: no account gained admin/support while it was open.) Closed by 0114a; codified here, plus a second lock
--     in the profiles guard trigger so a future policy rewrite cannot reopen it.
--  2) requests_create became «user_id = auth.uid()»: for a visitor who is not signed in both sides are NULL, NULL = NULL
--     is not true, so every public form (teach, institutions, contact…) failed with
--     «new row violates row-level security policy for table requests». Restored to «is not distinct from».
-- 3) integration_secrets (gateway / e-mail API keys) and security_state (watchdog baselines) are server-only again:
--    0104 had opened them to the admin browser session; nothing in the site reads them directly.
-- The watchdog now re-checks (1) and (2) every 10 minutes and repairs them if they change again.

alter policy profiles_update on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = my_role());

drop policy if exists requests_create on public.requests;
create policy requests_create on public.requests for insert to anon, authenticated
  with check (user_id is not distinct from (select auth.uid()) and status = 'new' and type <> 'refund');

drop policy if exists integration_secrets_admin on public.integration_secrets;
drop policy if exists security_state_admin on public.security_state;

-- second lock: only an admin (or the server) can change anyone's role
create or replace function public.trg_profiles_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(), '') = 'authenticated' then
    new.role := old.role;
    new.ref_code := old.ref_code;
    new.created_at := old.created_at;
    new.unsub_token := old.unsub_token;
    if coalesce(current_setting('biosyn.claim_referral', true), '') <> '1' then new.referred_by := old.referred_by; end if;
    if coalesce(current_setting('biosyn.ban', true), '') <> '1' then
      new.banned_at := old.banned_at;
      new.banned_reason := old.banned_reason;
    end if;
  end if;
  return new;
end $$;

-- watchdog: the two policies above must keep their safeguards
do $$
declare d text := pg_get_functiondef('public.security_watchdog()'::regprocedure);
begin
  if position('policy:profiles_update' in d) = 0 then
    d := replace(d, $q$  perform sec_clear('cond:', v_seen);$q$,
                    $q$  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update'
                   and coalesce(with_check, '') ~ 'my_role\(\)') then
    execute 'drop policy if exists profiles_update on public.profiles';
    execute 'create policy profiles_update on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = my_role())';
    perform sec_alert('policy:profiles_update:' || to_char(now(), 'YYYYMMDDHH24'), 'critical', 'vuln', 'قاعدة منع تغيير الدور اتشالت',
      'تعديل في قاعدة البيانات شال الشرط اللي بيمنع المستخدم يغيّر دوره بنفسه (يعني أي طالب كان يقدر يخلّي نفسه أدمن).', 'اترجعت القاعدة تلقائيًا.');
    v_fixed := v_fixed + 1;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'INSERT'
                   and coalesce(with_check, '') ~* 'is not distinct from') then
    execute 'drop policy if exists requests_create on public.requests';
    execute $p$create policy requests_create on public.requests for insert to anon, authenticated with check (user_id is not distinct from (select auth.uid()) and status = 'new' and type <> 'refund')$p$;
    perform sec_alert('policy:requests_create:' || to_char(now(), 'YYYYMMDDHH24'), 'critical', 'bug', 'نماذج التقديم كانت واقفة',
      'تعديل في قاعدة البيانات خلّى الزوار مش قادرين يبعتوا نماذج التقديم (درّس معنا، المؤسسات، التواصل).', 'اترجعت القاعدة تلقائيًا.');
    v_fixed := v_fixed + 1;
  end if;
  perform sec_clear('cond:', v_seen);$q$);
    if position('policy:profiles_update' in d) = 0 then raise exception 'watchdog patch did not apply'; end if;
    execute d;
  end if;
end $$;
