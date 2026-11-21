-- Instructors no longer see expected earnings for the running month: course_stats().est_earnings_month and
-- my_promo_stats().earned_month are null for non-staff. Earnings appear when the month closes (earnings table).

create or replace function public.course_stats()
returns table(course_id uuid, title text, kind course_kind, status text, slug text, instructor_id uuid, instructor_name text,
              featured_names text, lectures integer, views_month bigint, views_total bigint, viewers_total bigint, watching_now bigint,
              active_today bigint, certificates bigint, est_earnings_month numeric, earned_closed numeric, last_view_at timestamptz,
              watch_minutes_month numeric, watch_minutes_total numeric)
language sql stable security definer set search_path = public
as $function$
  with m as (select date_trunc('month', now())::date as month),
       pct as (select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) as v),
       pool_now as (
         select (select coalesce(sum(p.amount_egp), 0) from payments p, m
                  where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = m.month) as income,
                (select count(*) from course_views cv join courses c on c.id = cv.course_id, m
                  where cv.month = m.month and c.kind = 'recorded') as total,
                (select coalesce(sum(cw.seconds), 0) from course_watch cw join courses c on c.id = cw.course_id, m
                  where cw.month = m.month and c.kind = 'recorded') as secs,
                (select payout_by_minutes(m.month) from m) as by_min),
       mine as (select c.* from courses c where is_admin() or is_staff() or c.instructor_id = auth.uid())
  select c.id, c.title, c.kind, c.status::text, c.slug, c.instructor_id,
         (select pr.full_name from profiles pr where pr.id = c.instructor_id),
         (select string_agg(f.name, '، ' order by array_position(c.featured_instructor_ids, f.id))
            from featured_instructors f where f.id = any(coalesce(c.featured_instructor_ids, array[c.featured_instructor_id]))),
         (select count(*)::int from lectures l where l.course_id = c.id),
         (select count(*) from course_views v, m where v.course_id = c.id and v.month = m.month),
         (select count(*) from course_views v where v.course_id = c.id),
         (select count(distinct v.user_id) from course_views v where v.course_id = c.id),
         (select count(distinct lp.user_id) from lecture_progress lp join lectures l on l.id = lp.lecture_id
           where l.course_id = c.id and lp.updated_at > now() - interval '2 minutes'),
         (select count(distinct lp.user_id) from lecture_progress lp join lectures l on l.id = lp.lecture_id
           where l.course_id = c.id and lp.updated_at > now() - interval '24 hours'),
         (select count(*) from certificates ce where ce.course_id = c.id),
         case when c.kind <> 'recorded' then 0
              when not (is_admin() or is_staff()) then null   -- instructors see earnings only after the month closes
              when (select by_min from pool_now) then
                case when (select secs from pool_now) > 0
                     then round((select income from pool_now) / (select secs from pool_now)
                       * (select coalesce(sum(w.seconds * coalesce(promo_view_pct(w.user_id, c.instructor_id, m.month), (select v from pct))), 0)
                            from course_watch w, m where w.course_id = c.id and w.month = m.month) / 100, 2) else 0 end
              when (select total from pool_now) > 0
                then round((select income from pool_now) / (select total from pool_now)
                       * (select coalesce(sum(coalesce(promo_view_pct(v.user_id, c.instructor_id, m.month), (select v from pct))), 0)
                            from course_views v, m where v.course_id = c.id and v.month = m.month) / 100, 2)
              else 0 end,
         coalesce((select round(sum(mp.subscription_income / nullif(mp.total_views, 0) * coalesce(promo_view_pct(v.user_id, c.instructor_id, v.month), mp.instructor_pct) / 100), 2)
                     from course_views v join month_pools mp on mp.month = v.month where v.course_id = c.id and mp.total_seconds is null), 0)
         + coalesce((select round(sum(mp.subscription_income / nullif(mp.total_seconds, 0) * w.seconds * coalesce(promo_view_pct(w.user_id, c.instructor_id, w.month), mp.instructor_pct) / 100), 2)
                     from course_watch w join month_pools mp on mp.month = w.month where w.course_id = c.id and mp.total_seconds is not null), 0),
         (select max(v.counted_at) from course_views v where v.course_id = c.id),
         (select round(coalesce(sum(w.seconds), 0) / 60, 1) from course_watch w, m where w.course_id = c.id and w.month = m.month),
         (select round(coalesce(sum(w.seconds), 0) / 60, 1) from course_watch w where w.course_id = c.id)
    from mine c
   order by 10 desc, 11 desc, c.created_at desc;
$function$;

create or replace function public.my_promo_stats(p_user uuid default null::uuid)
returns table(code text, percent_off integer, instructor_pct numeric, uses_total bigint, uses_month bigint, earned_month numeric, active boolean)
language sql stable security definer set search_path = public
as $function$
  with who as (select case when p_user is not null and is_staff() then p_user else auth.uid() end as uid),
  m as (select date_trunc('month', now())::date mo),
  pool as (select coalesce((select sum(p.amount_egp) from payments p, m where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = m.mo), 0) inc,
                  (select count(*) from course_views cv join courses c on c.id = cv.course_id, m where cv.month = m.mo and c.kind = 'recorded') tot,
                  (select coalesce(sum(w.seconds), 0) from course_watch w join courses c on c.id = w.course_id, m where w.month = m.mo and c.kind = 'recorded') secs,
                  (select payout_by_minutes(m.mo) from m) by_min),
  coded as (select k.id kid, k.instructor_id, u.user_id from coupons k
              join lateral (select distinct p.user_id from payments p left join plans pl on pl.id = p.plan_id, m
                             where p.coupon_id = k.id and p.status = 'paid' and p.purpose = 'subscription'
                               and p.paid_at < (m.mo + interval '1 month')::timestamptz
                               and p.paid_at + make_interval(months => coalesce(pl.duration_months, 1)) > m.mo::timestamptz) u on true)
  select k.code, k.percent_off, k.instructor_pct,
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid'),
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid' and p.paid_at >= date_trunc('month', now())),
         case when not (is_admin() or is_staff()) then null   -- shown to instructors only after the month closes
              when (select by_min from pool) then
           coalesce((select round((select inc from pool) / nullif((select secs from pool), 0) * sum(w.seconds) * k.instructor_pct / 100, 2)
                       from course_watch w join courses c on c.id = w.course_id, m
                      where w.month = m.mo and c.kind = 'recorded' and c.instructor_id = k.instructor_id
                        and w.user_id in (select cd.user_id from coded cd where cd.kid = k.id)), 0)
         else
           coalesce((select round((select inc from pool) / nullif((select tot from pool), 0) * count(*) * k.instructor_pct / 100, 2)
                       from course_views cv join courses c on c.id = cv.course_id, m
                      where cv.month = m.mo and c.kind = 'recorded' and c.instructor_id = k.instructor_id
                        and cv.user_id in (select cd.user_id from coded cd where cd.kid = k.id)), 0)
         end,
         k.active
    from coupons k, who where k.instructor_id = who.uid order by k.created_at desc;
$function$;
