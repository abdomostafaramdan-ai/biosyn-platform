-- Views that pay instructors (course_views) no longer count:
--   * admins (staff testing the platform),
--   * the course's own instructor (already excluded before),
--   * accounts listed in app_settings 'view_exclude' ({"emails": [...]}) — the owner's personal account.
-- Existing views from these accounts in months that aren't closed yet are removed.

create or replace function public.view_counts(p_user uuid, p_course uuid)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select p_user is not null
     and not exists (select 1 from profiles where id = p_user and role = 'admin')
     and not exists (select 1 from courses where id = p_course and instructor_id = p_user)
     and not exists (select 1 from auth.users u where u.id = p_user and lower(u.email) in (
           select lower(e) from jsonb_array_elements_text(coalesce(
             (select value::jsonb -> 'emails' from app_settings where key = 'view_exclude' and value ~ '^\s*\{'), '[]')) e));
$function$;
revoke all on function public.view_counts(uuid, uuid) from public, anon, authenticated;

insert into app_settings (key, value) values ('view_exclude', '{"emails":["abdomostafamohamedramdan@gmail.com"]}')
on conflict (key) do update set value = excluded.value;

create or replace function public.record_watch(p_lecture uuid, p_pct numeric)
returns numeric
language plpgsql security definer set search_path = public
as $function$
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

  if v_kind = 'recorded' and v_pct >= 50 and view_counts(auth.uid(), v_course) then
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
end $function$;

-- clean the open months (closed months keep their numbers: earnings were already calculated from them)
delete from course_views cv
 where not view_counts(cv.user_id, cv.course_id)
   and not exists (select 1 from month_pools m where m.month = cv.month and m.closed_at is not null);
