-- Coupon targets.
-- * Subscription coupons can cover several plans: plan_ids = array of plan ids (NULL = every plan).
--   The old single plan_id column stays for backward compatibility and is copied into plan_ids here.
-- * Interactive coupons use course_id (NULL = every interactive course, value = one course).
-- * quote_price now rejects a plan-limited coupon when the purchase is not one of its plans
--   (including interactive purchases, where p_plan is null).

alter table coupons add column if not exists plan_ids uuid[];

update coupons set plan_ids = array[plan_id] where plan_id is not null and plan_ids is null;

alter table coupons drop constraint if exists coupons_target_chk;
alter table coupons add constraint coupons_target_chk check (
  (plan_ids is null or (cardinality(plan_ids) > 0 and applies_to in ('subscription','any')))
  and (course_id is null or applies_to in ('interactive_course','any'))
);

create or replace function public.quote_price(p_user uuid, p_code text, p_purpose pay_purpose, p_plan uuid, p_course uuid)
 returns table(list_price numeric, discount numeric, final numeric, coupon_id uuid)
 language plpgsql stable security definer set search_path to 'public'
as $function$
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
    if v_c.plan_ids is not null and (p_plan is null or not (p_plan = any(v_c.plan_ids))) then raise exception 'الكود لا ينطبق على هذه الباقة'; end if;
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
end $function$;
