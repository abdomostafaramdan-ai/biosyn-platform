-- Biosyn Egypt platform schema (Supabase / Postgres 15+)
-- Separate Supabase project from the CRM. Prices live in tables, never in code.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type user_role      as enum ('student','instructor','support','admin');
create type course_kind    as enum ('recorded','interactive');
create type course_status  as enum ('draft','review','published','archived');
create type gateway        as enum ('stripe','fawaterk','paymob');
create type pay_purpose    as enum ('subscription','interactive_course');
create type pay_status     as enum ('pending','paid','failed','refunded');
create type request_type   as enum ('instructor_recorded','instructor_interactive','institution','consultation');
create type request_status as enum ('new','in_review','accepted','rejected');
create type payout_status  as enum ('requested','approved','paid','rejected');

-- ---------- users ----------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  whatsapp    text,
  country     text,
  role        user_role not null default 'student',
  created_at  timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','support'));
$$;
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- new auth user -> profile
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- plans & subscriptions (no auto-renew, no refund) ----------
create table plans (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,            -- monthly | semiannual | annual
  name            text not null,
  duration_months int  not null check (duration_months > 0),
  price_egp       numeric(12,2) not null check (price_egp >= 0),
  old_price_egp   numeric(12,2),
  active          boolean not null default true
);

-- ---------- courses ----------
create table courses (
  id            uuid primary key default gen_random_uuid(),
  kind          course_kind not null,
  slug          text unique not null,
  title         text not null,
  summary       text,
  specialty     text,
  instructor_id uuid references profiles(id),
  status        course_status not null default 'draft',
  price_egp     numeric(12,2),                     -- interactive only; recorded courses are inside plans
  starts_at     timestamptz,                       -- interactive only
  seats         int,                               -- interactive only
  created_at    timestamptz not null default now(),
  check ((kind = 'recorded' and price_egp is null) or kind = 'interactive')
);

create table lectures (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references courses(id) on delete cascade,
  position         int  not null,
  title            text not null,
  duration_seconds int,
  unique (course_id, position)
);

-- Bunny Stream video GUIDs are kept apart so students can never read them directly;
-- the get-playback function (service role) returns a signed URL only after can_watch().
create table lecture_videos (
  lecture_id     uuid primary key references lectures(id) on delete cascade,
  bunny_video_id text not null
);

-- ---------- payments ----------
create table payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id),
  gateway      gateway not null,
  gateway_ref  text,                               -- id on the gateway side
  purpose      pay_purpose not null,
  plan_id      uuid references plans(id),
  course_id    uuid references courses(id),
  amount_egp   numeric(12,2) not null check (amount_egp >= 0),   -- price of the plan/course (what earnings are computed on)
  fee_egp      numeric(12,2) not null default 0 check (fee_egp >= 0), -- gateway fee added on top and paid by the customer
  status       pay_status not null default 'pending',
  paid_at      timestamptz,
  refunded_at  timestamptz,
  created_at   timestamptz not null default now(),
  check ((purpose = 'subscription' and plan_id is not null and course_id is null)
      or (purpose = 'interactive_course' and course_id is not null and plan_id is null)),
  unique (gateway, gateway_ref)
);

-- refund rule: interactive courses only, within 7 days of payment; subscriptions never
create or replace function is_refundable(p payments) returns boolean
language sql stable set search_path = public as $$
  select p.purpose = 'interactive_course' and p.status = 'paid'
     and p.paid_at is not null and now() <= p.paid_at + interval '7 days';
$$;

-- idempotency for gateway webhooks
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  gateway      gateway not null,
  event_id     text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (gateway, event_id)
);

create table subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id),
  plan_id    uuid not null references plans(id),
  payment_id uuid not null references payments(id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,                 -- subscription simply ends; never renews by itself
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on subscriptions (user_id, ends_at desc);

create table enrollments (                          -- interactive course seats
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id),
  course_id    uuid not null references courses(id),
  payment_id   uuid not null references payments(id),
  completed_at timestamptz,
  unique (user_id, course_id)
);

create or replace function has_active_subscription(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions where user_id = uid and now() between starts_at and ends_at);
$$;

create or replace function can_watch(uid uuid, cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.status = 'published' and (
           (c.kind = 'recorded'    and has_active_subscription(uid))
        or (c.kind = 'interactive' and exists (select 1 from enrollments e where e.user_id = uid and e.course_id = cid))));
$$;

