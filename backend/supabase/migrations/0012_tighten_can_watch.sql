create or replace function i_can_watch(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select can_watch_lecture(auth.uid(), lid) $$;
revoke execute on function i_can_watch(uuid) from public, anon;
grant execute on function i_can_watch(uuid) to authenticated;

drop policy lecture_files_read on lecture_files;
create policy lecture_files_read on lecture_files for select to authenticated
  using (is_staff() or can_edit_lecture(lecture_id) or i_can_watch(lecture_id));
drop policy lecture_files_obj_read on storage.objects;
create policy lecture_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'lecture-files' and (is_staff() or can_edit_lecture(storage_lecture_id(name)) or i_can_watch(storage_lecture_id(name))));
revoke execute on function can_watch_lecture(uuid, uuid) from authenticated;
