-- Every platform sign-up (students and instructors) reaches the CRM within a minute, and later profile edits follow.
create or replace function public.crm_student_activity(p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; n int := 0;
begin
  for r in
    select u.id, p.role::text urole, lower(u.email) email, p.full_name, coalesce(nullif(p.phone, ''), p.whatsapp) phone, p.created_at, u.last_sign_in_at, p.banned_at,
           (select rp.full_name from profiles rp where rp.id = p.referred_by) ref_name,
           (select coalesce(round(sum(cw.seconds) / 60), 0) from course_watch cw where cw.user_id = u.id) wmin,
           (select coalesce(round(sum(cw.seconds) / 60), 0) from course_watch cw where cw.user_id = u.id and cw.updated_at > now() - interval '30 days') w30,
           (select max(cw.updated_at) from course_watch cw where cw.user_id = u.id) last_watch,
           (select count(distinct cw.course_id) from course_watch cw where cw.user_id = u.id) courses,
           (select count(*) from lecture_progress lp where lp.user_id = u.id and lp.completed) lec_done,
           (select count(*) from certificates c where c.user_id = u.id) certs,
           (select v.source from visits v where v.vid in (select vv.vid from visits vv where vv.user_id = u.id) and v.source <> 'direct' order by v.at limit 1) src_first,
           (select v.source from visits v where v.vid in (select vv.vid from visits vv where vv.user_id = u.id) and v.at <= p.created_at + interval '1 hour' order by v.at desc limit 1) src_signup,
           exists (select 1 from visits v where v.user_id = u.id) has_visits,
           exists (select 1 from email_optouts o where o.email = lower(u.email)) optout
      from auth.users u join profiles p on p.id = u.id
     where p.role::text in ('student', 'instructor') and (p_user is null or u.id = p_user) and not is_excluded_email(u.email)
  loop
    v := jsonb_build_object('id', 'act-' || r.id, 'biosyn_event', 'activity', 'email', r.email, 'name', left(coalesce(r.full_name, ''), 80),
      'phone', coalesce(r.phone, ''), 'signup', to_char(r.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
      'last_login', coalesce(to_char(r.last_sign_in_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), ''),
      'wmin', r.wmin, 'w30', r.w30, 'last_watch', coalesce(to_char(r.last_watch at time zone 'Africa/Cairo', 'YYYY-MM-DD'), ''),
      'courses', r.courses, 'lec_done', r.lec_done, 'certs', r.certs,
      'src_first', coalesce(crm_src_label(r.src_first), case when r.has_visits then 'مباشر' else '' end),
      'src_signup', coalesce(crm_src_label(r.src_signup), ''), 'ref', coalesce(r.ref_name, ''),
      'banned', r.banned_at is not null, 'optout', r.optout, 'role', r.urole);
    insert into crm_outbox (dedupe_key, kind, payload) values ('act:' || r.id || ':' || md5(v::text), 'order', v)
    on conflict (dedupe_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.crm_student_activity(uuid) from public, anon, authenticated;

create or replace function public.crm_profile_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text in ('student', 'instructor') then
    begin
      perform crm_student_activity(new.id);
    exception when others then
      raise warning 'crm_profile_sync: %', sqlerrm;  -- never block a sign-up
    end;
  end if;
  return new;
end $$;
revoke all on function public.crm_profile_sync() from public, anon, authenticated;

create or replace trigger crm_profile_sync after insert or update of full_name, phone, whatsapp, role, banned_at on public.profiles
  for each row execute function public.crm_profile_sync();

select cron.alter_job((select jobid from cron.job where jobname = 'crm-sync'), schedule := '* * * * *');
