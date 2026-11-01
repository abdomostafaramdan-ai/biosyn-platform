-- Live platform numbers for the home page (counts only, no personal data).
create or replace function public_stats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'students',    (select count(*) from profiles where role::text = 'student'),
    'countries',   (select count(distinct lower(btrim(country))) from profiles where nullif(btrim(country),'') is not null),
    'courses',     (select count(*) from courses where status::text = 'published'),
    'instructors', (select count(*) from profiles where role::text = 'instructor'),
    'minutes',     (select coalesce(round(sum(least(lp.max_pct,100) / 100.0 * coalesce(l.duration_seconds,0)) / 60), 0)
                      from lecture_progress lp join lectures l on l.id = lp.lecture_id));
$$;
revoke execute on function public_stats() from public;
grant execute on function public_stats() to anon, authenticated;
