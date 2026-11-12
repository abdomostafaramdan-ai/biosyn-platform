-- Free preview: the first lecture of every recorded course is open to any signed-in visitor so they can see the
-- instructor's style before subscribing. Previews are never a "paid view": they do not earn the instructor anything,
-- do not issue certificates and now leave no progress row either, so they do not touch learner counts or stats.

-- 1) previews leave no trace in progress / stats (subscribers are unaffected)
create or replace function public.record_watch(p_lecture uuid, p_pct numeric)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare v_course uuid; v_kind course_kind; v_dur int; v_inst uuid; v_total int; v_full boolean;
        v_old lecture_progress; v_cap numeric; v_pct numeric;
begin
  select l.course_id, c.kind, l.duration_seconds, c.instructor_id into v_course, v_kind, v_dur, v_inst
    from lectures l join courses c on c.id = l.course_id where l.id = p_lecture;
  if v_course is null or auth.uid() is null or not can_watch_lecture(auth.uid(), p_lecture) then
    raise exception 'not allowed';
  end if;
  if not lecture_unlocked(auth.uid(), p_lecture) then raise exception 'lecture locked'; end if;
  v_full := can_watch(auth.uid(), v_course);
  if not v_full then return greatest(0, least(coalesce(p_pct, 0), 100)); end if;   -- free preview: nothing is recorded

  select * into v_old from lecture_progress where user_id = auth.uid() and lecture_id = p_lecture for update;
  v_pct := greatest(0, least(coalesce(p_pct, 0), 100));
  if v_dur is not null and v_dur > 0 then
    v_cap := coalesce(v_old.max_pct, 0)
           + (case when v_old.user_id is null then 60 else least(extract(epoch from (now() - v_old.updated_at)), 60) + 20 end) * 2.5 / v_dur * 100;
    v_pct := least(v_pct, v_cap);
  end if;

  insert into lecture_progress (user_id, lecture_id, max_pct, completed)
  values (auth.uid(), p_lecture, round(v_pct, 2), v_pct >= 95)
  on conflict (user_id, lecture_id) do update
    set max_pct    = greatest(lecture_progress.max_pct, round(v_pct, 2)),
        completed  = lecture_progress.completed or v_pct >= 95,
        updated_at = now()
  returning max_pct into v_pct;

  if v_kind = 'recorded' and v_pct >= 50 and auth.uid() is distinct from v_inst then
    insert into course_views (user_id, course_id, month)
    values (auth.uid(), v_course, date_trunc('month', now())::date)
    on conflict do nothing;
  end if;

  select count(*) into v_total from lectures where course_id = v_course;
  if v_total > 0 and (select count(*) from lecture_progress lp join lectures l on l.id = lp.lecture_id
                      where lp.user_id = auth.uid() and l.course_id = v_course and lp.completed) = v_total then
    insert into certificates (user_id, course_id) values (auth.uid(), v_course) on conflict do nothing;
  end if;
  return v_pct;
end $$;

-- 2) the first lecture of every recorded course is a free preview, now and for every new course
create or replace function public.ensure_first_preview(p_course uuid) returns void
language sql security definer set search_path to 'public' as $$
  update lectures set is_preview = true
   where id = (select l.id from lectures l join courses c on c.id = l.course_id
                where l.course_id = p_course and c.kind = 'recorded' order by l.position, l.id limit 1)
     and not is_preview;
$$;
revoke all on function public.ensure_first_preview(uuid) from public, anon, authenticated;

create or replace function public.trg_first_preview() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform ensure_first_preview(coalesce(new.course_id, old.course_id));
  return null;
end $$;
drop trigger if exists first_preview on public.lectures;
create trigger first_preview after insert or delete or update of position, course_id on public.lectures
  for each row execute function trg_first_preview();

select ensure_first_preview(id) from courses where kind = 'recorded';
