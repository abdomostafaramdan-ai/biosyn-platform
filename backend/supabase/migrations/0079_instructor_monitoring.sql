-- Instructor monitoring for admins:
--   admin_instructor_overview()  one row per instructor account with activity, content, money and support signals
--   my_promo_stats(p_user) / my_promo_requests(p_user)  staff may pass an instructor id to see that instructor's promo view
--   (instructors keep calling them with no argument and still get their own rows)

create or replace function public.admin_instructor_overview()
returns table(
  id uuid, full_name text, email text, phone text, whatsapp text, joined_at timestamptz, last_sign_in_at timestamptz,
  featured_id uuid, featured_slug text, photo_url text,
  courses int, published int, drafts int, lectures int,
  views_month bigint, views_prev_month bigint, views_total bigint, students bigint, watching_now bigint, active_today bigint,
  certificates bigint, est_earnings_month numeric, last_view_at timestamptz,
  balance numeric, earned_total numeric, paid_total numeric, payouts_pending int, payouts_pending_egp numeric,
  questions_total int, questions_open int, oldest_open_at timestamptz, last_reply_at timestamptz,
  promo_codes int, promo_uses_month bigint, contracts_signed int
)
language sql stable security definer set search_path = public
as $$
  with insts as (
    select p.id from profiles p where p.role = 'instructor'
    union select c.instructor_id from courses c where c.instructor_id is not null
  ),
  cs as (select * from course_stats()),
  m as (select date_trunc('month', now())::date mo)
  select p.id, p.full_name, u.email::text, p.phone, p.whatsapp, p.created_at, u.last_sign_in_at,
         f.id, f.slug, f.photo_url,
         (select count(*)::int from courses c where c.instructor_id = p.id),
         (select count(*)::int from courses c where c.instructor_id = p.id and c.status = 'published'),
         (select count(*)::int from courses c where c.instructor_id = p.id and c.status in ('draft','review')),
         coalesce((select sum(s.lectures)::int from cs s where s.instructor_id = p.id), 0),
         coalesce((select sum(s.views_month) from cs s where s.instructor_id = p.id), 0)::bigint,
         (select count(*) from course_views v join courses c on c.id = v.course_id, m
           where c.instructor_id = p.id and v.month = (m.mo - interval '1 month')::date),
         coalesce((select sum(s.views_total) from cs s where s.instructor_id = p.id), 0)::bigint,
         (select count(distinct v.user_id) from course_views v join courses c on c.id = v.course_id where c.instructor_id = p.id),
         coalesce((select sum(s.watching_now) from cs s where s.instructor_id = p.id), 0)::bigint,
         coalesce((select sum(s.active_today) from cs s where s.instructor_id = p.id), 0)::bigint,
         coalesce((select sum(s.certificates) from cs s where s.instructor_id = p.id), 0)::bigint,
         coalesce((select sum(s.est_earnings_month) from cs s where s.instructor_id = p.id), 0),
         (select max(s.last_view_at) from cs s where s.instructor_id = p.id),
         coalesce((select sum(e.amount_egp) from earnings e where e.instructor_id = p.id and e.payout_id is null), 0),
         coalesce((select sum(e.amount_egp) from earnings e where e.instructor_id = p.id), 0),
         coalesce((select sum(o.amount_egp) from payouts o where o.instructor_id = p.id and o.status = 'paid'), 0),
         (select count(*)::int from payouts o where o.instructor_id = p.id and o.status in ('requested','approved')),
         coalesce((select sum(o.amount_egp) from payouts o where o.instructor_id = p.id and o.status in ('requested','approved')), 0),
         (select count(*)::int from threads t where t.kind = 'course' and t.instructor_id = p.id),
         (select count(*)::int from threads t where t.kind = 'course' and t.instructor_id = p.id and t.status = 'open' and coalesce(t.last_sender, 'student') = 'student'),
         (select min(coalesce(t.last_message_at, t.created_at)) from threads t where t.kind = 'course' and t.instructor_id = p.id and t.status = 'open' and coalesce(t.last_sender, 'student') = 'student'),
         (select max(tm.created_at) from thread_messages tm join threads t on t.id = tm.thread_id where t.instructor_id = p.id and tm.sender_id = p.id),
         (select count(*)::int from coupons k where k.instructor_id = p.id and k.active),
         (select count(*) from payments pa join coupons k on k.id = pa.coupon_id where k.instructor_id = p.id and pa.status = 'paid' and pa.paid_at >= date_trunc('month', now())),
         (select count(*)::int from contracts ct where ct.user_id = p.id)
    from insts i
    join profiles p on p.id = i.id
    join auth.users u on u.id = p.id
    left join lateral (select fi.id, fi.slug, fi.photo_url from featured_instructors fi where fi.profile_id = p.id order by fi.sort limit 1) f on true
   where is_staff()
   order by 15 desc, p.full_name;
$$;
revoke all on function public.admin_instructor_overview() from public, anon;
grant execute on function public.admin_instructor_overview() to authenticated;

drop function if exists public.my_promo_stats();
create function public.my_promo_stats(p_user uuid default null)
returns table(code text, percent_off integer, instructor_pct numeric, uses_total bigint, uses_month bigint, earned_month numeric, active boolean)
language sql stable security definer set search_path = public
as $$
  with who as (select case when p_user is not null and is_staff() then p_user else auth.uid() end as uid),
  m as (select date_trunc('month', now())::date mo),
  pool as (select coalesce((select sum(p.amount_egp) from payments p, m where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = m.mo), 0) inc,
                  (select count(*) from course_views cv join courses c on c.id = cv.course_id, m where cv.month = m.mo and c.kind = 'recorded') tot)
  select k.code, k.percent_off, k.instructor_pct,
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid'),
         (select count(*) from payments p where p.coupon_id = k.id and p.status = 'paid' and p.paid_at >= date_trunc('month', now())),
         coalesce((select round((select inc from pool) / nullif((select tot from pool), 0) * count(*) * k.instructor_pct / 100, 2)
                     from course_views cv join courses c on c.id = cv.course_id, m
                    where cv.month = m.mo and c.kind = 'recorded' and c.instructor_id = k.instructor_id
                      and exists (select 1 from payments p left join plans pl on pl.id = p.plan_id
                                   where p.user_id = cv.user_id and p.coupon_id = k.id and p.status = 'paid' and p.purpose = 'subscription'
                                     and p.paid_at < (m.mo + interval '1 month')::timestamptz
                                     and p.paid_at + make_interval(months => coalesce(pl.duration_months, 1)) > m.mo::timestamptz)), 0),
         k.active
    from coupons k, who where k.instructor_id = who.uid order by k.created_at desc;
$$;
revoke all on function public.my_promo_stats(uuid) from public, anon;
grant execute on function public.my_promo_stats(uuid) to authenticated;

drop function if exists public.my_promo_requests();
create function public.my_promo_requests(p_user uuid default null)
returns table(id uuid, code text, status text, note text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.id, r.payload->>'code', r.status::text, r.payload->>'decision_note', r.created_at
    from requests r
   where r.type::text = 'promo_request'
     and r.user_id = case when p_user is not null and is_staff() then p_user else auth.uid() end
   order by r.created_at desc limit 20;
$$;
revoke all on function public.my_promo_requests(uuid) from public, anon;
grant execute on function public.my_promo_requests(uuid) to authenticated;
