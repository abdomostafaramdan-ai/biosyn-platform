-- 0116: Black Friday code. The old BIOSYN (100-pound monthly offer, 33 uses) keeps its history as BIOSYN100;
-- a fresh BIOSYN = 70% on the semiannual and annual plans, Friday 27 Nov 2026 14:00-23:59 Cairo, first 100 paid.
-- Percentage discounts are rounded to whole pounds (1499 → 450, 4199 → 1260).
update coupons set code = 'BIOSYN100', active = false,
  percent_off = null, amount_off_egp = 249.00, plan_ids = array(select id from plans where code = 'monthly'),
  starts_at = null, expires_at = null, max_redemptions = null,
  note = 'عرض 100 جنيه للشهرية (19-20 نوفمبر) · كان اسمه BIOSYN'
where upper(code) = 'BIOSYN';

insert into coupons (code, percent_off, applies_to, plan_ids, starts_at, expires_at, max_redemptions, active, note)
values ('BIOSYN', 70, 'subscription', array(select id from plans where code in ('semiannual', 'annual')),
        '2026-11-27 14:00:00+02', '2026-11-27 23:59:59+02', 100, true,
        'Black Friday 27 Nov · 70% نصف سنوي وسنوي · أول 100 · من 2 ظهرًا لـ 11:59 م');

do $$
declare d text := pg_get_functiondef('public.quote_price(uuid, text, pay_purpose, uuid, uuid)'::regprocedure);
begin
  d := replace(d, $q$round(v_list * v_c.percent_off / 100.0, 2)$q$, $q$round(v_list * v_c.percent_off / 100.0, 0)$q$);
  if position('/ 100.0, 0)' in d) = 0 then raise exception 'rounding patch did not apply'; end if;
  execute d;
end $$;
