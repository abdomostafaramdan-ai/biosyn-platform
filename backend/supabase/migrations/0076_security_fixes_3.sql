-- 0076: security fixes round 3 (independent verifier findings)

-- my_email(): only a confirmed address may grant form-collaborator access.
create or replace function public.my_email() returns text language sql stable security definer set search_path to 'public' as $$
  select lower(email::text) from auth.users where id = auth.uid() and email_confirmed_at is not null;
$$;

-- Sign-up triggers link legacy contacts / contact threads by e-mail: only for CONFIRMED addresses.
create or replace function public.trg_legacy_activate() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  update legacy_users set status = 'activated', user_id = new.id, activated_at = now(),
         founding = now() <= coalesce(sent_at, now()) + make_interval(days => coalesce((select (data->>'founder_days')::int from site_content where key = 'reactivation'), 14))
   where lower(btrim(email)) = lower(btrim(new.email)) and user_id is null;
  return new;
exception when others then return new;
end $$;

create or replace function public.trg_link_contact_threads() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  update threads set student_id = new.id where student_id is null and lower(contact_email) = lower(btrim(new.email));
  return new;
exception when others then return new;
end $$;

create trigger legacy_activate_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function public.trg_legacy_activate();
create trigger link_contact_threads_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function public.trg_link_contact_threads();
revoke execute on function public.trg_legacy_activate(), public.trg_link_contact_threads() from public, anon, authenticated;

-- Form editors (collaborators) may change questions/settings, not the owner-level columns.
create or replace function public.trg_forms_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    new.slug := old.slug; new.active := old.active; new.notify := old.notify;
  end if;
  return new;
end $$;
create trigger forms_guard before update on public.forms for each row execute function public.trg_forms_guard();

-- Editors / staff editing a response through the API may only change its status, never score, answers or owner.
-- (security definer functions such as submit_form_graded run as the owner and are not affected.)
create or replace function public.trg_fs_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    new.data := old.data; new.score := old.score; new.max_score := old.max_score; new.graded := old.graded;
    new.user_id := old.user_id; new.form_id := old.form_id;
  end if;
  return new;
end $$;
create trigger fs_guard before update on public.form_submissions for each row execute function public.trg_fs_guard();
revoke execute on function public.trg_forms_guard(), public.trg_fs_guard() from public, anon, authenticated;

-- Rate limits: key on the address Cloudflare sets (cf-connecting-ip), not the client-supplied X-Forwarded-For entry.
create or replace function public.request_rate_ok() returns boolean language sql security definer set search_path to 'public' as $$
  select chat_hit('rq:' || coalesce(nullif(current_setting('request.headers', true)::json->>'cf-connecting-ip', ''),
                                    split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'na'), ',', 1)), 30)
     and chat_hit('rq:all', 3000);
$$;

-- request_payout: take the amount from the rows actually claimed.
create or replace function public.request_payout(p_method text) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_amount numeric; v_last timestamptz; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || auth.uid()::text));
  select max(requested_at) into v_last from payouts where instructor_id = auth.uid() and status <> 'rejected';
  if v_last is not null and now() < v_last + interval '3 months' then
    raise exception 'next withdrawal available on %', (v_last + interval '3 months')::date;
  end if;
  if not exists (select 1 from earnings where instructor_id = auth.uid() and payout_id is null and amount_egp > 0) then raise exception 'no available balance'; end if;
  insert into payouts (instructor_id, amount_egp, method) values (auth.uid(), 0, left(p_method, 40)) returning id into v_id;
  with c as (update earnings set payout_id = v_id where instructor_id = auth.uid() and payout_id is null returning amount_egp)
    select coalesce(sum(amount_egp), 0) into v_amount from c;
  if v_amount <= 0 then raise exception 'no available balance'; end if;
  update payouts set amount_egp = v_amount where id = v_id;
  return v_id;
end $function$;

-- ===== 0076b (applied live): guards run SECURITY INVOKER so current_user = API caller =====
create or replace function public.trg_forms_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    new.slug := old.slug; new.active := old.active; new.notify := old.notify;
  end if;
  return new;
end $$;
create or replace function public.trg_fs_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    new.data := old.data; new.score := old.score; new.max_score := old.max_score; new.graded := old.graded;
    new.user_id := old.user_id; new.form_id := old.form_id;
  end if;
  return new;
end $$;
revoke execute on function public.trg_forms_guard() from public, anon, authenticated;
revoke execute on function public.trg_fs_guard() from public, anon, authenticated;

-- ===== 0076c (applied live): payouts.amount_egp has CHECK (> 0) -> 0.01 placeholder, then real total =====
create or replace function public.request_payout(p_method text) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_amount numeric; v_last timestamptz; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || auth.uid()::text));
  select max(requested_at) into v_last from payouts where instructor_id = auth.uid() and status <> 'rejected';
  if v_last is not null and now() < v_last + interval '3 months' then
    raise exception 'next withdrawal available on %', (v_last + interval '3 months')::date;
  end if;
  if not exists (select 1 from earnings where instructor_id = auth.uid() and payout_id is null and amount_egp > 0) then raise exception 'no available balance'; end if;
  insert into payouts (instructor_id, amount_egp, method) values (auth.uid(), 0.01, left(p_method, 40)) returning id into v_id;
  with c as (update earnings set payout_id = v_id where instructor_id = auth.uid() and payout_id is null returning amount_egp)
    select coalesce(sum(amount_egp), 0) into v_amount from c;
  if v_amount <= 0 then raise exception 'no available balance'; end if;
  update payouts set amount_egp = v_amount where id = v_id;
  return v_id;
end $$;
revoke execute on function public.request_payout(text) from public, anon;
