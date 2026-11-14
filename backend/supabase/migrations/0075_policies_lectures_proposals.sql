-- 0075: applied to live DB (lectures, lecture_videos, course_proposals policies)

-- Instructors may only edit lectures / lecture videos of DRAFT courses; published or archived
-- courses are changed by admins only (stops swapping Bunny video ids on live courses).
drop policy if exists lectures_write on public.lectures;
create policy lectures_write on public.lectures for all to authenticated
  using (is_admin() or exists (select 1 from courses c where c.id = lectures.course_id and c.instructor_id = auth.uid() and c.status = 'draft'))
  with check (is_admin() or exists (select 1 from courses c where c.id = lectures.course_id and c.instructor_id = auth.uid() and c.status = 'draft'));

drop policy if exists lvideos_manage on public.lecture_videos;
create policy lvideos_manage on public.lecture_videos for all to authenticated
  using (is_admin() or exists (select 1 from lectures l join courses c on c.id = l.course_id where l.id = lecture_videos.lecture_id and c.instructor_id = auth.uid() and c.status = 'draft'))
  with check (is_admin() or exists (select 1 from lectures l join courses c on c.id = l.course_id where l.id = lecture_videos.lecture_id and c.instructor_id = auth.uid() and c.status = 'draft'));

-- Proposal owners can edit drafts but can no longer set status = 'submitted' themselves
-- (submit_course_proposal checks the signed contract and is the only way).
drop policy if exists cp_owner_update on public.course_proposals;
create policy cp_owner_update on public.course_proposals for update to authenticated
  using (user_id = auth.uid() and status = 'draft')
  with check (user_id = auth.uid() and status = 'draft');

