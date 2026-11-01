-- A course can show several instructors (site profiles). featured_instructor_id stays as the first one; instructor_id stays the earnings account.
alter table courses add column if not exists featured_instructor_ids uuid[] not null default '{}';
update courses set featured_instructor_ids = array[featured_instructor_id] where featured_instructor_id is not null and featured_instructor_ids = '{}';
