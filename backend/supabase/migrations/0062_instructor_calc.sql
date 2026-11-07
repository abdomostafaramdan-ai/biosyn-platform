-- Instructor dashboard «حاسبة الأرباح»: the caller's real numbers. Exposes only the per-view rate
-- (never the platform's income or total views; null until the month has 100+ views), the caller's own
-- views per course, the last 6 closed months, their promo codes and active plan prices.
create or replace function public.instructor_calc()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_m date := date_trunc('month', now())::date;
  v_income numeric; v_total bigint; v_pct numeric;
begin
  if v_uid is null or my_role()::text not in ('instructor', 'admin') then raise exception 'not allowed'; end if;
  select coalesce(sum(p.amount_egp), 0) into v_income
    from payments p left join coupons k on k.id = p.coupon_id
   where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = v_m and k.instructor_id is null;
  select count(*) into v_total from course_views cv join courses c on c.id = cv.course_id where cv.month = v_m and c.kind = 'recorded';
  select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) into v_pct;
  return json_build_object(
    'pct', v_pct,
    'month', v_m,
    'day', extract(day from now())::int,
    'days', extract(day from (v_m + interval '1 month - 1 day'))::int,
    'rate', case when v_total >= 100 then round(v_income / v_total, 4) end,
    'my_views', (select count(*) from course_views cv join courses c on c.id = cv.course_id
                  where cv.month = v_m and c.kind = 'recorded' and c.instructor_id = v_uid),
    'courses', coalesce((select json_agg(x order by x.views desc) from (
        select c.title, c.slug, c.status, count(cv.user_id) views
          from courses c left join course_views cv on cv.course_id = c.id and cv.month = v_m
         where c.instructor_id = v_uid and c.kind = 'recorded' group by c.id) x), '[]'::json),
    'history', coalesce((select json_agg(h order by h.month desc) from (
        select mp.month, case when mp.total_views > 0 then round(mp.subscription_income / mp.total_views, 4) else 0 end rate,
               mp.instructor_pct pct, coalesce(e.instructor_views, 0) my_views, coalesce(e.amount_egp, 0) amount, coalesce(e.promo_egp, 0) promo
          from month_pools mp left join earnings e on e.month = mp.month and e.instructor_id = v_uid
         order by mp.month desc limit 6) h), '[]'::json),
    'promo', coalesce((select json_agg(json_build_object('code', k.code, 'percent_off', k.percent_off, 'pct', k.instructor_pct))
        from coupons k where k.instructor_id = v_uid and k.active), '[]'::json),
    'plans', coalesce((select json_agg(json_build_object('name', name, 'price', price_egp, 'months', duration_months) order by price_egp)
        from plans where active), '[]'::json));
end $$;
revoke all on function public.instructor_calc() from public, anon;
grant execute on function public.instructor_calc() to authenticated;
