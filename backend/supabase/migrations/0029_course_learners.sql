-- public learner count for a course page: recorded = students who started watching, interactive = enrolled
create or replace function course_learners(p_course uuid) returns int
language sql stable security definer set search_path = public as $$
  select case c.kind
    when 'interactive' then (select count(*)::int from enrollments e where e.course_id = c.id)
    else (select count(distinct lp.user_id)::int from lecture_progress lp join lectures l on l.id = lp.lecture_id
           where l.course_id = c.id and lp.user_id is distinct from c.instructor_id) end
  from courses c where c.id = p_course and c.status = 'published';
$$;
revoke execute on function course_learners(uuid) from public;
grant execute on function course_learners(uuid) to anon, authenticated;
