-- Screen-capture shortcuts no longer ban the account or cancel the subscription.
--   1st strike (by default): the student gets a warning on screen AND a notification in the bell.
--   'ban_after'-th strike: the subscription is paused automatically (remaining time kept), the student is notified,
--   admins are notified with a link to resume. Nothing is cancelled, the account stays signed in.
--   Resuming a subscription (any admin path) pardons the student's capture incidents, so strikes start over.
--   Manual bans from the security page (admin_ban_user) are unchanged.

alter table public.security_incidents drop constraint if exists security_incidents_action_check;
alter table public.security_incidents add constraint security_incidents_action_check
  check (action in ('logged', 'warned', 'banned', 'paused'));

create or replace function public.auto_pause_subscription(p_user uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public
as $function$
declare n int;
begin
  update subscriptions
     set pause_remaining = ends_at - greatest(starts_at, now()),
         pause_offset = greatest(starts_at - now(), interval '0'),
         starts_at = least(starts_at, now() - interval '1 second'),
         ends_at = now() - interval '1 second', status = 'paused', paused_at = now()
   where user_id = p_user and status = 'active' and ends_at > now();
  get diagnostics n = row_count;
  if n > 0 then
    insert into subscription_events (user_id, action, note, by_user) values (p_user, 'pause', left('إيقاف تلقائي: ' || p_reason, 300), null);
  end if;
  return n > 0;
end $function$;
revoke all on function public.auto_pause_subscription(uuid, text) from public, anon, authenticated;

create or replace function public.report_security_incident(p_kind text, p_lecture uuid default null::uuid, p_detail jsonb default '{}'::jsonb)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  v_uid uuid := auth.uid(); v_role text; v_cfg jsonb := security_settings(); v_strikes int; v_action text := 'logged';
  v_name text; v_email text; a record; v_detail jsonb; v_paused boolean := false; v_what text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_kind not in ('capture_shortcut', 'devtools', 'record_shortcut') then raise exception 'bad kind'; end if;
  select role::text, full_name into v_role, v_name from profiles where id = v_uid;
  if (select banned_at from profiles where id = v_uid) is not null then return json_build_object('action', 'banned'); end if;
  if (select count(*) from security_incidents where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    return json_build_object('action', 'logged');
  end if;
  v_detail := jsonb_build_object('ua', left(coalesce(p_detail->>'ua', ''), 300), 'key', left(coalesce(p_detail->>'key', ''), 40),
                                 'screen', left(coalesce(p_detail->>'screen', ''), 40), 'page', left(coalesce(p_detail->>'page', ''), 200));
  select count(*) + 1 into v_strikes from security_incidents
   where user_id = v_uid and kind in ('capture_shortcut', 'record_shortcut') and pardoned_at is null and created_at > now() - interval '30 days';
  if p_kind in ('capture_shortcut', 'record_shortcut') and v_role = 'student' then
    if coalesce((v_cfg->>'auto_ban')::boolean, true) and v_strikes >= greatest(coalesce((v_cfg->>'ban_after')::int, 2), 1) then
      v_action := 'paused';
    else
      v_action := 'warned';
    end if;
  end if;
  insert into security_incidents (user_id, kind, lecture_id, detail, action) values (v_uid, p_kind, p_lecture, v_detail, v_action);
  v_what := case p_kind when 'capture_shortcut' then 'محاولة تصوير الشاشة' when 'record_shortcut' then 'محاولة تسجيل الشاشة' else 'فتح أدوات المطوّر' end;

  if v_action = 'paused' then
    v_paused := auto_pause_subscription(v_uid, v_what || ' أثناء مشاهدة المحاضرات');
    perform notify_user(v_uid, 'n:secpause:' || gen_random_uuid(), 'warning', '⛔ تم إيقاف اشتراكك مؤقتًا',
      'رصدنا تكرار ' || v_what || ' أثناء مشاهدة المحاضرات، فأوقفنا اشتراكك مؤقتًا. المدة المتبقية محفوظة بالكامل، '
      || 'وسنراجع الأمر ونعيد تشغيله. للاستفسار تواصل معنا عبر واتساب 01069151456.', 'account.html#billing');
  elsif v_action = 'warned' then
    perform notify_user(v_uid, 'n:secwarn:' || gen_random_uuid(), 'warning', '⚠️ تحذير: ممنوع تصوير المحاضرات',
      'رصدنا ' || v_what || ' أثناء مشاهدة المحاضرة. المحتوى محمي ومربوط بحسابك، وتكرار المحاولة سيؤدي إلى إيقاف اشتراكك مؤقتًا.',
      'courses.html');
  end if;

  if v_action = 'paused' or not exists (select 1 from security_incidents where user_id = v_uid and kind = p_kind
                                         and created_at > now() - interval '1 hour' and created_at < now()) then
    select email into v_email from auth.users where id = v_uid;
    for a in select id from profiles where role = 'admin' loop
      perform notify_user(a.id, 'n:sec:' || gen_random_uuid(), case when v_action = 'paused' then 'warning' else 'info' end,
        case when v_action = 'paused' then '⛔ تم إيقاف اشتراك مؤقتًا' else '⚠️ تنبيه أمني على المحاضرات' end,
        coalesce(v_name, '') || ' (' || coalesce(v_email, '') || ') · ' || v_what
        || case when v_action = 'paused' then case when v_paused then ' — اشتراكه اتوقف مؤقتًا، وتقدر تستأنفه من صفحة الأمان.' else ' — مكانش عنده اشتراك شغال.' end
                when v_action = 'warned' then ' — خد تحذير.' else '' end,
        'admin.html#security');
    end loop;
  end if;
  return json_build_object('action', v_action, 'strikes', v_strikes, 'paused', v_paused);
end $function$;

-- resuming (from any admin page) clears the student's capture strikes
create or replace function public.admin_sub_resume(p_user uuid, p_note text default null::text)
returns void
language plpgsql security definer set search_path = public
as $function$
declare n int; v_days numeric;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select round(extract(epoch from sum(pause_remaining)) / 86400, 1) into v_days from subscriptions where user_id = p_user and status = 'paused';
  update subscriptions
     set starts_at = case when coalesce(pause_offset, interval '0') > interval '0' then now() + pause_offset else starts_at end,
         ends_at = now() + coalesce(pause_offset, interval '0') + coalesce(pause_remaining, interval '0'),
         status = 'active', paused_at = null, pause_offset = null, pause_remaining = null
   where user_id = p_user and status = 'paused';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not paused'; end if;
  update security_incidents set pardoned_at = now() where user_id = p_user and pardoned_at is null;
  insert into subscription_events (user_id, action, note, by_user) values (p_user, 'resume', nullif(btrim(p_note), ''), auth.uid());
  perform notify_user(p_user, 'n:subresume:' || gen_random_uuid(), 'success', 'تم استئناف اشتراكك',
    'عاد اشتراكك للعمل، والمتبقي ' || coalesce(v_days, 0) || ' يوم.', 'courses.html');
end $function$;
