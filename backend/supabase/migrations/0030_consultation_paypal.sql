-- Paid consultations (fixed 1500 EGP in Egypt, 100 in the visitor's currency abroad) + PayPal (manual, paypal.me)
-- 0030a (separate transaction): alter type pay_purpose add value if not exists 'consultation';

insert into app_settings (key, value) values
  ('consultation_price_egp', '1500'), ('consultation_intl_price', '100'), ('paypal_me', 'AbdoMostafaM')
on conflict (key) do nothing;

alter table payments add column if not exists request_id uuid references requests(id) on delete set null;

-- price of anything we sell, in EGP (the international price is applied by the checkout)
create or replace function quote_price(p_user uuid, p_code text, p_purpose pay_purpose, p_plan uuid, p_course uuid)
returns table (list_price numeric, discount numeric, final numeric, coupon_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_list numeric; v_c coupons; v_disc numeric := 0; v_used int;
begin
  if p_purpose = 'subscription' then
    select price_egp into v_list from plans where id = p_plan and active;
  elsif p_purpose = 'consultation' then
    select nullif(value,'')::numeric into v_list from app_settings where key = 'consultation_price_egp';
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

-- paid => subscription starts / course opens / consultation request confirmed (all automatic)
create or replace function fulfil_payment(p_payment uuid, p_gateway_ref text)
returns payments language plpgsql security definer set search_path = public as $$
declare v_p payments; v_months int; v_start timestamptz;
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
    insert into enrollments (user_id, course_id, payment_id)
    values (v_p.user_id, v_p.course_id, v_p.id) on conflict (user_id, course_id) do nothing;
  elsif v_p.purpose = 'consultation' and v_p.request_id is not null then
    update requests set status = case when status = 'new' then 'in_review' else status end,
           payload = payload || jsonb_build_object('الدفع', 'مدفوع', 'payment_id', v_p.id)
     where id = v_p.request_id;
    perform notify_team('cons-paid:' || v_p.id, 'استشارة مدفوعة: احجز الموعد',
      email_html('استشارة اتدفعت', array['العميل دفع رسوم الاستشارة، تواصل معاه لتحديد الموعد.'], 'صندوق الطلبات', 'admin.html#requests'));
  end if;
  return v_p;
end $$;

-- consultation request from the site form (signed-in), returns its id so the checkout can attach the payment
create or replace function create_consultation(p_name text, p_email text, p_phone text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if nullif(btrim(coalesce(p_name,'')),'') is null or coalesce(p_email,'') !~ '^\S+@\S+\.\S+$' then raise exception 'missing info'; end if;
  if length(coalesce(p_payload::text,'')) > 20000 then raise exception 'too large'; end if;
  insert into requests (type, user_id, name, email, phone, payload)
  values ('consultation', auth.uid(), left(btrim(p_name), 120), left(btrim(p_email), 200), nullif(left(btrim(coalesce(p_phone,'')), 40), ''),
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('الدفع', 'لم يتم بعد'))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function create_consultation(text, text, text, jsonb) from public, anon;
grant execute on function create_consultation(text, text, text, jsonb) to authenticated;

-- manual payments: InstaPay / Vodafone Cash (Egypt) and PayPal (abroad); confirmed by the team, then activated automatically
create or replace function create_manual_payment_v2(p_method text, p_ref text, p_plan_code text default null, p_course uuid default null,
                                                    p_coupon text default null, p_request uuid default null, p_currency text default 'EGP', p_amount_local numeric default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_p payments; v_email text; v_purpose pay_purpose; v_cur text := upper(coalesce(nullif(p_currency,''), 'EGP')); v_rate numeric;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_method not in ('instapay','vodafone_cash','paypal') then raise exception 'bad method'; end if;
  if nullif(btrim(coalesce(p_ref,'')),'') is null or length(p_ref) > 120 then raise exception 'اكتب رقم العملية أو الرقم الذي حوّلت منه'; end if;
  if (select count(*) from payments where user_id = auth.uid() and gateway::text = 'manual' and status = 'pending') >= 3 then
    raise exception 'لديك طلبات تحويل قيد المراجعة بالفعل، انتظر تأكيدها.';
  end if;
  if p_request is not null and not exists (select 1 from requests where id = p_request and user_id = auth.uid() and type = 'consultation') then raise exception 'not found'; end if;
  v_purpose := case when p_plan_code is not null then 'subscription' when p_request is not null then 'consultation' else 'interactive_course' end;
  if p_plan_code is not null then select id into v_plan from plans where code = p_plan_code and active; end if;
  v_p := create_pending_payment(auth.uid(), 'manual'::text::gateway, v_purpose, v_plan, case when v_purpose = 'interactive_course' then p_course end, 0, p_coupon);
  update payments set manual_method = p_method, manual_ref = btrim(p_ref), fee_egp = 0, request_id = p_request where id = v_p.id returning * into v_p;

  -- paid in another currency (PayPal): keep what the customer was asked to send; EGP equivalent for revenue share
  if v_cur <> 'EGP' and v_p.amount_egp > 0 then
    select egp_rate into v_rate from price_regions where currency = v_cur and active order by country = '*' limit 1;
    if v_rate is null or p_amount_local is null or p_amount_local <= 0 then raise exception 'bad currency'; end if;
    update payments set currency = v_cur, amount_local = round(p_amount_local, 2), fee_local = 0, fx_egp = v_rate,
           amount_egp = round(p_amount_local * v_rate, 2) where id = v_p.id returning * into v_p;
  end if;

  if v_p.amount_egp = 0 then
    v_p := fulfil_payment(v_p.id, 'free:' || v_p.id);
  else
    select email into v_email from auth.users where id = auth.uid();
    perform notify_team('manual:' || v_p.id, 'تحويل يدوي ينتظر التأكيد: ' || coalesce(v_p.amount_local, v_p.amount_egp) || ' ' || v_cur,
      email_html('تحويل يدوي جديد', array[
        'الطريقة: <b>' || case p_method when 'instapay' then 'إنستاباي' when 'paypal' then 'PayPal' else 'فودافون كاش' end || '</b>',
        'المبلغ المطلوب: <b>' || coalesce(v_p.amount_local, v_p.amount_egp) || ' ' || v_cur || '</b>', 'المرجع: ' || esc_html(p_ref), 'العميل: ' || esc_html(v_email),
        'راجع وصول المبلغ ثم أكّد الدفعة من لوحة الإدارة، والتفعيل بيحصل لوحده بعد التأكيد.'], 'المدفوعات', 'admin.html#payments'));
  end if;
  return json_build_object('id', v_p.id, 'amount', coalesce(v_p.amount_local, v_p.amount_egp), 'currency', v_cur, 'status', v_p.status);
end $$;
revoke execute on function create_manual_payment_v2(text, text, text, uuid, text, uuid, text, numeric) from public, anon;
grant execute on function create_manual_payment_v2(text, text, text, uuid, text, uuid, text, numeric) to authenticated;

create or replace function public_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'instapay', (select nullif(value,'') from app_settings where key = 'instapay_handle'),
    'vodafone_cash', (select nullif(value,'') from app_settings where key = 'vodafone_cash_number'),
    'paypal', (select nullif(value,'') from app_settings where key = 'paypal_me'),
    'consultation_price', (select nullif(value,'')::numeric from app_settings where key = 'consultation_price_egp'),
    'consultation_intl', (select nullif(value,'')::numeric from app_settings where key = 'consultation_intl_price'),
    'gateways', (select coalesce(json_agg(g), '[]'::json) from (values ('paymob','PAYMOB_SECRET_KEY'), ('fawaterk','FAWATERK_API_KEY'), ('stripe','STRIPE_SECRET_KEY')) v(g, k)
                  where exists (select 1 from integration_secrets s where s.key = v.k)),
    'support_chat', exists (select 1 from integration_secrets where key = 'ANTHROPIC_API_KEY'),
    'meta_pixel', (select value from integration_secrets where key = 'META_PIXEL_ID'),
    'ga4', (select value from integration_secrets where key = 'GA4_ID'));
$$;

-- CRM: name the payment method + consultation item, send the EGP equivalent
create or replace function trg_crm_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text; v_phone text; v_item text; v_method text; v_cpn text; v_status text;
begin
  if new.status = old.status or new.status not in ('paid','refunded') then return new; end if;
  select email into v_email from auth.users where id = new.user_id;
  select full_name, coalesce(phone, whatsapp) into v_name, v_phone from profiles where id = new.user_id;
  select coalesce((select name from plans where id = new.plan_id), (select title from courses where id = new.course_id),
                  case when new.purpose::text = 'consultation' then 'استشارة' end, 'Biosyn') into v_item;
  select code into v_cpn from coupons where id = new.coupon_id;
  v_method := case new.gateway::text when 'manual' then case new.manual_method when 'instapay' then 'InstaPay' when 'paypal' then 'PayPal' else 'Vodafone Cash' end
                                     else new.gateway::text end;
  v_status := case new.status when 'paid' then 'completed' else 'refunded' end;
  insert into crm_outbox (dedupe_key, kind, payload) values (
    'pay:' || new.id || ':' || new.status, 'order',
    jsonb_build_object(
      'id', 'bp-' || new.id, 'status', v_status,
      'total', (coalesce(new.amount_egp,0) + coalesce(new.fee_egp,0))::text,
      'currency', 'EGP',
      'date_created', to_char(coalesce(new.paid_at, now()) at time zone 'Africa/Cairo', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'payment_method_title', v_method || case when new.currency is not null and new.currency <> 'EGP' then ' (' || new.amount_local || ' ' || new.currency || ')' else '' end,
      'billing', jsonb_build_object('first_name', coalesce(v_name,''), 'last_name', '', 'email', coalesce(v_email,''), 'phone', coalesce(v_phone,'')),
      'line_items', jsonb_build_array(jsonb_build_object('name', v_item, 'quantity', 1)),
      'coupon_lines', case when v_cpn is not null then jsonb_build_array(jsonb_build_object('code', v_cpn)) else '[]'::jsonb end))
  on conflict (dedupe_key) do nothing;
  return new;
end $$;

-- PayPal as a manual method; consultation payments carry no plan/course
alter table payments drop constraint if exists payments_manual_method_check,
  add constraint payments_manual_method_check check (manual_method is null or manual_method in ('instapay','vodafone_cash','paypal'));
alter table payments drop constraint if exists payments_check,
  add constraint payments_check check (
    (purpose = 'subscription' and plan_id is not null and course_id is null)
    or (purpose = 'interactive_course' and course_id is not null and plan_id is null)
    or (purpose = 'consultation' and plan_id is null and course_id is null));

-- CRM: send the category + method explicitly (the CRM's woo-webhook reads biosyn_cat / biosyn_method / biosyn_note)
create or replace function trg_crm_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text; v_phone text; v_item text; v_method text; v_cpn text; v_status text; v_cat text;
begin
  if new.status = old.status or new.status not in ('paid','refunded') then return new; end if;
  select email into v_email from auth.users where id = new.user_id;
  select full_name, coalesce(phone, whatsapp) into v_name, v_phone from profiles where id = new.user_id;
  select coalesce((select name from plans where id = new.plan_id), (select title from courses where id = new.course_id),
                  case when new.purpose::text = 'consultation' then 'استشارة' end, 'Biosyn') into v_item;
  select code into v_cpn from coupons where id = new.coupon_id;
  v_method := case new.gateway::text when 'manual' then case new.manual_method when 'instapay' then 'InstaPay' when 'paypal' then 'PayPal' else 'Vodafone Cash' end
                                     else new.gateway::text end;
  v_cat := case new.purpose::text when 'subscription' then 'باقة اشتراك' when 'interactive_course' then 'كورس تفاعلي' when 'consultation' then 'استشارة' end;
  v_status := case new.status when 'paid' then 'completed' else 'refunded' end;
  insert into crm_outbox (dedupe_key, kind, payload) values (
    'pay:' || new.id || ':' || new.status, 'order',
    jsonb_build_object(
      'id', 'bp-' || new.id, 'status', v_status,
      'total', (coalesce(new.amount_egp,0) + coalesce(new.fee_egp,0))::text,
      'currency', 'EGP',
      'biosyn_cat', v_cat, 'biosyn_method', v_method,
      'biosyn_note', 'منصة Biosyn' || case when new.currency is not null and new.currency <> 'EGP' then ' · اتدفع ' || new.amount_local || ' ' || new.currency else '' end,
      'date_created', to_char(coalesce(new.paid_at, now()) at time zone 'Africa/Cairo', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'payment_method_title', v_method,
      'billing', jsonb_build_object('first_name', coalesce(v_name,''), 'last_name', '', 'email', coalesce(v_email,''), 'phone', coalesce(v_phone,'')),
      'line_items', jsonb_build_array(jsonb_build_object('name', v_item, 'quantity', 1)),
      'coupon_lines', case when v_cpn is not null then jsonb_build_array(jsonb_build_object('code', v_cpn)) else '[]'::jsonb end))
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
