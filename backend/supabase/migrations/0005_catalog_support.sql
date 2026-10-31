alter table courses add column if not exists level text check (level in ('beginner','intermediate','advanced')) default 'beginner';
alter table courses add column if not exists cover_code text;
alter table courses add column if not exists description text;

create or replace view public_instructors as
  select id, full_name from profiles where role = 'instructor';
grant select on public_instructors to anon, authenticated;

create policy courses_public_read on courses for select to anon using (status = 'published');
create policy lectures_public_read on lectures for select to anon using (
  exists (select 1 from courses c where c.id = course_id and c.status = 'published'));

-- anon cannot execute is_admin()/is_staff(); policies that use them must not apply to anon
alter policy plans_admin   on plans   to authenticated;
alter policy courses_read  on courses to authenticated;
alter policy courses_admin on courses to authenticated;
alter policy courses_inst  on courses to authenticated;
alter policy lectures_read  on lectures to authenticated;
alter policy lectures_write on lectures to authenticated;
alter policy profiles_self   on profiles to authenticated;
alter policy profiles_update on profiles to authenticated;
alter policy profiles_admin  on profiles to authenticated;
alter policy requests_staff  on requests to authenticated;
alter policy requests_update on requests to authenticated;
alter policy requests_create on requests to anon, authenticated;

-- the 6 recorded courses currently on the live site; kept as DRAFT until lectures are added
insert into courses (kind, slug, title, cover_code, level, status) values
  ('recorded','introduction-to-genetics-engineering','Introduction To Genetics Engineering','GE','beginner','draft'),
  ('recorded','introduction-to-gentics','Introduction To Gentics','GN','beginner','draft'),
  ('recorded','molecular-biology','Molecular Biology','MB','beginner','draft'),
  ('recorded','computational-neuroscience','Computational Neuroscience','CN','beginner','draft'),
  ('recorded','introduction-to-immunology','Introduction To Immunology','IM','beginner','draft'),
  ('recorded','some-concepts-in-clinical-research','Some concepts in clinical research','CR','beginner','draft');
