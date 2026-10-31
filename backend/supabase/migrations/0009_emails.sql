-- Transactional emails: an outbox filled by triggers, sent by the send-emails Edge Function (Resend).
create extension if not exists pg_net;

create table if not exists app_settings (key text primary key, value text);
alter table app_settings enable row level security;
create policy app_settings_admin on app_settings for all to authenticated using (is_admin()) with check (is_admin());
-- notify_email: where the team gets alerts (new payment / new request). site_url: used for links inside emails.
insert into app_settings (key, value) values ('notify_email', null), ('site_url', null) on conflict do nothing;

create table if not exists email_outbox (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  to_email    text not null,
  subject     text not null,
  body_html   text not null,
  status      text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table email_outbox enable row level security;
create policy email_outbox_staff_read on email_outbox for select to authenticated using (is_staff());

create or replace function esc_html(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t,''), '&','&amp;'), '<','&lt;'), '>','&gt;');
$$;

create or replace function email_html(p_heading text, p_lines text[], p_link_label text default null, p_link_path text default null)
returns text language plpgsql stable set search_path = public as $$
declare v_site text; v_body text := ''; l text;
begin
  select value into v_site from app_settings where key = 'site_url';
  foreach l in array p_lines loop v_body := v_body || '<p style="margin:0 0 12px;font-size:15px;line-height:26px">' || l || '</p>'; end loop;
  if p_link_label is not null and nullif(v_site,'') is not null then
    v_body := v_body || '<p style="margin:20px 0"><a href="' || rtrim(v_site,'/') || '/' || coalesce(p_link_path,'') ||
      '" style="background:#c6f84a;color:#010232;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">' || esc_html(p_link_label) || '</a></p>';
  end if;
  return '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f4f5fa;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:14px;padding:28px;color:#10123a">' ||
    '<div style="font-weight:800;font-size:18px;color:#010232;margin-bottom:16px">BIOSYN</div>' ||
    '<h2 style="margin:0 0 16px;font-size:20px">' || esc_html(p_heading) || '</h2>' || v_body ||
    '<hr style="border:none;border-top:1px solid #e5e6f0;margin:24px 0"><p style="margin:0;font-size:12px;color:#6b6e8f">Biosyn Egypt · تعليم علمي بمحتوى مهني</p></div></div>';
end $$;

create or replace function enqueue_email(p_key text, p_to text, p_subject text, p_html text) returns void
language sql security definer set search_path = public as $$
  insert into email_outbox (dedupe_key, to_email, subject, body_html)
  select p_key, p_to, p_subject, p_html where nullif(btrim(p_to),'') is not null
  on conflict (dedupe_key) do nothing;
$$;

create or replace function notify_team(p_key text, p_subject text, p_html text) returns void
language sql security definer set search_path = public as $$
  select enqueue_email(p_key, (select value from app_settings where key = 'notify_email'), p_subject, p_html);
$$;

-- ---------- triggers ----------
create or replace function trg_mail_subscription() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_plan text; v_p payments; v_name text;
begin
  select email into v_email from auth.users where id = new.user_id;
  select name into v_plan from plans where id = new.plan_id;
  select * into v_p from payments where id = new.payment_id;
  select coalesce(full_name,'') into v_name from profiles where id = new.user_id;
  perform enqueue_email('pay:' || new.payment_id, v_email, 'تم تأكيد اشتراكك في Biosyn',
    email_html('تم تأكيد الدفع ✓', array[
      'أهلاً ' || esc_html(v_name) || '،',
      'تم استلام دفعتك وتفعيل اشتراكك في <b>' || esc_html(v_plan) || '</b>.',
      'المبلغ المدفوع: <b>' || (coalesce(v_p.amount_egp,0) + coalesce(v_p.fee_egp,0)) || ' ج.م</b>' ||
        case when coalesce(v_p.discount_egp,0) > 0 then ' (بعد خصم ' || v_p.discount_egp || ' ج.م)' else '' end,
      'اشتراكك ساري من ' || to_char(new.starts_at at time zone 'Africa/Cairo','YYYY-MM-DD') || ' حتى <b>' || to_char(new.ends_at at time zone 'Africa/Cairo','YYYY-MM-DD') || '</b>.',
      'الاشتراك لا يتجدد تلقائيًا، وسنذكّرك قبل انتهائه.'], 'ابدأ التعلّم', 'courses.html'));
  perform notify_team('pay-team:' || new.payment_id, 'دفعة جديدة: ' || coalesce(v_plan,''),
    email_html('دفعة اشتراك جديدة', array[esc_html(v_plan) || ' · ' || coalesce(v_p.amount_egp,0) || ' ج.م · ' || esc_html(v_email)]));
  return new;
end $$;
drop trigger if exists mail_subscription on subscriptions;
create trigger mail_subscription after insert on subscriptions for each row execute function trg_mail_subscription();

create or replace function trg_mail_enrollment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_title text; v_p payments;
begin
  select email into v_email from auth.users where id = new.user_id;
  select title into v_title from courses where id = new.course_id;
  select * into v_p from payments where id = new.payment_id;
  perform enqueue_email('pay:' || coalesce(new.payment_id::text, new.user_id || ':' || new.course_id), v_email, 'تم تسجيلك في ' || v_title,
    email_html('تم تأكيد تسجيلك ✓', array[
      'تم تسجيلك في الدورة التفاعلية <b>' || esc_html(v_title) || '</b>.',
      'المبلغ المدفوع: <b>' || (coalesce(v_p.amount_egp,0) + coalesce(v_p.fee_egp,0)) || ' ج.م</b>.',
      'يمكنك استرداد رسوم الدورة التفاعلية خلال 7 أيام من تاريخ الدفع. سنوافيك بتفاصيل المواعيد قريبًا.'], 'حسابي', 'account.html'));
  perform notify_team('enr-team:' || new.user_id || ':' || new.course_id, 'تسجيل جديد: ' || coalesce(v_title,''),
    email_html('تسجيل في دورة تفاعلية', array[esc_html(v_title) || ' · ' || esc_html(v_email)]));
  return new;
