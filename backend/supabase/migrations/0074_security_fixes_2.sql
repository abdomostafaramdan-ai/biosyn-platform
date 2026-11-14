-- 0074: security fixes round 2

-- Payout: serialise per instructor and take the amount from the rows actually claimed.
create or replace function public.request_payout(p_method text) returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare v_amount numeric; v_last timestamptz; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || auth.uid()::text));
  select max(requested_at) into v_last from payouts where instructor_id = auth.uid() and status <> 'rejected';
  if v_last is not null and now() < v_last + interval '3 months' then
    raise exception 'next withdrawal available on %', (v_last + interval '3 months')::date;
  end if;
  select coalesce(sum(amount_egp),0) into v_amount from earnings where instructor_id = auth.uid() and payout_id is null;
  if v_amount <= 0 then raise exception 'no available balance'; end if;
  insert into payouts (instructor_id, amount_egp, method) values (auth.uid(), v_amount, left(p_method, 40)) returning id into v_id;
  update earnings set payout_id = v_id where instructor_id = auth.uid() and payout_id is null;
  return v_id;
end $function$;

-- Seats: a paid enrollment is never dropped, but a full course alerts the team.
create or replace function public.fulfil_payment(p_payment uuid, p_gateway_ref text) returns payments
language plpgsql security definer set search_path to 'public' as $function$
declare v_p payments; v_months int; v_start timestamptz; v_seats int; v_taken int;
begin
  select * into v_p from payments where id = p_payment for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  if v_p.status = 'paid' then return v_p; end if;
  if v_p.status = 'refunded' then raise exception 'payment already refunded'; end if;

  update payments set status = 'paid', paid_at = now(), gateway_ref = coalesce(p_gateway_ref, gateway_ref)
   where id = p_payment returning * into v_p;

  if v_p.purpose = 'subscription' then
    select duration_months into v_months from plans where id = v_p.plan_id;
    select coalesce(max(ends_at), now()) into v_start from subscriptions where user_id = v_p.user_id and ends_at > now();
    insert into subscriptions (user_id, plan_id, payment_id, starts_at, ends_at)
    values (v_p.user_id, v_p.plan_id, v_p.id, v_start, v_start + make_interval(months => v_months));
  elsif v_p.purpose = 'interactive_course' then
    select seats into v_seats from courses where id = v_p.course_id for update;
    select count(*) into v_taken from enrollments where course_id = v_p.course_id;
    insert into enrollments (user_id, course_id, payment_id)
    values (v_p.user_id, v_p.course_id, v_p.id) on conflict (user_id, course_id) do nothing;
    if v_seats is not null and v_taken >= v_seats then
      perform notify_team('seats:' || v_p.id, 'دورة تجاوزت عدد المقاعد بعد دفع',
        email_html('تجاوز عدد المقاعد', array['دفع طالب بعد اكتمال المقاعد، راجع الدورة ورتّب الأمر معه أو استرد المبلغ.'], 'المدفوعات', 'admin.html#payments'));
    end if;
  elsif v_p.purpose = 'consultation' and v_p.request_id is not null then
    update requests set status = case when status = 'new' then 'in_review' else status end,
           payload = payload || jsonb_build_object('الدفع', 'مدفوع', 'payment_id', v_p.id)
     where id = v_p.request_id;
    perform notify_team('cons-paid:' || v_p.id, 'استشارة مدفوعة: احجز الموعد',
      email_html('تم دفع رسوم استشارة', array['دفع العميل رسوم الاستشارة، تواصل معه لتحديد الموعد.'], 'صندوق الطلبات', 'admin.html#requests'));
  end if;
  return v_p;
end $function$;

-- Public-form rate limit: add a global daily cap so a rotated X-Forwarded-For can't flood the inbox.
create or replace function public.request_rate_ok() returns boolean
language sql security definer set search_path to 'public' as $function$
  select chat_hit('rq:' || split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'na'), ',', 1), 30)
     and chat_hit('rq:all', 3000);
$function$;
