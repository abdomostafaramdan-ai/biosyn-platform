-- Courses belong to a faculty (كلية) and a specialty within it; the site filters by both.
alter table courses add column if not exists faculty text check (faculty is null or faculty in ('science','biotech','pharmacy','agriculture','medicine','veterinary','dentistry','health_tech'));
create index if not exists courses_faculty_idx on courses (faculty);
