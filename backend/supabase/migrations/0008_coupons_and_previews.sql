-- Coupons + free preview lectures

-- ---------- preview lectures ----------
alter table lectures add column if not exists is_preview boolean not null default false;

create or replace function can_watch_lecture(uid uuid, lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lectures l join courses c on c.id = l.course_id
                  where l.id = lid and c.status = 'published' and c.kind = 'recorded' and l.is_preview and uid is not null)
      or exists (select 1 from lectures l where l.id = lid and can_watch(uid, l.course_id));
$$;

create or replace function record_progress(p_lecture uuid, p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_kind course_kind; v_total int; v_full boolean;
begin
  select l.course_id, c.kind into v_course, v_kind
    from lectures l join courses c on c.id = l.course_id where l.id = p_lecture;
  if v_course is null or auth.uid() is null or not can_watch_lecture(auth.uid(), p_lecture) then
    raise exception 'not allowed';
  end if;
  v_full := can_watch(auth.uid(), v_course);

  insert into lecture_progress (user_id, lecture_id, max_pct, completed)
  values (auth.uid(), p_lecture, least(p_pct,100), p_pct >= 95)
  on conflict (user_id, lecture_id) do update
    set max_pct   = greatest(lecture_progress.max_pct, least(p_pct,100)),
        completed = lecture_progress.completed or p_pct >= 95,
        updated_at = now();

  -- previews never count as paid views and never issue certificates
  if not v_full then return; end if;

  if v_kind = 'recorded' and p_pct >= 50 then
    insert into course_views (user_id, course_id, month)
    values (auth.uid(), v_course, date_trunc('month', now())::date)
    on conflict do nothing;
  end if;

  select count(*) into v_total from lectures where course_id = v_course;
  if v_total > 0 and (select count(*) from lecture_progress lp join lectures l on l.id = lp.lecture_id
                      where lp.user_id = auth.uid() and l.course_id = v_course and lp.completed) = v_total then
    insert into certificates (user_id, course_id) values (auth.uid(), v_course) on conflict do nothing;
  end if;
end $$;

revoke execute on function can_watch_lecture(uuid, uuid) from public, anon, authenticated;
grant execute on function can_watch_lecture(uuid, uuid) to service_role;
revoke execute on function record_progress(uuid, numeric) from public, anon;
grant execute on function record_progress(uuid, numeric) to authenticated;

-- ---------- coupons ----------
create table if not exists coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  percent_off     int  check (percent_off between 1 and 100),
  amount_off_egp  numeric(12,2) check (amount_off_egp > 0),
  applies_to      text not null default 'any' check (applies_to in ('any','subscription','interactive_course')),
  plan_id         uuid references plans(id) on delete cascade,
  course_id       uuid references courses(id) on delete cascade,
  max_redemptions int check (max_redemptions > 0),
  starts_at       timestamptz,
  expires_at      timestamptz,
  active          boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  check ((percent_off is not null) <> (amount_off_egp is not null))
);
create unique index if not exists coupons_code_uq on coupons (upper(code));
alter table coupons enable row level security;
create policy coupons_admin on coupons for all to authenticated using (is_admin()) with check (is_admin());

alter table payments add column if not exists coupon_id uuid references coupons(id);
alter table payments add column if not exists list_price_egp numeric(12,2);
alter table payments add column if not exists discount_egp numeric(12,2) not null default 0 check (discount_egp >= 0);

