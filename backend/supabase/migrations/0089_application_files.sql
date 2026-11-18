-- CV + degree certificate on the "join as instructor" forms (interactive course / help recording a course).
-- Those forms work without an account, so visitors may upload (insert only) into a random-UUID folder of a private
-- bucket; nobody but the team can read, list, overwrite or delete. 6 MB, PDF / Word / images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applications', 'applications', false, 6291456,
        array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'applications_insert') then
    create policy applications_insert on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'applications'
                  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  and array_length(storage.foldername(name), 1) = 1);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'applications_staff_read') then
    create policy applications_staff_read on storage.objects for select to authenticated using (bucket_id = 'applications' and is_staff());
  end if;
end $do$;
