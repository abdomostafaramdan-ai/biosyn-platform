-- Instructor earnings by watch minutes instead of "valid views".
--   Instructor share = 30% × subscription income × (watched seconds on the instructor's courses ÷ all watched seconds).
--   * course_watch: seconds of paid lectures a subscriber actually covered, per user / course / month.
--     Each second of a lecture counts once per student (re-watching adds nothing); the free first lecture never counts;
--     admins, the course's own instructor and the owner's accounts never count (view_counts()).
--   * app_settings 'payout_model' {"model":"minutes","from":"YYYY-MM-DD"}: months from that date are closed by minutes,
--     earlier months keep the old views formula (closed months are never recalculated).
--   * course_views stays as the "learners this month" count for dashboards; previews no longer create a view.
--   * contract template v4 (recorded courses) with the new definitions replaces v3 for new signatures.

-- 1) tracking -------------------------------------------------------------------------------------------------------
create table if not exists public.course_watch (
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  month      date not null,
  seconds    numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id, month)
);
create index if not exists course_watch_month_idx on public.course_watch (month, course_id);
alter table public.course_watch enable row level security;
revoke all on public.course_watch from anon, authenticated;

alter table public.month_pools add column if not exists total_seconds numeric;
alter table public.earnings    add column if not exists watch_seconds numeric;

insert into public.app_settings (key, value) values ('payout_model', '{"model":"minutes","from":"2026-11-01"}')
on conflict (key) do update set value = excluded.value;

create or replace function public.payout_by_minutes(p_month date)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select coalesce((select (value::jsonb ->> 'from')::date from app_settings
                    where key = 'payout_model' and value ~ '^\s*\{' and value::jsonb ->> 'model' = 'minutes'), 'infinity'::date) <= p_month;
$function$;
revoke all on function public.payout_by_minutes(date) from public, anon;
grant execute on function public.payout_by_minutes(date) to authenticated;

create or replace function public.record_watch(p_lecture uuid, p_pct numeric)
returns numeric
language plpgsql security definer set search_path = public
as $function$
declare v_course uuid; v_kind course_kind; v_dur int; v_inst uuid; v_total int; v_full boolean; v_preview boolean;
        v_old lecture_progress; v_cap numeric; v_pct numeric; v_add numeric;
begin
  select l.course_id, c.kind, l.duration_seconds, c.instructor_id, coalesce(l.is_preview, false)
    into v_course, v_kind, v_dur, v_inst, v_preview
    from lectures l join courses c on c.id = l.course_id where l.id = p_lecture;
  if v_course is null or auth.uid() is null or not can_watch_lecture(auth.uid(), p_lecture) then
    raise exception 'not allowed';
  end if;
  if not lecture_unlocked(auth.uid(), p_lecture) then raise exception 'lecture locked'; end if;
  v_full := can_watch(auth.uid(), v_course);
  if not v_full then return greatest(0, least(coalesce(p_pct, 0), 100)); end if;

  select * into v_old from lecture_progress where user_id = auth.uid() and lecture_id = p_lecture for update;
  v_pct := greatest(0, least(coalesce(p_pct, 0), 100));
  if v_dur is not null and v_dur > 0 then
    v_cap := coalesce(v_old.max_pct, 0)
           + (case when v_old.user_id is null then 60 else least(extract(epoch from (now() - v_old.updated_at)), 60) + 20 end) * 2.5 / v_dur * 100;
    v_pct := least(v_pct, v_cap);
  end if;

  insert into lecture_progress (user_id, lecture_id, max_pct, completed)
  values (auth.uid(), p_lecture, round(v_pct, 2), v_pct >= 95)
  on conflict (user_id, lecture_id) do update
    set max_pct    = greatest(lecture_progress.max_pct, round(v_pct, 2)),
        completed  = lecture_progress.completed or v_pct >= 95,
        updated_at = now()
  returning max_pct into v_pct;

  if v_kind = 'recorded' and not v_preview and view_counts(auth.uid(), v_course) then
    -- newly covered part of this lecture, in seconds
    v_add := greatest(v_pct - coalesce(v_old.max_pct, 0), 0) / 100 * coalesce(v_dur, 0);
    if v_add > 0 then
      insert into course_watch (user_id, course_id, month, seconds)
      values (auth.uid(), v_course, date_trunc('month', now())::date, round(v_add, 2))
      on conflict (user_id, course_id, month) do update
        set seconds = course_watch.seconds + excluded.seconds, updated_at = now();
    end if;
    if v_pct >= 50 then
      insert into course_views (user_id, course_id, month)
      values (auth.uid(), v_course, date_trunc('month', now())::date)
      on conflict do nothing;
    end if;
  end if;

  select count(*) into v_total from lectures where course_id = v_course;
  if v_total > 0 and (select count(*) from lecture_progress lp join lectures l on l.id = lp.lecture_id
                      where lp.user_id = auth.uid() and l.course_id = v_course and lp.completed) = v_total then
    insert into certificates (user_id, course_id) values (auth.uid(), v_course) on conflict do nothing;
  end if;
  return v_pct;