-- the one place that prices an order (used by the checkout and by the coupon check in the UI)
create or replace function quote_price(p_user uuid, p_code text, p_purpose pay_purpose, p_plan uuid, p_course uuid)
returns table (list_price numeric, discount numeric, final numeric, coupon_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_list numeric; v_c coupons; v_disc numeric := 0; v_used int;
begin
  if p_purpose = 'subscription' then
    select price_egp into v_list from plans where id = p_plan and active;
  else
    select price_egp into v_list from courses where id = p_course and kind = 'interactive' and status = 'published';
  end if;
  if v_list is null then raise exception 'item not available'; end if;

  if p_code is not null and btrim(p_code) <> '' then
    select * into v_c from coupons where upper(code) = upper(btrim(p_code));
    if v_c.id is null or not v_c.active then raise exception 'كود الخصم غير صحيح'; end if;
    if v_c.starts_at is not null and now() < v_c.starts_at then raise exception 'كود الخصم لم يبدأ بعد'; end if;
    if v_c.expires_at is not null and now() > v_c.expires_at then raise exception 'كود الخصم منتهي'; end if;
    if v_c.applies_to <> 'any' and v_c.applies_to <> p_purpose::text then raise exception 'الكود لا ينطبق على هذا المنتج'; end if;
    if v_c.plan_id is not null and v_c.plan_id is distinct from p_plan then raise exception 'الكود لا ينطبق على هذه الباقة'; end if;
    if v_c.course_id is not null and v_c.course_id is distinct from p_course then raise exception 'الكود لا ينطبق على هذه الدورة'; end if;
    select count(*) into v_used from payments pp where pp.coupon_id = v_c.id and pp.status = 'paid';
    if v_c.max_redemptions is not null and v_used >= v_c.max_redemptions then raise exception 'انتهت مرات استخدام الكود'; end if;
    if p_user is not null and exists (select 1 from payments pp where pp.coupon_id = v_c.id and pp.user_id = p_user and pp.status = 'paid') then
      raise exception 'استخدمت هذا الكود من قبل';
    end if;
    v_disc := case when v_c.percent_off is not null then round(v_list * v_c.percent_off / 100.0, 2)
                   else least(v_c.amount_off_egp, v_list) end;
  end if;
  return query select v_list, v_disc, v_list - v_disc, v_c.id;
end $$;

-- UI helper: check a code for the signed-in user
create or replace function validate_coupon(p_code text, p_plan_code text default null, p_course uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_plan uuid; q record;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_plan_code is not null then select id into v_plan from plans where code = p_plan_code; end if;
  select * into q from quote_price(auth.uid(), p_code,
        case when p_plan_code is not null then 'subscription'::pay_purpose else 'interactive_course'::pay_purpose end, v_plan, p_course);
  return json_build_object('list', q.list_price, 'discount', q.discount, 'final', q.final);
end $$;

drop function if exists create_pending_payment(uuid, gateway, pay_purpose, uuid, uuid, numeric);
create or replace function create_pending_payment(
  p_user uuid, p_gateway gateway, p_purpose pay_purpose,
  p_plan uuid, p_course uuid, p_fee numeric, p_coupon text default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare v_row payments; v_c courses; v_taken int; q record;
begin
  if p_purpose = 'interactive_course' then
    select * into v_c from courses where id = p_course and kind = 'interactive' and status = 'published';
    if v_c.id is null or v_c.price_egp is null then raise exception 'course not available'; end if;
    if exists (select 1 from enrollments where user_id = p_user and course_id = p_course) then
      raise exception 'already enrolled';
    end if;
    if v_c.seats is not null then
      select count(*) into v_taken from enrollments where course_id = p_course;
      if v_taken >= v_c.seats then raise exception 'course is full'; end if;
    end if;
  end if;
  select * into q from quote_price(p_user, p_coupon, p_purpose, p_plan, p_course);

  insert into payments (user_id, gateway, purpose, plan_id, course_id, amount_egp, fee_egp, coupon_id, list_price_egp, discount_egp)
  values (p_user, p_gateway, p_purpose,
          case when p_purpose = 'subscription' then p_plan end,
          case when p_purpose = 'interactive_course' then p_course end,
          q.final, case when q.final = 0 then 0 else greatest(coalesce(p_fee,0),0) end,
          q.coupon_id, q.list_price, q.discount)
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function quote_price(uuid, text, pay_purpose, uuid, uuid), validate_coupon(text, text, uuid),
  create_pending_payment(uuid, gateway, pay_purpose, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function quote_price(uuid, text, pay_purpose, uuid, uuid),
  create_pending_payment(uuid, gateway, pay_purpose, uuid, uuid, numeric, text) to service_role;
grant execute on function validate_coupon(text, text, uuid) to authenticated;
