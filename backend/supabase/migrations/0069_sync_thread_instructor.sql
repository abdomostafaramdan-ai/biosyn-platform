-- keep course threads pointed at the course's current instructor
create or replace function public.trg_sync_course_threads() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.instructor_id is distinct from old.instructor_id then
    update threads set instructor_id = new.instructor_id where kind = 'course' and course_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists sync_course_threads on public.courses;
create trigger sync_course_threads after update of instructor_id on public.courses
for each row execute function public.trg_sync_course_threads();
update public.threads t set instructor_id = c.instructor_id from public.courses c
 where t.kind = 'course' and t.course_id = c.id and t.instructor_id is distinct from c.instructor_id;
