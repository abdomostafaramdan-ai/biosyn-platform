-- Level ranges, "all faculties" option, and a site instructor (name + bio, no account needed) per course.
alter table courses drop constraint if exists courses_level_check;
alter table courses add constraint courses_level_check check (level in ('beginner','beginner_intermediate','intermediate','intermediate_advanced','advanced','all_levels'));
alter table courses drop constraint if exists courses_faculty_check;
alter table courses add constraint courses_faculty_check check (faculty is null or faculty in ('all','science','biotech','pharmacy','agriculture','medicine','veterinary','dentistry','health_tech'));
alter table courses add column if not exists featured_instructor_id uuid references featured_instructors(id) on delete set null;