end $$;
drop trigger if exists mail_enrollment on enrollments;
create trigger mail_enrollment after insert on enrollments for each row execute function trg_mail_enrollment();

create or replace function trg_mail_certificate() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_title text;
begin
  select email into v_email from auth.users where id = new.user_id;
  select title into v_title from courses where id = new.course_id;
  perform enqueue_email('cert:' || new.id, v_email, 'مبروك! شهادتك جاهزة',
    email_html('أتممت الدورة 🎓', array['أنهيت كل محاضرات <b>' || esc_html(v_title) || '</b> وأصبحت شهادتك جاهزة للتحميل.'], 'شهاداتي', 'account.html#certificates'));
  return new;
end $$;
drop trigger if exists mail_certificate on certificates;
create trigger mail_certificate after insert on certificates for each row execute function trg_mail_certificate();

create or replace function trg_mail_earning() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = new.instructor_id;
  perform enqueue_email('earn:' || new.id, v_email, 'تم احتساب أرباح شهر ' || to_char(new.month,'YYYY-MM'),
    email_html('أرباح جديدة', array[
      'تم احتساب أرباحك عن شهر <b>' || to_char(new.month,'YYYY-MM') || '</b>: <b>' || new.amount_egp || ' ج.م</b> (' || new.instructor_views || ' مشاهدة معتمدة).',
      'يمكنك طلب سحب رصيدك المتراكم مرة كل 3 أشهر من لوحة المحاضر.'], 'لوحة المحاضر', 'instructor.html'));
  return new;
end $$;
drop trigger if exists mail_earning on earnings;
create trigger mail_earning after insert on earnings for each row execute function trg_mail_earning();

create or replace function trg_mail_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_team('req:' || new.id, 'طلب جديد: ' || new.type::text,
    email_html('طلب جديد في الصندوق', array['النوع: <b>' || esc_html(new.type::text) || '</b>', 'الاسم: ' || esc_html(new.name), 'البريد: ' || esc_html(new.email), 'الهاتف: ' || esc_html(new.phone)], 'صندوق الطلبات', 'admin.html'));
  return new;
end $$;
drop trigger if exists mail_request on requests;
create trigger mail_request after insert on requests for each row execute function trg_mail_request();

-- ---------- expiry reminders (subscriptions do not auto-renew) ----------
create or replace function enqueue_expiry_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d int;
begin
  for r in
    select s.id, s.user_id, s.ends_at, u.email, pl.name as plan_name,
           (s.ends_at at time zone 'Africa/Cairo')::date - (now() at time zone 'Africa/Cairo')::date as days_left
      from subscriptions s join auth.users u on u.id = s.user_id join plans pl on pl.id = s.plan_id
     where s.ends_at > now() and s.ends_at <= now() + interval '8 days'
       and not exists (select 1 from subscriptions s2 where s2.user_id = s.user_id and s2.ends_at > s.ends_at)
  loop
    d := r.days_left;
    if d in (7, 1) then
      perform enqueue_email('sub' || d || ':' || r.id, r.email,
        case when d = 1 then 'اشتراكك ينتهي غدًا' else 'اشتراكك ينتهي بعد 7 أيام' end,
        email_html(case when d = 1 then 'اشتراكك ينتهي غدًا' else 'اشتراكك ينتهي بعد أسبوع' end, array[
          'اشتراكك في <b>' || esc_html(r.plan_name) || '</b> ينتهي يوم <b>' || to_char(r.ends_at at time zone 'Africa/Cairo','YYYY-MM-DD') || '</b>.',
          'الاشتراك لا يتجدد تلقائيًا. جدّد الآن عشان تكمل دراستك من غير انقطاع، وأي مدة جديدة تبدأ بعد انتهاء الحالية مباشرة.'], 'جدّد اشتراكك', 'pricing.html'));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- sending ----------
create or replace function claim_emails(p_n int default 20) returns setof email_outbox
language plpgsql security definer set search_path = public as $$
begin
  update email_outbox set status = 'pending' where status = 'sending' and created_at < now() - interval '15 minutes' and sent_at is null;
  return query
    update email_outbox e set status = 'sending', attempts = e.attempts + 1
     where e.id in (select id from email_outbox where status = 'pending' and attempts < 5 order by created_at limit p_n for update skip locked)
    returning e.*;
end $$;

revoke execute on function enqueue_email(text,text,text,text), notify_team(text,text,text), enqueue_expiry_reminders(), claim_emails(int),
  email_html(text,text[],text,text), esc_html(text) from public, anon, authenticated;
grant execute on function enqueue_email(text,text,text,text), notify_team(text,text,text), enqueue_expiry_reminders(), claim_emails(int) to service_role;

select cron.schedule('enqueue-expiry-reminders', '0 6 * * *', $$select enqueue_expiry_reminders()$$);
select cron.schedule('flush-emails', '*/5 * * * *', $$
  select net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/send-emails',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)
   where exists (select 1 from public.email_outbox where status = 'pending' and attempts < 5)
$$);
