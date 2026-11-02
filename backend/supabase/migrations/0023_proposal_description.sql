-- Recorded-course wizard: full description + free-text specialty; copy both into the course on accept.
alter table course_proposals add column if not exists description text;
alter table course_proposals drop constraint if exists course_proposals_desc_len;
alter table course_proposals add constraint course_proposals_desc_len check (description is null or length(description) <= 10000);

create or replace function public.submit_course_proposal(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare p course_proposals; n int;
begin
  select * into p from course_proposals where id = p_id and user_id = auth.uid() for update;
  if p.id is null then raise exception 'not found'; end if;
  if p.status <> 'draft' then raise exception 'already submitted'; end if;
  if coalesce(btrim(p.title), '') = '' or coalesce(btrim(p.name), '') = '' or coalesce(btrim(p.email), '') = '' then raise exception 'missing info'; end if;
  select count(*) into n from proposal_lessons where proposal_id = p_id;
  if n = 0 then raise exception 'no lessons'; end if;
  update course_proposals set status = 'submitted', submitted_at = now(), updated_at = now() where id = p_id;
  insert into requests (type, name, email, phone, payload, user_id)
  values ('instructor_recorded', p.name, p.email, p.phone,
          jsonb_strip_nulls(jsonb_build_object('عنوان الكورس', p.title, 'التخصص', p.specialty, 'المستوى', p.level, 'الفئة المستهدفة', p.audience,
                             'نبذة قصيرة', p.summary, 'الوصف الكامل', p.description,
                             'عدد الدروس', n, 'الدروس بفيديو', (select count(*) from proposal_lessons where proposal_id = p_id and (uploaded or video_url is not null)),
                             'proposal_id', p_id)), p.user_id);
end $function$;

create or replace function public.accept_course_proposal(p_id uuid)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare p course_proposals; cid uuid; slug text; l proposal_lessons; lid uuid; fid uuid; pos int := 0;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into p from course_proposals where id = p_id for update;
  if p.id is null then raise exception 'not found'; end if;
  if p.course_id is not null then return p.course_id; end if;
  slug := left(regexp_replace(lower(coalesce(p.title, 'course')), '[^a-z0-9]+', '-', 'g'), 50);
  slug := trim(both '-' from slug); if slug = '' then slug := 'course'; end if;
  slug := slug || '-' || substr(replace(p.id::text, '-', ''), 1, 6);
  update profiles set role = 'instructor' where id = p.user_id and role::text = 'student';
  select id into fid from featured_instructors where profile_id = p.user_id limit 1;
  if fid is null then
    insert into featured_instructors (name, profile_id, visible, sort) values (coalesce(p.name, 'محاضر'), p.user_id, false, 1000) returning id into fid;
  end if;
  insert into courses (title, slug, kind, status, level, specialty, faculty, summary, description, instructor_id, featured_instructor_id, featured_instructor_ids)
  values (coalesce(p.title, 'كورس جديد'), slug, 'recorded', 'draft',
          case p.level when 'مبتدئ' then 'beginner' when 'متوسط' then 'intermediate' when 'متقدم' then 'advanced' when 'مبتدئ ومتوسط' then 'beginner_intermediate' when 'متوسط ومتقدم' then 'intermediate_advanced' when 'كل المستويات' then 'all_levels' else 'beginner' end,
          p.specialty, p.faculty, p.summary, p.description, p.user_id, fid, array[fid])
  returning id into cid;
  for l in select * from proposal_lessons where proposal_id = p_id order by position, created_at loop
    pos := pos + 1;
    insert into lectures (course_id, position, title) values (cid, pos, l.title) returning id into lid;
    if l.bunny_video_id is not null then insert into lecture_videos (lecture_id, bunny_video_id, bunny_library_id) values (lid, l.bunny_video_id, l.bunny_library_id); end if;
  end loop;
  update course_proposals set status = 'accepted', course_id = cid, updated_at = now() where id = p_id;
  return cid;
end $function$;
