-- Certificates v2: printable design page, name frozen on the certificate, interactive courses issue automatically on their end date.

-- course facts printed on the certificate
alter table courses add column if not exists ends_at timestamptz;
alter table courses add column if not exists hours numeric(6,1);

-- the name the student wants printed (English letters). Falls back to full_name.
alter table profiles add column if not exists cert_name text;

-- the name is copied onto the certificate when it is issued, so editing the profile later can't rewrite old certificates
alter table certificates add column if not exists holder_name text;

create or replace function trg_cert_holder() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.holder_name, '')), '') is null then
    select coalesce(nullif(btrim(p.cert_name), ''), nullif(btrim(p.full_name), '')) into new.holder_name from profiles p where p.id = new.user_id;
  end if;
  return new;
end $$;
create or replace trigger cert_holder before insert on certificates for each row execute function trg_cert_holder();
revoke execute on function trg_cert_holder() from public, anon, authenticated;

update certificates ce set holder_name = coalesce(nullif(btrim(p.cert_name), ''), nullif(btrim(p.full_name), ''))
  from profiles p where p.id = ce.user_id and ce.holder_name is null;

-- the student can fix the printed name only while it is still empty (e.g. signed up without a name)
create or replace function set_certificate_name(p_cert uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولاً'; end if;
  if length(v) < 3 or length(v) > 80 then raise exception 'اكتب الاسم كاملًا (من 3 إلى 80 حرف).'; end if;
  update certificates set holder_name = v
   where id = p_cert and user_id = auth.uid() and nullif(btrim(coalesce(holder_name, '')), '') is null;
  if not found then raise exception 'الاسم مثبت على الشهادة بالفعل. للتعديل تواصل مع الدعم.'; end if;
end $$;
revoke execute on function set_certificate_name(uuid, text) from public, anon;
grant execute on function set_certificate_name(uuid, text) to authenticated;

-- public verification: everything the certificate page needs (no e-mail, no ids)
create or replace function verify_certificate(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
      'name', coalesce(nullif(btrim(ce.holder_name), ''), nullif(btrim(p.cert_name), ''), p.full_name),
      'course', c.title, 'kind', c.kind, 'issued_at', ce.issued_at, 'code', ce.code,
      'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'hours', coalesce(c.hours, case when c.kind = 'recorded' then
                 round((select sum(l.duration_seconds) from lectures l where l.course_id = c.id) / 3600.0, 1) end))
    from certificates ce join profiles p on p.id = ce.user_id join courses c on c.id = ce.course_id
   where ce.code = upper(btrim(p_code));
$$;
grant execute on function verify_certificate(text) to anon, authenticated;

-- interactive courses: every enrolled (paid) student gets the certificate once the course end date passes
create or replace function issue_interactive_certificates() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into certificates (user_id, course_id, issued_at)
  select e.user_id, e.course_id, least(c.ends_at, now())
    from enrollments e join courses c on c.id = e.course_id
   where c.kind = 'interactive' and c.ends_at is not null and c.ends_at <= now()
  on conflict (user_id, course_id) do nothing;
  get diagnostics n = row_count;
  update enrollments e set completed_at = coalesce(e.completed_at, c.ends_at)
    from courses c where c.id = e.course_id and c.kind = 'interactive' and c.ends_at <= now() and e.completed_at is null;
  return n;
end $$;
revoke execute on function issue_interactive_certificates() from public, anon, authenticated;

select cron.unschedule('issue-interactive-certificates') where exists (select 1 from cron.job where jobname = 'issue-interactive-certificates');
select cron.schedule('issue-interactive-certificates', '7 * * * *', 'select issue_interactive_certificates()');

-- certificate e-mail: new design link + wording per course type
create or replace function trg_mail_certificate() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; c courses;
begin
  select email into v_email from auth.users where id = new.user_id;
  select * into c from courses where id = new.course_id;
  perform enqueue_email('cert:' || new.id, v_email, 'مبروك! شهادتك من Biosyn جاهزة 🎓',
    email_html('شهادتك جاهزة 🎓', array[
      case when c.kind = 'interactive'
        then 'مبروك! خلّصت الكورس التفاعلي <b>' || esc_html(c.title) || '</b>، وشهادة الإتمام بتاعتك اتصدرت.'
        else 'مبروك! خلّصت كل محاضرات <b>' || esc_html(c.title) || '</b>، وشهادة الإتمام بتاعتك اتصدرت.' end,
      'تقدر تفتحها وتحمّلها PDF أو تطبعها، وكمان تشاركها على LinkedIn. كل شهادة ليها رقم وكود QR عشان أي حد يتأكد إنها حقيقية.',
      'رقم الشهادة: <b dir="ltr">' || esc_html(new.code) || '</b>'],
      'افتح شهادتي', 'certificate.html?c=' || new.code));
  return new;
end $$;
revoke execute on function trg_mail_certificate() from public, anon, authenticated;

-- dashboard notification: same, pointing at the certificate itself
create or replace function cert_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  select title into v_title from courses where id = new.course_id;
  perform notify_user(new.user_id, 'n:cert:' || new.id, 'success', 'شهادتك جاهزة 🎓',
    'اتصدرت شهادة إتمام ' || coalesce(v_title, 'الكورس') || '. افتحها وحمّلها.', 'certificate.html?c=' || new.code);
  return new;
end $$;
revoke execute on function cert_notify() from public, anon, authenticated;
drop trigger if exists notify_certificate on certificates;
create trigger notify_certificate after insert on certificates for each row execute function cert_notify();