-- ---------- progress, valid views, certificates ----------
create table lecture_progress (
  user_id      uuid not null references profiles(id) on delete cascade,
  lecture_id   uuid not null references lectures(id) on delete cascade,
  max_pct      numeric(5,2) not null default 0 check (max_pct between 0 and 100),
  completed    boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lecture_id)
);

-- valid view = student reached >= 50% of a lecture; counted ONCE per course (not per lecture).
-- ASSUMPTION (confirm): one valid view per student per course per calendar month.
create table course_views (
  user_id   uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id)  on delete cascade,
  month     date not null,                          -- first day of month
  counted_at timestamptz not null default now(),
  primary key (user_id, course_id, month)
);

create or replace function record_progress(p_lecture uuid, p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_kind course_kind; v_total int;
begin
  select l.course_id, c.kind into v_course, v_kind
    from lectures l join courses c on c.id = l.course_id where l.id = p_lecture;
  if v_course is null or not can_watch(auth.uid(), v_course) then
    raise exception 'not allowed';
  end if;

  insert into lecture_progress (user_id, lecture_id, max_pct, completed)
  values (auth.uid(), p_lecture, least(p_pct,100), p_pct >= 95)
  on conflict (user_id, lecture_id) do update
    set max_pct   = greatest(lecture_progress.max_pct, least(p_pct,100)),
        completed = lecture_progress.completed or p_pct >= 95,
        updated_at = now();

  -- valid view counts for recorded courses only (interactive courses have separate agreements)
  if v_kind = 'recorded' and p_pct >= 50 then
    insert into course_views (user_id, course_id, month)
    values (auth.uid(), v_course, date_trunc('month', now())::date)
    on conflict do nothing;
  end if;

  -- certificate when the course is finished (all lectures completed)
  select count(*) into v_total from lectures where course_id = v_course;
  if v_total > 0 and (select count(*) from lecture_progress lp join lectures l on l.id = lp.lecture_id
                      where lp.user_id = auth.uid() and l.course_id = v_course and lp.completed) = v_total then
    insert into certificates (user_id, course_id) values (auth.uid(), v_course) on conflict do nothing;
  end if;
end $$;

create table certificates (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id),
  course_id uuid not null references courses(id),
  issued_at timestamptz not null default now(),
  unique (user_id, course_id)
);

-- ---------- instructor earnings: accrue monthly, withdraw every 3 months ----------
create table month_pools (                          -- one row per month, filled by the monthly job
  month             date primary key,
  subscription_income numeric(14,2) not null,       -- revenue from plans in that month
  total_views       bigint not null,
  instructor_pct    numeric(5,2) not null default 30,
  closed_at         timestamptz not null default now()
);

create table payouts (
  id            uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references profiles(id),
  amount_egp    numeric(14,2) not null check (amount_egp > 0),
  method        text not null,                      -- bank / wallet details reference
  status        payout_status not null default 'requested',
  requested_at  timestamptz not null default now(),
  paid_at       timestamptz
);

create table earnings (
  id             uuid primary key default gen_random_uuid(),
  instructor_id  uuid not null references profiles(id),
  month          date not null references month_pools(month),
  instructor_views bigint not null,
  amount_egp     numeric(14,2) not null,            -- income / total_views * instructor_views * pct/100
  payout_id      uuid references payouts(id),       -- set when included in a payout
  unique (instructor_id, month)
);

create or replace function close_month(p_month date)
returns void language plpgsql security definer set search_path = public as $$
declare v_income numeric; v_total bigint; v_pct numeric;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select coalesce(sum(p.amount_egp),0) into v_income
    from payments p where p.purpose = 'subscription' and p.status = 'paid'
     and date_trunc('month', p.paid_at)::date = p_month;
  select count(*) into v_total from course_views cv join courses c on c.id = cv.course_id
    where cv.month = p_month and c.kind = 'recorded';
  select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) into v_pct;

  insert into month_pools (month, subscription_income, total_views, instructor_pct)
  values (p_month, v_income, v_total, v_pct)
  on conflict (month) do nothing;

  if v_total > 0 then
    insert into earnings (instructor_id, month, instructor_views, amount_egp)
    select c.instructor_id, p_month, count(*),
           round(v_income / v_total * count(*) * v_pct / 100, 2)
      from course_views cv join courses c on c.id = cv.course_id
     where cv.month = p_month and c.kind = 'recorded' and c.instructor_id is not null
     group by c.instructor_id
    on conflict (instructor_id, month) do nothing;
  end if;
end $$;

create or replace view instructor_balance as
  select instructor_id, coalesce(sum(amount_egp),0) as available_egp
    from earnings where payout_id is null group by instructor_id;

