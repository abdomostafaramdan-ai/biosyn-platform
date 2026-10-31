-- Server-side payment logic. Callable ONLY by the service role (Edge Functions).

create or replace function create_pending_payment(
  p_user uuid, p_gateway gateway, p_purpose pay_purpose,
  p_plan uuid, p_course uuid, p_fee numeric)
returns payments
language plpgsql security definer set search_path = public as $$
declare v_amount numeric; v_row payments; v_c courses; v_taken int;
begin
  if p_purpose = 'subscription' then
    select price_egp into v_amount from plans where id = p_plan and active;
    if v_amount is null then raise exception 'plan not available'; end if;
  else
    select * into v_c from courses where id = p_course and kind = 'interactive' and status = 'published';
    if v_c.id is null or v_c.price_egp is null then raise exception 'course not available'; end if;
    if exists (select 1 from enrollments where user_id = p_user and course_id = p_course) then
      raise exception 'already enrolled';
    end if;
    if v_c.seats is not null then
      select count(*) into v_taken from enrollments where course_id = p_course;
      if v_taken >= v_c.seats then raise exception 'course is full'; end if;
    end if;
    v_amount := v_c.price_egp;
  end if;

  insert into payments (user_id, gateway, purpose, plan_id, course_id, amount_egp, fee_egp)
  values (p_user, p_gateway, p_purpose,
          case when p_purpose = 'subscription' then p_plan end,
          case when p_purpose = 'interactive_course' then p_course end,
          v_amount, greatest(coalesce(p_fee,0),0))
  returning * into v_row;
  return v_row;
end $$;

-- idempotent: safe to call again for the same payment (webhook retries)
create or replace function fulfil_payment(p_payment uuid, p_gateway_ref text)
returns payments
language plpgsql security definer set search_path = public as $$
declare v_p payments; v_months int; v_start timestamptz;
begin
  select * into v_p from payments where id = p_payment for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  if v_p.status = 'paid' then return v_p; end if;
  if v_p.status = 'refunded' then raise exception 'payment already refunded'; end if;

  update payments set status = 'paid', paid_at = now(),
         gateway_ref = coalesce(p_gateway_ref, gateway_ref)
   where id = p_payment returning * into v_p;

  if v_p.purpose = 'subscription' then
    select duration_months into v_months from plans where id = v_p.plan_id;
    -- buying while a plan is still active: the new period starts when the current one ends
    select coalesce(max(ends_at), now()) into v_start from subscriptions
      where user_id = v_p.user_id and ends_at > now();
    insert into subscriptions (user_id, plan_id, payment_id, starts_at, ends_at)
    values (v_p.user_id, v_p.plan_id, v_p.id, v_start, v_start + make_interval(months => v_months));
  else
    insert into enrollments (user_id, course_id, payment_id)
    values (v_p.user_id, v_p.course_id, v_p.id) on conflict (user_id, course_id) do nothing;
  end if;
  return v_p;
end $$;

create or replace function fail_payment(p_payment uuid)
returns void language sql security definer set search_path = public as $$
  update payments set status = 'failed' where id = p_payment and status = 'pending';
$$;

-- p_dry = true: only validates the 7-day rule (used before calling the gateway)
create or replace function refund_payment(p_payment uuid, p_dry boolean default false)
returns payments
language plpgsql security definer set search_path = public as $$
declare v_p payments;
begin
  select * into v_p from payments where id = p_payment for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  if v_p.purpose <> 'interactive_course' then raise exception 'subscriptions are not refundable'; end if;
  if not is_refundable(v_p) then raise exception 'refund window (7 days) has passed or payment is not paid'; end if;
  if p_dry then return v_p; end if;
  update payments set status = 'refunded', refunded_at = now() where id = p_payment returning * into v_p;
  delete from enrollments where payment_id = p_payment;
  return v_p;
end $$;

revoke execute on function create_pending_payment(uuid, gateway, pay_purpose, uuid, uuid, numeric),
  fulfil_payment(uuid, text), fail_payment(uuid), refund_payment(uuid, boolean)
  from public, anon, authenticated;
grant execute on function create_pending_payment(uuid, gateway, pay_purpose, uuid, uuid, numeric),
  fulfil_payment(uuid, text), fail_payment(uuid), refund_payment(uuid, boolean) to service_role;
