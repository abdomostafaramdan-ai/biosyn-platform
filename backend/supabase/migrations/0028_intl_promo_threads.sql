-- 1) Fixed international prices (any country but Egypt, shown in the visitor's currency)
-- 2) Instructor promo codes: subscriptions bought with an instructor's code pay that instructor 50% (per code)
-- 3) Threads: student <-> instructor course Q&A, and complaint/support tickets with the team

-- ---------- 1) international prices ----------
alter table plans   add column if not exists intl_price numeric(12,2) check (intl_price is null or intl_price >= 0);
alter table courses add column if not exists intl_price numeric(12,2) check (intl_price is null or intl_price >= 0);
update plans set intl_price = case duration_months when 1 then 20 when 6 then 100 when 12 then 200 else intl_price end where intl_price is null;

-- Arabs abroad: Europe, UK, North America, Australia get their own currency (FX ≈ late Oct 2026, editable in admin)
insert into price_regions (country, name, currency, symbol, factor, egp_rate, decimals) values
  ('GB','المملكة المتحدة','GBP','£',1,75.10,2), ('CH','سويسرا','CHF','CHF',1,70.00,2),
  ('US','الولايات المتحدة','USD','$',1,56.30,2), ('CA','كندا','CAD','C$',1,40.50,2), ('AU','أستراليا','AUD','A$',1,36.60,2),
  ('DE','ألمانيا','EUR','€',1,63.00,2), ('FR','فرنسا','EUR','€',1,63.00,2), ('NL','هولندا','EUR','€',1,63.00,2),
  ('BE','بلجيكا','EUR','€',1,63.00,2), ('IT','إيطاليا','EUR','€',1,63.00,2), ('ES','إسبانيا','EUR','€',1,63.00,2),
  ('AT','النمسا','EUR','€',1,63.00,2), ('IE','أيرلندا','EUR','€',1,63.00,2), ('FI','فنلندا','EUR','€',1,63.00,2),
  ('PT','البرتغال','EUR','€',1,63.00,2), ('GR','اليونان','EUR','€',1,63.00,2), ('LU','لوكسمبورغ','EUR','€',1,63.00,2),
  ('SE','السويد','EUR','€',1,63.00,2), ('DK','الدنمارك','EUR','€',1,63.00,2), ('NO','النرويج','EUR','€',1,63.00,2),
  ('PL','بولندا','EUR','€',1,63.00,2), ('CZ','التشيك','EUR','€',1,63.00,2), ('HU','المجر','EUR','€',1,63.00,2),
  ('RO','رومانيا','EUR','€',1,63.00,2), ('MT','مالطا','EUR','€',1,63.00,2), ('CY','قبرص','EUR','€',1,63.00,2)
on conflict (country) do nothing;

-- ---------- 2) instructor promo codes ----------
alter table coupons  add column if not exists instructor_id uuid references profiles(id) on delete set null;
alter table coupons  add column if not exists instructor_pct numeric(5,2) not null default 50 check (instructor_pct between 0 and 100);
alter table earnings add column if not exists promo_egp numeric(14,2) not null default 0;
alter table earnings add column if not exists promo_count int not null default 0;
create index if not exists coupons_instructor on coupons (instructor_id) where instructor_id is not null;

-- instructors read their own codes
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'coupons' and policyname = 'coupons_own_instructor') then
    create policy coupons_own_instructor on coupons for select to authenticated using (instructor_id = auth.uid());
  end if;
end $$;

-- month close: subscriptions bought with an instructor's code pay that instructor instructor_pct% of the price
-- and stay out of the shared views pool (so the same money is never shared twice)
create or replace function close_month(p_month date)
returns void language plpgsql security definer set search_path = public as $$
declare v_income numeric; v_total bigint; v_pct numeric;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'admin only'; end if;
  select coalesce(sum(p.amount_egp),0) into v_income
    from payments p left join coupons k on k.id = p.coupon_id
   where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = p_month
     and k.instructor_id is null;
  select count(*) into v_total from course_views cv join courses c on c.id = cv.course_id
    where cv.month = p_month and c.kind = 'recorded';
  select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) into v_pct;

  insert into month_pools (month, subscription_income, total_views, instructor_pct)
  values (p_month, v_income, v_total, v_pct)
  on conflict (month) do nothing;

  insert into earnings (instructor_id, month, instructor_views, amount_egp, promo_egp, promo_count)
  select coalesce(v.iid, pr.iid), p_month, coalesce(v.n, 0),
         round(coalesce(case when v_total > 0 then v_income / v_total * v.n * v_pct / 100 end, 0) + coalesce(pr.amt, 0), 2),
         round(coalesce(pr.amt, 0), 2), coalesce(pr.cnt, 0)
    from (select c.instructor_id iid, count(*) n from course_views cv join courses c on c.id = cv.course_id
           where cv.month = p_month and c.kind = 'recorded' and c.instructor_id is not null group by c.instructor_id) v
    full join (select k.instructor_id iid, sum(p.amount_egp * k.instructor_pct / 100) amt, count(*)::int cnt
                 from payments p join coupons k on k.id = p.coupon_id
                where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = p_month
                  and k.instructor_id is not null group by k.instructor_id) pr on pr.iid = v.iid
  on conflict (instructor_id, month) do nothing;