-- withdrawal allowed once every 3 months; no minimum amount
create or replace function request_payout(p_method text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_amount numeric; v_last timestamptz; v_id uuid;
begin
  select max(requested_at) into v_last from payouts
   where instructor_id = auth.uid() and status <> 'rejected';
  if v_last is not null and now() < v_last + interval '3 months' then
    raise exception 'next withdrawal available on %', (v_last + interval '3 months')::date;
  end if;
  select coalesce(sum(amount_egp),0) into v_amount from earnings
   where instructor_id = auth.uid() and payout_id is null;
  if v_amount <= 0 then raise exception 'no available balance'; end if;
  insert into payouts (instructor_id, amount_egp, method) values (auth.uid(), v_amount, p_method)
    returning id into v_id;
  update earnings set payout_id = v_id where instructor_id = auth.uid() and payout_id is null;
  return v_id;
end $$;

-- ---------- requests (one admin-reviewed inbox) ----------
create table requests (
  id         uuid primary key default gen_random_uuid(),
  type       request_type not null,
  user_id    uuid references profiles(id),
  name       text not null,
  email      text,
  phone      text,
  payload    jsonb not null default '{}',
  status     request_status not null default 'new',
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table profiles          enable row level security;
alter table plans             enable row level security;
alter table courses           enable row level security;
alter table lectures          enable row level security;
alter table lecture_videos    enable row level security;
alter table payments          enable row level security;
alter table webhook_events    enable row level security;
alter table subscriptions     enable row level security;
alter table enrollments       enable row level security;
alter table lecture_progress  enable row level security;
alter table course_views      enable row level security;
alter table certificates      enable row level security;
alter table month_pools       enable row level security;
alter table earnings          enable row level security;
alter table payouts           enable row level security;
alter table requests          enable row level security;

create policy profiles_self   on profiles for select using (id = auth.uid() or is_staff());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = my_role());
create policy profiles_admin  on profiles for all using (is_admin());

create policy plans_read      on plans   for select using (true);
create policy plans_admin     on plans   for all using (is_admin());

create policy courses_read    on courses for select using (status = 'published' or instructor_id = auth.uid() or is_staff());
create policy courses_admin   on courses for all using (is_admin()) with check (is_admin());
-- instructors manage their own drafts and send them for review; only admins publish
create policy courses_inst    on courses for all using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid() and status in ('draft','review'));

-- lecture rows are readable (titles only); video ids live in lecture_videos
create policy lectures_read   on lectures for select using (
  exists (select 1 from courses c where c.id = course_id and (c.status = 'published' or c.instructor_id = auth.uid() or is_staff())));
create policy lectures_write  on lectures for all using (
  is_admin() or exists (select 1 from courses c where c.id = course_id and c.instructor_id = auth.uid()));

create policy lvideos_manage  on lecture_videos for all using (
  is_admin() or exists (select 1 from lectures l join courses c on c.id = l.course_id where l.id = lecture_id and c.instructor_id = auth.uid()))
  with check (is_admin() or exists (select 1 from lectures l join courses c on c.id = l.course_id where l.id = lecture_id and c.instructor_id = auth.uid()));
create policy payments_own    on payments        for select using (user_id = auth.uid() or is_staff());
create policy subs_own        on subscriptions   for select using (user_id = auth.uid() or is_staff());
create policy enroll_own      on enrollments     for select using (user_id = auth.uid() or is_staff());
create policy progress_own    on lecture_progress for select using (user_id = auth.uid());
create policy views_staff     on course_views    for select using (is_staff());
create policy certs_own       on certificates    for select using (user_id = auth.uid() or is_staff());
create policy pools_staff     on month_pools     for select using (is_staff());
create policy earn_own        on earnings        for select using (instructor_id = auth.uid() or is_staff());
create policy payouts_own     on payouts         for select using (instructor_id = auth.uid() or is_staff());
create policy payouts_admin   on payouts         for update using (is_admin());
create policy requests_create on requests        for insert with check (true);
create policy requests_staff  on requests        for select using (is_staff());
create policy requests_update on requests        for update using (is_staff());
-- webhook_events: no policies = only the service role (Edge Functions) can touch it.
-- payments/subscriptions/enrollments inserts: only via service role from the webhook handler.

-- ---------- seed: the three real plans (prices from the live site, editable) ----------
insert into plans (code, name, duration_months, price_egp, old_price_egp) values
  ('monthly',    'اشتراك شهري',      1,  200,  350),
  ('semiannual', 'اشتراك نصف سنوي',  6,  800, 1500),
  ('annual',     'اشتراك سنوي',     12, 2000, 4200);
