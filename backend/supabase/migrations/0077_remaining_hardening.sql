-- 0077 (applied live): remaining hardening
-- 1) request_thread links only to a CONFIRMED account matching the request email
create or replace function public.request_thread(p_request uuid, p_subject text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare r requests; v_id uuid; v_user uuid;
begin
  if not is_staff() then raise exception 'not allowed'; end if;
  select * into r from requests where id = p_request; if r.id is null then raise exception 'not found'; end if;
  select id into v_id from threads where request_id = p_request order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  v_user := coalesce(r.user_id, (select id from auth.users where lower(email) = lower(btrim(r.email)) and email_confirmed_at is not null limit 1));
  if v_user is null and nullif(btrim(coalesce(r.email, '')), '') is null then raise exception 'no contact'; end if;
  insert into threads (kind, category, subject, student_id, student_name, request_id, contact_email, status, last_message_at, last_sender)
  values ('ticket', 'request', left(coalesce(nullif(btrim(p_subject), ''), 'بخصوص طلبك'), 160), v_user, r.name, r.id, lower(btrim(r.email)), 'pending', now(), 'staff')
  returning id into v_id;
  if r.status::text = 'new' then update requests set status = 'in_review' where id = r.id; end if;
  return v_id;
end $function$;

-- 2) support (non-admin) can only change workflow columns on requests / other users' proposals
create or replace function public.trg_requests_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated','anon') and not is_admin() then
    new.type := old.type; new.user_id := old.user_id; new.name := old.name; new.email := old.email;
    new.phone := old.phone; new.payload := old.payload; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists requests_guard on public.requests;
create trigger requests_guard before update on public.requests for each row execute function public.trg_requests_guard();

create or replace function public.trg_cp_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated','anon') and not is_admin() and old.user_id is distinct from auth.uid() then
    new.user_id := old.user_id; new.name := old.name; new.email := old.email; new.phone := old.phone;
    new.title := old.title; new.specialty := old.specialty; new.faculty := old.faculty; new.level := old.level;
    new.audience := old.audience; new.summary := old.summary; new.description := old.description;
    new.submitted_at := old.submitted_at; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists cp_guard on public.course_proposals;
create trigger cp_guard before update on public.course_proposals for each row execute function public.trg_cp_guard();
revoke execute on function public.trg_requests_guard(), public.trg_cp_guard() from public, anon, authenticated;

-- 3) submit_form: extra per-source (user id or IP) daily cap of 40 per form, inserted before `meta := ...`
--    (applied live by patching the existing function body; see git history of submit_form for the base version)
