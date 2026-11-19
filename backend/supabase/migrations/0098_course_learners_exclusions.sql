-- The public "N students watched the course" counter skips the same accounts as paid views:
-- admins, the course's instructor, and the accounts in app_settings 'view_exclude'.
create or replace function public.course_learners(p_course uuid)
returns integer
language sql stable security definer set search_path = public
as $function$
  select case c.kind
    when 'interactive' then (select count(*)::int from enrollments e where e.course_id = c.id and view_counts(e.user_id, c.id))
    else (select count(distinct lp.user_id)::int from lecture_progress lp join lectures l on l.id = lp.lecture_id
           where l.course_id = c.id and view_counts(lp.user_id, c.id)) end
  from courses c where c.id = p_course and c.status = 'published';
$function$;
