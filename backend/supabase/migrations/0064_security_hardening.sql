-- 2026-11-08 security audit fixes (applied as 0064_security_hardening + 0064b + 0064c)

-- 1) admin-only RPCs: the anon role can no longer reach them (they also check is_admin())
revoke execute on function public.admin_insights(timestamptz, timestamptz) from anon, public;
revoke execute on function public.campaign_preview(uuid) from anon, public;
revoke execute on function public.campaign_send_test(uuid, text) from anon, public;
revoke execute on function public.campaign_start(uuid) from anon, public;
revoke execute on function public.reactivation_stats() from anon, public;
revoke execute on function public.my_shared_forms() from anon, public;
grant execute on function public.admin_insights(timestamptz, timestamptz), public.campaign_preview(uuid), public.campaign_send_test(uuid, text),
  public.campaign_start(uuid), public.reactivation_stats(), public.my_shared_forms() to authenticated;

-- 2) fixed search_path (linter 0011)
alter function public.legacy_first_name(text) set search_path = public;
alter function public.norm_answer(text) set search_path = public;

-- 3) instructors no longer read the platform's monthly subscription income / total views
drop policy if exists pools_instructor on public.month_pools;

-- 4) instructors could DELETE their own published course through the API; now only draft/review courses
drop policy if exists courses_inst on public.courses;
create policy courses_inst_insert on public.courses for insert to authenticated
  with check (instructor_id = auth.uid() and status in ('draft','review'));
create policy courses_inst_update on public.courses for update to authenticated
  using (instructor_id = auth.uid() and status in ('draft','review'))
  with check (instructor_id = auth.uid() and status in ('draft','review'));
create policy courses_inst_delete on public.courses for delete to authenticated
  using (instructor_id = auth.uid() and status in ('draft','review'));

-- 5) public request forms: no spoofed user_id/status, no fake refund requests, per-IP rate limit
create or replace function public.request_rate_ok() returns boolean language sql security definer set search_path = public as $$
  select chat_hit('rq:' || split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'na'), ',', 1), 30);
$$;
revoke execute on function public.request_rate_ok() from public;
grant execute on function public.request_rate_ok() to anon, authenticated;

create or replace function public.trg_request_validate() returns trigger language plpgsql set search_path = public as $$
begin
  if new.type::text = 'institution' and is_personal_email(new.email) then
    raise exception 'institution email required' using errcode = 'check_violation';
  end if;
  -- direct inserts from the browser (not the SECURITY DEFINER RPCs, which run as the owner)
  if current_user in ('anon', 'authenticated') and not coalesce(is_staff(), false) then
    new.user_id := auth.uid();
    new.status := 'new';
    if new.type::text = 'refund' then raise exception 'use request_refund' using errcode = 'check_violation'; end if;
    if not request_rate_ok() then raise exception 'too many requests' using errcode = 'check_violation'; end if;
  end if;
  return new;
end $$;

-- 6) profile rows: created_at is not user-editable either
create or replace function public.trg_profiles_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(),'') = 'authenticated' then
    new.ref_code := old.ref_code;
    new.created_at := old.created_at;
    if coalesce(current_setting('biosyn.claim_referral', true), '') <> '1' then new.referred_by := old.referred_by; end if;
  end if;
  return new;
end $$;

-- 7) per-library Bunny embed token keys (BUNNY_TOKEN_KEYS: "libraryId=key" pairs) used by get-playback
create or replace function public.integration_keys() returns text[] language sql immutable set search_path = public as $$
  select array[
    'PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','FEE_PAYMOB_PCT','FEE_PAYMOB_FIXED',
    'FAWATERK_API_KEY','FAWATERK_VENDOR_KEY','FAWATERK_BASE_URL','FEE_FAWATERK_PCT','FEE_FAWATERK_FIXED',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FEE_STRIPE_PCT','FEE_STRIPE_FIXED',
    'BUNNY_LIBRARY_ID','BUNNY_TOKEN_KEY','BUNNY_API_KEY','BUNNY_ACCOUNT_KEY','BUNNY_TOKEN_KEYS',
    'RESEND_API_KEY','MAIL_FROM',
    'META_PIXEL_ID','META_CAPI_TOKEN','GA4_ID',
    'ANTHROPIC_API_KEY',
    'CRM_URL','CRM_WOO_SECRET'
  ]::text[];
$$;
revoke execute on function public.integration_keys() from public, anon, authenticated;
