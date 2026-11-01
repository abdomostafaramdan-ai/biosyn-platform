-- Recorded-course proposals from the "Teach with us" wizard: instructor uploads lesson videos to Bunny,
-- the team reviews them in the dashboard and can turn an accepted proposal into a draft course.
create table if not exists course_proposals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text, email text, phone text,
  title        text, specialty text, faculty text, level text, audience text, summary text,
  status       text not null default 'draft' check (status in ('draft','submitted','in_review','accepted','rejected')),
  course_id    uuid references courses(id) on delete set null,
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table course_proposals enable row level security;
create policy cp_owner_read on course_proposals for select to authenticated using (user_id = auth.uid() or is_staff());
create policy cp_owner_insert on course_proposals for insert to authenticated with check (user_id = auth.uid() and status = 'draft');
create policy cp_owner_update on course_proposals for update to authenticated using (user_id = auth.uid() and status = 'draft') with check (user_id = auth.uid() and status in ('draft','submitted'));
create policy cp_staff_update on course_proposals for update to authenticated using (is_staff()) with check (is_staff());
create index if not exists course_proposals_user_idx on course_proposals (user_id, created_at desc);

create table if not exists proposal_lessons (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references course_proposals(id) on delete cascade,
  position       int not null default 0,
  title          text not null check (length(btrim(title)) between 1 and 200),
  bunny_video_id text,
  video_url      text check (video_url is null or video_url ~ '^https://'),
  file_name      text,
  size_bytes     bigint,
  uploaded       boolean not null default false,
  created_at     timestamptz not null default now()
);
alter table proposal_lessons enable row level security;
create policy pl_read on proposal_lessons for select to authenticated using (exists (select 1 from course_proposals p where p.id = proposal_id and (p.user_id = auth.uid() or is_staff())));
create policy pl_owner_write on proposal_lessons for all to authenticated
  using (exists (select 1 from course_proposals p where p.id = proposal_id and p.user_id = auth.uid() and p.status = 'draft'))
  with check (exists (select 1 from course_proposals p where p.id = proposal_id and p.user_id = auth.uid() and p.status = 'draft'));
create index if not exists proposal_lessons_idx on proposal_lessons (proposal_id, position);

-- submit: owner moves draft -> submitted, which also files a request (inbox, email, CRM)
create or replace function submit_course_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
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
          jsonb_build_object('عنوان الكورس', p.title, 'التخصص', p.specialty, 'المستوى', p.level, 'الفئة المستهدفة', p.audience,
                             'عدد الدروس', n, 'الدروس بفيديو', (select count(*) from proposal_lessons where proposal_id = p_id and (uploaded or video_url is not null)),
                             'proposal_id', p_id), p.user_id);
end $$;
revoke execute on function submit_course_proposal(uuid) from public, anon;
grant execute on function submit_course_proposal(uuid) to authenticated;

-- accept: admin turns a proposal into a draft course with lectures (videos already in Bunny)
create or replace function accept_course_proposal(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
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
  insert into courses (title, slug, kind, status, level, specialty, faculty, summary, instructor_id, featured_instructor_id, featured_instructor_ids)
  values (coalesce(p.title, 'كورس جديد'), slug, 'recorded', 'draft',
          case p.level when 'مبتدئ' then 'beginner' when 'متوسط' then 'intermediate' when 'متقدم' then 'advanced' else 'beginner' end,
          p.specialty, p.faculty, p.summary, p.user_id, fid, array[fid])
  returning id into cid;
  for l in select * from proposal_lessons where proposal_id = p_id order by position, created_at loop
    pos := pos + 1;
    insert into lectures (course_id, position, title) values (cid, pos, l.title) returning id into lid;
    if l.bunny_video_id is not null then insert into lecture_videos (lecture_id, bunny_video_id) values (lid, l.bunny_video_id); end if;
  end loop;
  update course_proposals set status = 'accepted', course_id = cid, updated_at = now() where id = p_id;
  return cid;
end $$;
revoke execute on function accept_course_proposal(uuid) from public, anon;
grant execute on function accept_course_proposal(uuid) to authenticated;

-- Bunny Stream API key (library API key, used server-side to create upload slots)
create or replace function integration_keys() returns text[] language sql immutable set search_path = public as $$
  select array[
    'PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','FEE_PAYMOB_PCT','FEE_PAYMOB_FIXED',
    'FAWATERK_API_KEY','FAWATERK_BASE_URL','FEE_FAWATERK_PCT','FEE_FAWATERK_FIXED',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FEE_STRIPE_PCT','FEE_STRIPE_FIXED',
    'BUNNY_LIBRARY_ID','BUNNY_TOKEN_KEY','BUNNY_API_KEY',
    'RESEND_API_KEY','MAIL_FROM',
    'META_PIXEL_ID','META_CAPI_TOKEN','GA4_ID',
    'ANTHROPIC_API_KEY',
    'CRM_URL','CRM_WOO_SECRET'
  ]::text[];
$$;
revoke execute on function integration_keys() from public, anon, authenticated;

-- is video upload available? (public, no secrets exposed)
create or replace function uploads_ready() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from integration_secrets where key = 'BUNNY_API_KEY') and exists (select 1 from integration_secrets where key = 'BUNNY_LIBRARY_ID');
$$;
grant execute on function uploads_ready() to anon, authenticated;

-- the Bunny video id is only set by the upload Edge Function (service role), never by the browser
create or replace function trg_lesson_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.bunny_video_id := null; new.uploaded := false;
    else new.bunny_video_id := old.bunny_video_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists lesson_guard on proposal_lessons;
create trigger lesson_guard before insert or update on proposal_lessons for each row execute function trg_lesson_guard();