end $$;

-- live numbers for an instructor's codes (this month, not yet closed)
create or replace function my_promo_stats()
returns table (code text, percent_off int, instructor_pct numeric, uses_total bigint, uses_month bigint, earned_month numeric, active boolean)
language sql stable security definer set search_path = public as $$
  select k.code, k.percent_off, k.instructor_pct,
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid'),
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid' and p.paid_at >= date_trunc('month', now())),
         coalesce((select round(sum(p.amount_egp) * k.instructor_pct / 100, 2) from payments p
                    where p.coupon_id = k.id and p.status = 'paid' and p.purpose = 'subscription' and p.paid_at >= date_trunc('month', now())), 0),
         k.active
    from coupons k where k.instructor_id = auth.uid() order by k.created_at desc;
$$;
revoke execute on function my_promo_stats() from public, anon;
grant execute on function my_promo_stats() to authenticated;

-- ---------- 3) threads: course Q&A + tickets ----------
create table if not exists threads (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('course','ticket')),
  course_id       uuid references courses(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  instructor_id   uuid references profiles(id) on delete set null,
  subject         text not null check (length(subject) between 1 and 160),
  category        text check (category is null or category in ('payment','technical','content','instructor','account','other')),
  status          text not null default 'open' check (status in ('open','pending','resolved','closed')),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_sender     text check (last_sender in ('student','instructor','staff')),
  student_read_at timestamptz not null default now(),
  other_read_at   timestamptz not null default 'epoch'
);
create unique index if not exists threads_one_per_course on threads (course_id, student_id) where kind = 'course';
create index if not exists threads_student on threads (student_id, last_message_at desc);
create index if not exists threads_instructor on threads (instructor_id, last_message_at desc);
create index if not exists threads_kind on threads (kind, status, last_message_at desc);

create table if not exists thread_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references threads(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('student','instructor','staff')),
  body       text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists thread_messages_thread on thread_messages (thread_id, created_at);

alter table threads enable row level security;
alter table thread_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'threads' and policyname = 'threads_read') then
    create policy threads_read on threads for select to authenticated
      using (student_id = auth.uid() or instructor_id = auth.uid() or is_staff());
    create policy thread_messages_read on thread_messages for select to authenticated
      using (exists (select 1 from threads t where t.id = thread_id and (t.student_id = auth.uid() or t.instructor_id = auth.uid() or is_staff())));
  end if;
end $$;

-- the caller's role inside a thread (null = not a participant)
create or replace function thread_role(t threads) returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = t.student_id then 'student'
              when auth.uid() = t.instructor_id then 'instructor'
              when is_staff() then 'staff' end;
$$;

