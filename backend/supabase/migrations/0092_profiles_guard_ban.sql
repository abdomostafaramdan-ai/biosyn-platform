-- profiles: signed-in users may edit their own name/phone/etc., but never the ban fields or their unsubscribe token.
-- apply_user_ban() (which can run inside the student's own request) marks itself with biosyn.ban so the trigger lets it through.
create or replace function public.trg_profiles_guard()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if not is_admin() and coalesce(auth.role(), '') = 'authenticated' then
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
end $function$;

create or replace function public.apply_user_ban(p_user uuid, p_reason text, p_by uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
begin
  perform set_config('biosyn.ban', '1', true);
  update profiles set banned_at = coalesce(banned_at, now()), banned_reason = left(p_reason, 300) where id = p_user;
  perform set_config('biosyn.ban', '', true);
  update subscriptions
     set status = 'cancelled', cancelled_at = now(),
         starts_at = least(starts_at, now() - interval '1 second'), ends_at = least(ends_at, now() - interval '1 second'),
         paused_at = null, pause_offset = null, pause_remaining = null
   where user_id = p_user and ((status = 'active' and ends_at > now()) or status = 'paused');
  if found then
    insert into subscription_events (user_id, action, note, by_user) values (p_user, 'cancel', 'حظر: ' || left(p_reason, 200), p_by);
  end if;
  update auth.users set banned_until = 'infinity' where id = p_user;
end $function$;
revoke all on function public.apply_user_ban(uuid, text, uuid) from public, anon, authenticated;