end $function$;

-- seconds already covered this month (from progress rows updated this month), so the current month starts complete
insert into course_watch (user_id, course_id, month, seconds)
select lp.user_id, l.course_id, date_trunc('month', now())::date, round(sum(least(lp.max_pct, 100) / 100 * l.duration_seconds), 2)
  from lecture_progress lp join lectures l on l.id = lp.lecture_id join courses c on c.id = l.course_id
 where c.kind = 'recorded' and not coalesce(l.is_preview, false) and coalesce(l.duration_seconds, 0) > 0
   and lp.updated_at >= date_trunc('month', now()) and view_counts(lp.user_id, l.course_id)
 group by lp.user_id, l.course_id
on conflict (user_id, course_id, month) do nothing;

-- 2) monthly close ---------------------------------------------------------------------------------------------------
create or replace function public.close_month(p_month date)
returns void
language plpgsql security definer set search_path = public
as $function$
declare v_income numeric; v_total bigint; v_secs numeric; v_pct numeric; v_rate numeric;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'admin only'; end if;
  select coalesce(sum(p.amount_egp),0) into v_income from payments p
   where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = p_month;
  select count(*) into v_total from course_views cv join courses c on c.id = cv.course_id
    where cv.month = p_month and c.kind = 'recorded';
  select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) into v_pct;

  if not payout_by_minutes(p_month) then
    insert into month_pools (month, subscription_income, total_views, instructor_pct)
    values (p_month, v_income, v_total, v_pct) on conflict (month) do nothing;
    v_rate := case when v_total > 0 then v_income / v_total else 0 end;
    insert into earnings (instructor_id, month, instructor_views, amount_egp, promo_egp, promo_count)
    select x.iid, p_month, count(*),
           round(v_rate * sum(x.pct) / 100, 2),
           round(v_rate * sum(greatest(x.pct - v_pct, 0)) / 100, 2),
           count(*) filter (where x.pct > v_pct)::int
      from (select c.instructor_id iid, coalesce(promo_view_pct(cv.user_id, c.instructor_id, p_month), v_pct) pct
              from course_views cv join courses c on c.id = cv.course_id
             where cv.month = p_month and c.kind = 'recorded' and c.instructor_id is not null) x
     group by x.iid
    on conflict (instructor_id, month) do nothing;
    return;
  end if;

  select coalesce(sum(cw.seconds), 0) into v_secs from course_watch cw join courses c on c.id = cw.course_id
   where cw.month = p_month and c.kind = 'recorded';
  insert into month_pools (month, subscription_income, total_views, instructor_pct, total_seconds)
  values (p_month, v_income, v_total, v_pct, v_secs) on conflict (month) do nothing;
  v_rate := case when v_secs > 0 then v_income / v_secs else 0 end;   -- EGP per watched second
  insert into earnings (instructor_id, month, instructor_views, watch_seconds, amount_egp, promo_egp, promo_count)
  select x.iid, p_month,
         (select count(*) from course_views cv join courses c2 on c2.id = cv.course_id
           where cv.month = p_month and c2.kind = 'recorded' and c2.instructor_id = x.iid),
         round(sum(x.secs), 2),
         round(v_rate * sum(x.secs * x.pct) / 100, 2),
         round(v_rate * sum(x.secs * greatest(x.pct - v_pct, 0)) / 100, 2),
         count(distinct x.uid) filter (where x.pct > v_pct)::int
    from (select c.instructor_id iid, cw.user_id uid, cw.seconds secs,
                 coalesce(promo_view_pct(cw.user_id, c.instructor_id, p_month), v_pct) pct
            from course_watch cw join courses c on c.id = cw.course_id
           where cw.month = p_month and c.kind = 'recorded' and c.instructor_id is not null) x
   group by x.iid
  on conflict (instructor_id, month) do nothing;
