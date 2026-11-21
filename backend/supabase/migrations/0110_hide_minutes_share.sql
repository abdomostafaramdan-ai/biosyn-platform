-- Instructors no longer see their share of all platform minutes (staff still do).

create or replace function public.instructor_watch_summary(p_user uuid default null)
returns json
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_uid uuid := case when p_user is not null and is_staff() then p_user else auth.uid() end;
  v_m date := date_trunc('month', now())::date; v_tot numeric; v_mine numeric;
begin
  if v_uid is null then raise exception 'not allowed'; end if;
  select coalesce(sum(w.seconds), 0) into v_tot from course_watch w join courses c on c.id = w.course_id
   where w.month = v_m and c.kind = 'recorded';
  select coalesce(sum(w.seconds), 0) into v_mine from course_watch w join courses c on c.id = w.course_id
   where w.month = v_m and c.kind = 'recorded' and c.instructor_id = v_uid;
  return json_build_object(
    'month', v_m,
    'my_minutes', round(v_mine / 60, 1),
    'share_pct', case when v_tot > 0 and (is_admin() or is_staff()) then round(100 * v_mine / v_tot, 1) end,   -- staff only
    'learners', (select count(distinct w.user_id) from course_watch w join courses c on c.id = w.course_id
                  where w.month = v_m and c.instructor_id = v_uid),
    'months', (select json_agg(json_build_object(
                  'month', g.m::date,
                  'minutes', coalesce((select round(sum(w.seconds) / 60, 1) from course_watch w join courses c on c.id = w.course_id
                                        where w.month = g.m::date and c.instructor_id = v_uid), 0),
                  'learners', (select count(distinct w.user_id) from course_watch w join courses c on c.id = w.course_id
                                where w.month = g.m::date and c.instructor_id = v_uid)) order by g.m)
                 from generate_series(v_m - interval '5 months', v_m::timestamp, interval '1 month') g(m)));
end $function$;
revoke all on function public.instructor_watch_summary(uuid) from public, anon;
grant execute on function public.instructor_watch_summary(uuid) to authenticated;
