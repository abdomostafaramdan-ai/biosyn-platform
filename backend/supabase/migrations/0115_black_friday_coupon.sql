-- 0115: limited coupons hold a seat while a checkout is in progress (20 min), so «first 100» cannot overshoot;
-- bf_seats_left() for the Black Friday page (public, returns only a number and the window).
do $$
declare d text := pg_get_functiondef('public.quote_price(uuid, text, pay_purpose, uuid, uuid)'::regprocedure);
begin
  if position('interval ''20 minutes''' in d) = 0 then
    d := replace(d, $q$select count(*) into v_used from payments pp where pp.coupon_id = v_c.id and pp.status = 'paid';$q$,
                    $q$select count(*) into v_used from payments pp where pp.coupon_id = v_c.id
       and (pp.status = 'paid' or (pp.status = 'pending' and pp.created_at > now() - interval '20 minutes' and pp.user_id is distinct from p_user));$q$);
    if position('interval ''20 minutes''' in d) = 0 then raise exception 'quote_price patch did not apply'; end if;
    execute d;
  end if;
end $$;

create or replace function public.bf_seats_left() returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'starts_at', c.starts_at, 'expires_at', c.expires_at,
    'left', greatest(coalesce(c.max_redemptions, 0) - (select count(*) from payments p where p.coupon_id = c.id and p.status = 'paid'), 0))
  from coupons c where upper(c.code) = 'BIOSYN';
$$;
grant execute on function public.bf_seats_left() to anon, authenticated;
update security_state set value = value || '["bf_seats_left"]'::jsonb, updated_at = now()
 where key = 'anon_fn_allow' and not value ? 'bf_seats_left';
