-- Watch rules + live course analytics.
--  * a lecture unlocks only after the student watched >= 50% of the previous one (by position)
--  * no skipping ahead: progress can only grow as fast as real time allows (up to 2.5x speed + slack)
--  * one valid view per student per course per month, whatever the number of lectures watched
--    (the course's own instructor watching their course never counts)
--  * course_stats(): per-course numbers for admins (all courses) and instructors (their own), live

-- ---------- unlock rule ----------
create or replace function lecture_unlocked(uid uuid, lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select course_id, position, is_preview from lectures where id = lid),
       prev as (select l.id from lectures l, me where l.course_id = me.course_id and l.position < me.position
                order by l.position desc limit 1)
  select (select is_preview from me) or not exists (select 1 from prev)   -- free previews are always open
      or exists (select 1 from prev join lecture_progress lp on lp.lecture_id = prev.id and lp.user_id = uid and lp.max_pct >= 50);
$$;
revoke execute on function lecture_unlocked(uuid, uuid) from public, anon;
grant execute on function lecture_unlocked(uuid, uuid) to authenticated, service_role;

-- ---------- progress with anti-skip; returns the % the server accepted ----------
create or replace function record_watch(p_lecture uuid, p_pct numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_kind course_kind; v_dur int; v_inst uuid; v_total int; v_full boolean;
        v_old lecture_progress; v_cap numeric; v_pct numeric;
begin
  select l.course_id, c.kind, l.duration_seconds, c.instructor_id into v_course, v_kind, v_dur, v_inst
    from lectures l join courses c on c.id = l.course_id where l.id = p_lecture;
  if v_course is null or auth.uid() is null or not can_watch_lecture(auth.uid(), p_lecture) then
    raise exception 'not allowed';
  end if;
  if not lecture_unlocked(auth.uid(), p_lecture) then raise exception 'lecture locked'; end if;
  v_full := can_watch(auth.uid(), v_course);

  select * into v_old from lecture_progress where user_id = auth.uid() and lecture_id = p_lecture for update;
  v_pct := greatest(0, least(coalesce(p_pct, 0), 100));
  if v_dur is not null and v_dur > 0 then
    -- how far real time allows: 2.5x playback speed over the time since the last report (max 60s counted, +20s slack)
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

  if not v_full then return v_pct; end if;   -- previews never count and never issue certificates

  if v_kind = 'recorded' and v_pct >= 50 and auth.uid() is distinct from v_inst then
    insert into course_views (user_id, course_id, month)
    values (auth.uid(), v_course, date_trunc('month', now())::date)
    on conflict do nothing;
  end if;

  select count(*) into v_total from lectures where course_id = v_course;
  if v_total > 0 and (select count(*) from lecture_progress lp join lectures l on l.id = lp.lecture_id
                      where lp.user_id = auth.uid() and l.course_id = v_course and lp.completed) = v_total then
    insert into certificates (user_id, course_id) values (auth.uid(), v_course) on conflict do nothing;
  end if;
  return v_pct;
end $$;
revoke execute on function record_watch(uuid, numeric) from public, anon;
grant execute on function record_watch(uuid, numeric) to authenticated;

-- old entry point goes through the same rules
create or replace function record_progress(p_lecture uuid, p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
begin perform record_watch(p_lecture, p_pct); end $$;

create index if not exists lecture_progress_recent on lecture_progress (updated_at desc);
create index if not exists course_views_course_month on course_views (course_id, month);

-- ---------- per-course analytics (admin: all courses, instructor: own courses) ----------
create or replace function course_stats()
returns table (course_id uuid, title text, kind course_kind, status text, slug text,
               instructor_id uuid, instructor_name text, featured_names text,
               lectures int, views_month bigint, views_total bigint, viewers_total bigint,
               watching_now bigint, active_today bigint, certificates bigint,
               est_earnings_month numeric, earned_closed numeric, last_view_at timestamptz)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', now())::date as month),
       pct as (select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) as v),
       pool_now as (
         select (select coalesce(sum(p.amount_egp), 0) from payments p, m
                  where p.purpose = 'subscription' and p.status = 'paid' and date_trunc('month', p.paid_at)::date = m.month) as income,
                (select count(*) from course_views cv join courses c on c.id = cv.course_id, m
                  where cv.month = m.month and c.kind = 'recorded') as total),
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
         case when c.kind = 'recorded' and (select total from pool_now) > 0
              then round((select income from pool_now) / (select total from pool_now)
                         * (select count(*) from course_views v, m where v.course_id = c.id and v.month = m.month)
                         * (select v from pct) / 100, 2) else 0 end,
         coalesce((select round(sum(mp.subscription_income / nullif(mp.total_views, 0) * x.n * mp.instructor_pct / 100), 2)
                     from (select v.month, count(*) n from course_views v where v.course_id = c.id group by v.month) x
                     join month_pools mp on mp.month = x.month), 0),
         (select max(v.counted_at) from course_views v where v.course_id = c.id)
    from mine c
   order by 10 desc, 11 desc, c.created_at desc;
$$;
revoke execute on function course_stats() from public, anon;
grant execute on function course_stats() to authenticated;
