-- Admins can pardon screen-capture incidents (e.g. after reviewing a ban): pardoned incidents stay on record
-- but no longer count as strikes toward the automatic ban.
alter table public.security_incidents add column if not exists pardoned_at timestamptz;

create or replace function public.report_security_incident(p_kind text, p_lecture uuid default null::uuid, p_detail jsonb default '{}'::jsonb)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  v_uid uuid := auth.uid(); v_role text; v_cfg jsonb := security_settings(); v_strikes int; v_action text := 'logged';
  v_name text; v_email text; a record; v_detail jsonb;
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
      v_action := 'banned';
    else
      v_action := 'warned';
    end if;
  end if;
  insert into security_incidents (user_id, kind, lecture_id, detail, action) values (v_uid, p_kind, p_lecture, v_detail, v_action);
  if v_action = 'banned' then
    perform apply_user_ban(v_uid, 'حظر تلقائي: محاولة تصوير أو تسجيل الشاشة أثناء مشاهدة المحاضرات', null);
  end if;
  if v_action = 'banned' or not exists (select 1 from security_incidents where user_id = v_uid and kind = p_kind
                                         and created_at > now() - interval '1 hour' and created_at < now()) then
    select email into v_email from auth.users where id = v_uid;
    for a in select id from profiles where role = 'admin' loop
      perform notify_user(a.id, 'n:sec:' || gen_random_uuid(), case when v_action = 'banned' then 'warning' else 'info' end,
        case when v_action = 'banned' then '🚫 تم حظر حساب تلقائيًا' else '⚠️ تنبيه أمني على المحاضرات' end,
        coalesce(v_name, '') || ' (' || coalesce(v_email, '') || ') · ' ||
        case p_kind when 'capture_shortcut' then 'محاولة تصوير الشاشة' when 'record_shortcut' then 'محاولة تسجيل الشاشة' else 'فتح أدوات المطوّر' end
        || case when v_action = 'banned' then ' — الحساب اتحظر واشتراكه اتلغى.' else '' end,
        'admin.html#security');
    end loop;
  end if;
  return json_build_object('action', v_action, 'strikes', v_strikes);
end $function$;
