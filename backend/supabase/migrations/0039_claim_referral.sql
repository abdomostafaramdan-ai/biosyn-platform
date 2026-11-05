-- the profile guard keeps users from editing ref fields; claim_referral() is the one sanctioned path
create or replace function trg_profiles_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(),'') = 'authenticated' then
    new.ref_code := old.ref_code;
    if coalesce(current_setting('biosyn.claim_referral', true), '') <> '1' then new.referred_by := old.referred_by; end if;
  end if;
  return new;
end $$;
revoke execute on function trg_profiles_guard() from public, anon, authenticated;

-- Google sign-ups can't carry the ?ref= code through OAuth metadata, so the new account claims it once, right after signing in.
create or replace function claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ref uuid; me profiles; n int;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.referred_by is not null or me.created_at < now() - interval '1 day' then return false; end if;
  select id into v_ref from profiles where ref_code = upper(btrim(coalesce(p_code, ''))) and id <> me.id;
  if v_ref is null then return false; end if;
  perform set_config('biosyn.claim_referral', '1', true);
  update profiles set referred_by = v_ref where id = me.id and referred_by is null;
  get diagnostics n = row_count;
  perform set_config('biosyn.claim_referral', '', true);
  return n > 0;
end $$;
revoke execute on function claim_referral(text) from public, anon;
grant execute on function claim_referral(text) to authenticated;
