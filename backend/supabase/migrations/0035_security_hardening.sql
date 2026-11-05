-- Security hardening from the Supabase advisor review.
-- 1) trigger functions are not API endpoints: nobody calls them through /rest/v1/rpc (triggers keep firing; the
--    EXECUTE privilege is only checked when a trigger is created).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

-- 2) internal helpers: lecture_unlocked(uid, lid) takes any user id, so it stays server-side only
revoke execute on function lecture_unlocked(uuid, uuid) from public, anon, authenticated;
grant execute on function lecture_unlocked(uuid, uuid) to service_role;

-- 3) fixed search_path on the email helper
alter function paid_txt(payments) set search_path = public;

-- 4) retired entry points (kept only to answer old browser tabs with a clear message)
revoke execute on function create_manual_payment(text, text, text, uuid, text) from public, anon;
