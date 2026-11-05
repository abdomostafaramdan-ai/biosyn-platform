-- «من نحن» page: editable text (admin) + live counters (students, countries) that only go up.
create table if not exists site_content (
  key        text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table site_content enable row level security;
drop policy if exists site_content_read on site_content;
create policy site_content_read on site_content for select using (true);
drop policy if exists site_content_admin on site_content;
create policy site_content_admin on site_content for all using (is_admin()) with check (is_admin());
grant select on site_content to anon, authenticated;
grant insert, update on site_content to authenticated;
insert into site_content (key, data) values ('about', jsonb_build_object(
  'founded', 2020, 'base_students', 20000, 'base_countries', 7, 'known_countries', jsonb_build_array('EG'))) on conflict do nothing;

-- students = everyone served before the platform (base) + every account on the platform
-- countries = the base countries + every new country we see (student profiles or visits) that isn't one of the known base ones
create or replace function about_stats() returns json
language sql stable security definer set search_path = public as $$
  with a as (select data from site_content where key = 'about'),
       known as (select upper(jsonb_array_elements_text(coalesce((select data from a)->'known_countries', '["EG"]'::jsonb))) cc),
       seen as (select upper(country) cc from profiles where country ~* '^[a-z]{2}$'
                union select country from visits where country ~ '^[A-Z]{2}$' group by country having count(distinct vid) >= 5)
  select json_build_object(
    'students',  coalesce(((select data from a)->>'base_students')::int, 20000) + (select count(*) from profiles where role = 'student'),
    'countries', coalesce(((select data from a)->>'base_countries')::int, 7) + (select count(*) from seen where cc not in (select cc from known)),
    'courses',   (select count(*) from courses where status = 'published'),
    'instructors', (select count(*) from featured_instructors where visible),
    'years',     extract(year from now())::int - coalesce(((select data from a)->>'founded')::int, 2020));
$$;
grant execute on function about_stats() to anon, authenticated;