create or replace function post_message(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t threads; r text; v_id uuid; v_recent int;
begin
  select * into t from threads where id = p_thread for update;
  if t.id is null then raise exception 'not found'; end if;
  r := thread_role(t);
  if r is null then raise exception 'not allowed'; end if;
  if t.status = 'closed' and r = 'student' then raise exception 'thread closed'; end if;
  if nullif(btrim(coalesce(p_body,'')), '') is null then raise exception 'empty message'; end if;
  select count(*) into v_recent from thread_messages where sender_id = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent >= 15 then raise exception 'slow down'; end if;
  insert into thread_messages (thread_id, sender_id, role, body) values (p_thread, auth.uid(), r, left(btrim(p_body), 4000)) returning id into v_id;
  update threads set last_message_at = now(), last_sender = r,
         status = case when t.kind = 'ticket' then (case when r = 'student' then 'open' else 'pending' end)
                       else (case when r = 'student' then 'open' else 'resolved' end) end,
         student_read_at = case when r = 'student' then now() else student_read_at end,
         other_read_at   = case when r <> 'student' then now() else other_read_at end
   where id = p_thread;
  return v_id;
end $$;

create or replace function ask_instructor(p_course uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c courses; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select * into c from courses where id = p_course;
  if c.id is null then raise exception 'not found'; end if;
  if not (can_watch(auth.uid(), p_course) or is_staff()) then raise exception 'subscription required'; end if;
  select id into v_id from threads where kind = 'course' and course_id = p_course and student_id = auth.uid();
  if v_id is null then
    insert into threads (kind, course_id, student_id, instructor_id, subject)
    values ('course', p_course, auth.uid(), c.instructor_id, left(c.title, 160)) returning id into v_id;
  end if;
  if nullif(btrim(coalesce(p_body,'')), '') is not null then perform post_message(v_id, p_body); end if;
  return v_id;
end $$;

create or replace function open_ticket(p_subject text, p_category text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_open int;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if nullif(btrim(coalesce(p_subject,'')), '') is null or nullif(btrim(coalesce(p_body,'')), '') is null then raise exception 'missing info'; end if;
  select count(*) into v_open from threads where kind = 'ticket' and student_id = auth.uid() and created_at > now() - interval '1 day';
  if v_open >= 5 then raise exception 'too many tickets'; end if;
  insert into threads (kind, student_id, subject, category)
  values ('ticket', auth.uid(), left(btrim(p_subject), 160), coalesce(nullif(p_category,''), 'other')) returning id into v_id;
  perform post_message(v_id, p_body);
  return v_id;
end $$;

create or replace function mark_thread_read(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t threads; r text;
begin
  select * into t from threads where id = p_thread;
  r := thread_role(t);
  if r = 'student' then update threads set student_read_at = now() where id = p_thread;
  elsif r is not null then update threads set other_read_at = now() where id = p_thread; end if;
end $$;

create or replace function set_thread_status(p_thread uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare t threads; r text;
begin
  select * into t from threads where id = p_thread;
  r := thread_role(t);
  if r is null then raise exception 'not allowed'; end if;
  if r = 'student' and p_status not in ('resolved','closed') then raise exception 'not allowed'; end if;
  if p_status not in ('open','pending','resolved','closed') then raise exception 'bad status'; end if;
  update threads set status = p_status where id = p_thread;
end $$;

-- unread counters for the nav badges
create or replace function my_unread() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'student', (select count(*) from threads where student_id = auth.uid() and last_message_at > student_read_at and last_sender <> 'student'),
    'instructor', (select count(*) from threads where instructor_id = auth.uid() and last_message_at > other_read_at and last_sender = 'student'),
    'tickets', case when is_staff() then (select count(*) from threads where kind = 'ticket' and status = 'open') else 0 end,
    'course_unanswered', case when is_staff() then (select count(*) from threads where kind = 'course' and instructor_id is null and status = 'open') else 0 end);
$$;

revoke execute on function thread_role(threads), post_message(uuid, text), ask_instructor(uuid, text), open_ticket(text, text, text),
  mark_thread_read(uuid), set_thread_status(uuid, text), my_unread() from public, anon;
grant execute on function post_message(uuid, text), ask_instructor(uuid, text), open_ticket(text, text, text),
  mark_thread_read(uuid), set_thread_status(uuid, text), my_unread() to authenticated;

-- email whoever is on the other side (at most one email per thread per recipient every 15 minutes)
create or replace function trg_mail_thread_message() returns trigger language plpgsql security definer set search_path = public as $$
declare t threads; v_to text; v_link text; v_title text; v_slot text := floor(extract(epoch from now()) / 900)::text;
begin
  select * into t from threads where id = new.thread_id;
  v_title := case when t.kind = 'ticket' then 'تذكرة: ' || t.subject else 'سؤال في كورس ' || t.subject end;
  if new.role = 'student' then
    if t.kind = 'course' and t.instructor_id is not null then
      select email into v_to from auth.users where id = t.instructor_id;
      perform enqueue_email('thr:' || t.id || ':i:' || v_slot, v_to, 'سؤال جديد من طالب: ' || t.subject,
        email_html('عندك سؤال جديد من طالب', array['الكورس: <b>' || esc_html(t.subject) || '</b>', esc_html(left(new.body, 400))], 'افتح الرسائل', 'instructor.html#messages'));
    else
      perform notify_team('thr:' || t.id || ':t:' || v_slot, v_title,
        email_html(case when t.kind = 'ticket' then 'تذكرة/شكوى جديدة' else 'سؤال طالب في كورس بدون محاضر مربوط' end,
          array['الموضوع: <b>' || esc_html(t.subject) || '</b>', esc_html(left(new.body, 400))], 'افتح الداشبورد', 'admin.html#tickets'));
    end if;
  else
    select email into v_to from auth.users where id = t.student_id;
    perform enqueue_email('thr:' || t.id || ':s:' || v_slot, v_to, case when t.kind = 'ticket' then 'رد على تذكرتك: ' || t.subject else 'المحاضر رد على سؤالك' end,
      email_html(case when t.kind = 'ticket' then 'فريق Biosyn رد على تذكرتك' else 'المحاضر رد على سؤالك' end,
        array[esc_html(t.subject), esc_html(left(new.body, 400))], 'افتح الرسائل', 'account.html#messages'));
  end if;
  return new;
end $$;
create or replace trigger mail_thread_message after insert on thread_messages for each row execute function trg_mail_thread_message();
revoke execute on function trg_mail_thread_message() from public, anon, authenticated;

-- student name snapshot (instructors can't read other profiles)
alter table threads add column if not exists student_name text;
create or replace function trg_thread_student_name() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.student_name is null then select nullif(full_name,'') into new.student_name from profiles where id = new.student_id; end if;
  return new;
end $$;
create or replace trigger thread_student_name before insert on threads for each row execute function trg_thread_student_name();
revoke execute on function trg_thread_student_name() from public, anon, authenticated;