end $function$;

-- 3) live numbers for dashboards ---------------------------------------------------------------------------------------
drop function if exists public.course_stats();
create function public.course_stats()
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
revoke all on function public.course_stats() from public, anon;
grant execute on function public.course_stats() to authenticated;

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
         case when (select by_min from pool) then
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

-- the old per-view calculator RPC is not used by any page any more
drop function if exists public.instructor_calc();

-- 4) contract v4 for recorded courses ----------------------------------------------------------------------------------
do $do$
declare t contract_templates; b text;
begin
  select * into t from contract_templates where kind = 'instructor_recorded' and active order by version desc limit 1;
  if t.id is null or t.version >= 4 then return; end if;
  b := t.body;
  b := replace(b, '1.4 المشاهدة المعتمدة: أن يشاهد المشترك 50٪ على الأقل من إحدى محاضرات الكورس خلال الشهر، وتُحتسب مشاهدة واحدة لكل مشترك عن الكورس كله في الشهر الواحد مهما تكررت مشاهداته.',
                  '1.4 دقائق المشاهدة المعتمدة: مدة المحتوى التي شاهدها المشترك فعليًا من محاضرات الكورس المدفوعة خلال الشهر. وتُحتسب كل دقيقة من المحاضرة مرة واحدة فقط لكل مشترك مهما أعاد مشاهدتها، ولا تُحتسب المحاضرة المجانية الأولى ولا مشاهدات المحاضر لكورسه أو مشاهدات فريق المنصة.');
  b := replace(b, '1.5 قيمة المشاهدة: صافي دخل الاشتراكات المحصّل خلال الشهر مقسومًا على إجمالي المشاهدات المعتمدة لكل الكورسات المسجلة على المنصة في الشهر نفسه.',
                  '1.5 قيمة دقيقة المشاهدة: صافي دخل الاشتراكات المحصّل خلال الشهر مقسومًا على إجمالي دقائق المشاهدة المعتمدة لكل الكورسات المسجلة على المنصة في الشهر نفسه.');
  b := replace(b, 'ويظهر فيها مشاهداته وأرباحه', 'ويظهر فيها دقائق المشاهدة وأرباحه');
  b := replace(b, '8.1 يستحق المحاضر 30٪ من قيمة المشاهدات المعتمدة للكورس كل شهر،', '8.1 يستحق المحاضر 30٪ من قيمة دقائق المشاهدة المعتمدة للكورس كل شهر،');
  b := replace(b, '8.2 نصيب المحاضر الشهري = عدد المشاهدات المعتمدة للكورس × قيمة المشاهدة × 30٪.', '8.2 نصيب المحاضر الشهري = دقائق المشاهدة المعتمدة للكورس × قيمة دقيقة المشاهدة × 30٪.');
  b := replace(b, '8.3 مشاهدات المشتركين الذين اشتركوا بالكود الترويجي الخاص بالمحاضر تُحتسب له بنسبة 50٪ من قيمة المشاهدة بدلًا من 30٪',
                  '8.3 دقائق مشاهدة المشتركين الذين اشتركوا بالكود الترويجي الخاص بالمحاضر تُحتسب له بنسبة 50٪ من قيمة دقيقة المشاهدة بدلًا من 30٪');
  b := replace(b, '10.2 إتاحة بيانات المشاهدات والأرباح', '10.2 إتاحة بيانات دقائق المشاهدة والأرباح');
  if position('1.4 دقائق المشاهدة المعتمدة' in b) = 0 or position('8.2 نصيب المحاضر الشهري = دقائق' in b) = 0 then
    raise exception 'contract v3 text changed, v4 not created';
  end if;
  insert into contract_templates (kind, version, title, body, active) values (t.kind, 4, t.title, b, true);
  update contract_templates set active = false where id = t.id;
end $do$;
