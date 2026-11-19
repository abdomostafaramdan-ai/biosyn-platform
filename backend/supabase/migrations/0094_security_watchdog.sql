-- 0094: Security watchdog («حارس الأمان»).
-- Every 10 minutes security_watchdog() checks the database for vulnerabilities, attacks and bugs,
-- fixes what is safe to fix automatically, and raises an alert (in-app notification for every admin,
-- plus an e-mail for important/critical ones, capped per day to protect the free Resend quota).
-- Admin → «مركز الأمان» lists the alerts; «مسموح» approves an intentional change, «تم الحل» closes it.

-- ---------- tables ----------
create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  category text not null check (category in ('vuln', 'attack', 'bug', 'integrity')),
  title text not null,
  detail text,
  action_taken text,
  status text not null default 'open' check (status in ('open', 'resolved', 'approved')),
  hits int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists security_alerts_open on public.security_alerts (status, last_at desc);
alter table public.security_alerts enable row level security;
drop policy if exists security_alerts_admin on public.security_alerts;
create policy security_alerts_admin on public.security_alerts for select to authenticated using (is_admin());

create table if not exists public.security_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.security_state enable row level security;   -- no policies: functions only

create table if not exists public.blocked_ips (
  ip text primary key, reason text, until timestamptz not null, created_at timestamptz not null default now()
);
alter table public.blocked_ips enable row level security;
drop policy if exists blocked_ips_admin on public.blocked_ips;
create policy blocked_ips_admin on public.blocked_ips for select to authenticated using (is_admin());

create table if not exists public.client_errors (
  id bigserial primary key, at timestamptz not null default now(), msg text not null, src text, page text, ua text, user_id uuid
);
create index if not exists client_errors_at on public.client_errors (at desc);
alter table public.client_errors enable row level security;
drop policy if exists client_errors_admin on public.client_errors;
create policy client_errors_admin on public.client_errors for select to authenticated using (is_admin());

revoke all on public.security_alerts, public.security_state, public.blocked_ips, public.client_errors from anon, authenticated;
grant select on public.security_alerts, public.blocked_ips, public.client_errors to authenticated;  -- RLS: admins only

-- ---------- helpers ----------
create or replace function public.client_ip() returns text language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true)::json->>'cf-connecting-ip', ''),
                  nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''), 'na');
$$;

create or replace function public.ip_blocked() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocked_ips where ip = client_ip() and until > now());
$$;

-- raise / refresh an alert. Notifies on a new alert or when a resolved one comes back; approved keys stay quiet.
create or replace function public.sec_alert(p_key text, p_sev text, p_cat text, p_title text, p_detail text default null, p_action text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r security_alerts; v_new boolean := false; a record; v_icon text;
begin
  select * into r from security_alerts where key = p_key for update;
  if found and r.status = 'approved' then return; end if;
  if not found then
    insert into security_alerts (key, severity, category, title, detail, action_taken) values (p_key, p_sev, p_cat, p_title, p_detail, p_action);
    v_new := true;
  elsif r.status = 'resolved' then
    update security_alerts set status = 'open', severity = p_sev, title = p_title, detail = p_detail, action_taken = coalesce(p_action, action_taken),
           hits = hits + 1, last_at = now(), resolved_at = null, resolved_by = null where id = r.id;
    v_new := true;
  else
    update security_alerts set severity = p_sev, title = p_title, detail = p_detail, action_taken = coalesce(p_action, action_taken),
           hits = hits + 1, last_at = now() where id = r.id;
  end if;
  if not v_new then return; end if;
  v_icon := case p_sev when 'critical' then '🚨' when 'warning' then '⚠️' else 'ℹ️' end;
  for a in select id from profiles where role = 'admin' loop
    perform notify_user(a.id, 'n:secw:' || gen_random_uuid(), case when p_sev = 'info' then 'info' else 'warning' end,
      v_icon || ' ' || p_title, left(coalesce(p_detail, '') || case when p_action is not null then ' — الإجراء: ' || p_action else '' end, 500), 'admin.html#security');
  end loop;
  if p_sev in ('warning', 'critical') and chat_hit('secmail', 15) then
    perform notify_team('secw:' || p_key || ':' || to_char(now(), 'YYYYMMDDHH24'), v_icon || ' تنبيه أمني: ' || p_title,
      email_html(p_title, array_remove(array[
        'الخطورة: <b>' || case p_sev when 'critical' then 'خطير' else 'مهم' end || '</b>',
        esc_html(coalesce(p_detail, '')),
        case when p_action is not null then 'الإجراء التلقائي: <b>' || esc_html(p_action) || '</b>' end], null),
        'مركز الأمان', 'admin.html#security'));
  end if;
end $$;

-- alerts for conditions that clear on their own (queue stuck, service down…) close themselves when the condition is gone
create or replace function public.sec_clear(p_prefix text, p_seen text[]) returns void language sql security definer set search_path = public as $$
  update security_alerts set status = 'resolved', resolved_at = now(), resolved_by = 'تلقائي: المشكلة اختفت'
   where status = 'open' and key like p_prefix || '%' and not (key = any (coalesce(p_seen, '{}')));
$$;

-- ---------- browser error reports (bugs) ----------
create or replace function public.report_client_error(p_msg text, p_src text default null, p_page text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(p_msg), '') is null or ip_blocked() then return; end if;
  if not chat_hit('ce:' || client_ip(), 30) or not chat_hit('ce:all', 3000) then return; end if;
  insert into client_errors (msg, src, page, ua, user_id)
  values (left(p_msg, 400), left(p_src, 300), left(p_page, 200), left(current_setting('request.headers', true)::json->>'user-agent', 200), auth.uid());
  delete from client_errors where at < now() - interval '30 days';
end $$;

-- the public request form limit now also refuses blocked addresses
create or replace function public.request_rate_ok() returns boolean language sql security definer set search_path = public as $$
  select not ip_blocked()
     and chat_hit('rq:' || client_ip(), 30)
     and chat_hit('rq:all', 3000);
$$;

-- ---------- instant alert when someone gets admin/support ----------
create or replace function public.trg_staff_watch() returns trigger language plpgsql security definer set search_path = public as $$
declare v_by text; v_email text;
begin
  if new.role::text in ('admin', 'support') and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    select email into v_email from auth.users where id = new.id;
    select coalesce((select full_name from profiles where id = auth.uid()), case when auth.uid() is null then 'من قاعدة البيانات مباشرة' else 'حساب غير معروف' end) into v_by;
    perform sec_alert('staff:' || new.id, case when new.role::text = 'admin' then 'critical' else 'warning' end, 'integrity',
      'حساب جديد بصلاحية ' || case when new.role::text = 'admin' then 'أدمن' else 'دعم' end,
      coalesce(new.full_name, '') || ' (' || coalesce(v_email, '') || ') — بواسطة: ' || v_by || '. لو ده مش انت، اسحب الصلاحية فورًا وغيّر كلمة مرورك.', null);
  end if;
  return new;
end $$;
drop trigger if exists staff_watch on public.profiles;
create trigger staff_watch after insert or update of role on public.profiles for each row execute function public.trg_staff_watch();

-- ---------- the watchdog ----------
create or replace function public.security_watchdog() returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  r record; n int; v_seen text[] := '{}'; v_fixed int := 0; v_alerts int := 0;
  v_allow jsonb := coalesce((select value from security_state where key = 'anon_fn_allow'), '[]');
  v_staff jsonb := coalesce((select value from security_state where key = 'staff'), '[]');
  v_counts jsonb := coalesce((select value from security_state where key = 'row_counts'), '{}');
  v_new jsonb := '{}'; v_old bigint; v_now bigint; v_t text;
begin
  -- 1) a table without row-level security is open to the whole internet → switch RLS on (no policy = closed to browsers)
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', r.relname);
    perform sec_alert('rls:' || r.relname || ':' || to_char(now(), 'YYYYMMDD'), 'critical', 'vuln', 'جدول كان مفتوح للجميع: ' || r.relname,
      'الجدول كان من غير حماية الصفوف (RLS)، يعني أي زائر كان يقدر يقرأه أو يعدّله.', 'تم تفعيل الحماية تلقائيًا. لو الموقع محتاج يقرأ منه، لازم تتكتب له سياسة قراءة.');
    v_fixed := v_fixed + 1;
  end loop;

  -- 2) TRUNCATE from browser roles skips every row rule → revoke
  for r in select distinct table_name from information_schema.role_table_grants
            where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type = 'TRUNCATE' loop
    execute format('revoke truncate on table public.%I from anon, authenticated', r.table_name);
    v_fixed := v_fixed + 1;
  end loop;

  -- 3) privileged functions must pin search_path (otherwise they can be hijacked)
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    execute format('alter function %s set search_path = public', r.sig);
    perform sec_alert('path:' || r.proname, 'warning', 'vuln', 'دالة بصلاحيات عالية من غير مسار ثابت: ' || r.proname,
      'الدالة دي بتشتغل بصلاحيات كاملة، ومن غير تثبيت المسار ممكن تُخدع وتنفّذ كود تاني.', 'تم تثبيت المسار تلقائيًا.');
    v_fixed := v_fixed + 1;
  end loop;

  -- 4) a NEW privileged function that visitors (not signed in) can call → close it to visitors until approved
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
              and not (v_allow ? p.proname) loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    perform sec_alert('anonfn:' || r.proname, 'warning', 'vuln', 'دالة جديدة كانت متاحة للزوار: ' || r.proname,
      'دالة بصلاحيات كاملة اتضافت وكان أي زائر من غير تسجيل دخول يقدر يشغّلها.',
      'اتقفلت على الزوار تلقائيًا (لسه شغالة للمسجلين). لو مقصود إن الزوار يستخدموها اضغط «مسموح».');
    v_fixed := v_fixed + 1;
  end loop;

  -- 5) staff accounts that were not there before (the trigger alerts instantly; this catches direct changes too)
  for r in select p.id, p.full_name, p.role::text as role, u.email from profiles p join auth.users u on u.id = p.id
            where p.role::text in ('admin', 'support') and not (v_staff ? p.id::text) loop
    perform sec_alert('staff:' || r.id, case when r.role = 'admin' then 'critical' else 'warning' end, 'integrity',
      'حساب جديد بصلاحية ' || case when r.role = 'admin' then 'أدمن' else 'دعم' end,
      coalesce(r.full_name, '') || ' (' || coalesce(r.email, '') || '). لو ده مش انت، اسحب الصلاحية فورًا وغيّر كلمة مرورك. لو انت اللي أضفته اضغط «مسموح».', null);
  end loop;

  -- 6) mass deletion (wipe after a break-in, or a bug that deletes data)
  foreach v_t in array array['profiles', 'payments', 'subscriptions', 'courses', 'lectures', 'lecture_videos', 'earnings', 'enrollments', 'certificates', 'featured_instructors', 'contracts'] loop
    execute format('select count(*) from public.%I', v_t) into v_now;
    v_new := v_new || jsonb_build_object(v_t, v_now);
    v_old := (v_counts->>v_t)::bigint;
    if v_old is not null and v_old - v_now >= greatest(5, v_old * 0.05) then
      perform sec_alert('wipe:' || v_t || ':' || to_char(now(), 'YYYYMMDDHH24'), 'critical', 'attack', 'اختفاء بيانات كتير من جدول ' || v_t,
        'العدد نزل من ' || v_old || ' إلى ' || v_now || ' خلال آخر فحص. ده ممكن يكون اختراق أو خطأ في الكود.',
        'راجع من عنده صلاحية أدمن فورًا. Supabase بيحتفظ بنسخة احتياطية يومية تقدر ترجّع منها.');
    end if;
  end loop;
  insert into security_state (key, value) values ('row_counts', v_new) on conflict (key) do update set value = excluded.value, updated_at = now();

  -- 7) flooding from one address (bots, spam, attack on forms) → block that address for 24 hours
  for r in select split_part(cu.key, ':', 2) as ip, sum(cu.n) as tries from chat_usage cu
            where cu.day = current_date and (cu.key like 'rq:%' or cu.key like 'ce:%') and cu.key not in ('rq:all', 'ce:all') and split_part(cu.key, ':', 2) not in ('', 'na')
            group by 1 having sum(cu.n) >= 150 loop
    if not exists (select 1 from blocked_ips b where b.ip = r.ip and b.until > now()) then
      insert into blocked_ips (ip, reason, until) values (r.ip, r.tries || ' محاولة في يوم واحد', now() + interval '24 hours')
      on conflict (ip) do update set reason = excluded.reason, until = excluded.until;
      perform sec_alert('flood:' || r.ip || ':' || current_date, 'warning', 'attack', 'إغراق بالطلبات من عنوان واحد',
        'العنوان ' || r.ip || ' بعت ' || r.tries || ' طلب النهارده (النماذج أو تقارير الأخطاء). ده غالبًا بوت أو هجوم.', 'تم حظر العنوان 24 ساعة تلقائيًا.');
      v_fixed := v_fixed + 1;
    end if;
  end loop;
  delete from blocked_ips where until < now() - interval '7 days';

  -- 8) bot sign-ups
  select count(*) into n from auth.users where created_at > now() - interval '1 hour';
  if n >= 150 then
    perform sec_alert('signups:' || to_char(now(), 'YYYYMMDDHH24'), 'warning', 'attack', 'عدد تسجيلات غير طبيعي',
      n || ' حساب جديد في آخر ساعة. لو مفيش حملة إعلانية دلوقتي، ده غالبًا بوت.', null);
  end if;

  -- 9) many screen-capture / devtools reports in one hour
  select count(*) into n from security_incidents where created_at > now() - interval '1 hour';
  if n >= 25 then
    perform sec_alert('capture:' || to_char(now(), 'YYYYMMDDHH24'), 'warning', 'attack', 'محاولات كتير لتصوير المحاضرات',
      n || ' محاولة تصوير أو فتح أدوات المطوّر في آخر ساعة.', 'الحظر التلقائي شغال حسب إعدادات الصفحة.');
  end if;

  -- 10) e-mails that failed → retry automatically (up to 5 times)
  select count(*), max(last_error) into n, v_t from email_outbox where status = 'failed' and created_at > now() - interval '2 days';
  if n > 0 then
    update email_outbox set status = 'pending' where status = 'failed' and attempts < 5 and created_at > now() - interval '2 days'
      and to_email !~* '@example\.';
    perform sec_alert('cond:mailfail', 'warning', 'bug', 'إيميلات فشل إرسالها', n || ' إيميل فشل. آخر خطأ: ' || left(coalesce(v_t, '—'), 200),
      'إعادة محاولة تلقائية (حتى 5 مرات). لو استمر، راجع مفتاح Resend أو الحد اليومي المجاني.');
    v_seen := array_append(v_seen, 'cond:mailfail');
  end if;
  select count(*) into n from email_outbox where status = 'pending' and created_at < now() - interval '45 minutes' and created_at > now() - interval '2 days';
  if n > 0 then
    perform sec_alert('cond:mailstuck', 'warning', 'bug', 'إيميلات متأخرة في الطابور', n || ' إيميل مستني أكتر من 45 دقيقة. غالبًا وصلنا للحد اليومي المجاني أو خدمة الإرسال واقفة.', null);
    v_seen := array_append(v_seen, 'cond:mailstuck');
  end if;

  -- 11) CRM sync failures → retry
  select count(*), max(last_error) into n, v_t from crm_outbox where status = 'failed' and created_at > now() - interval '2 days';
  if n > 0 then
    update crm_outbox set status = 'pending' where status = 'failed' and attempts < 5 and created_at > now() - interval '2 days'
      and coalesce(last_error, '') !~* '(test|not sent)' and coalesce(payload->>'email', '') !~* '@example\.';
    perform sec_alert('cond:crmfail', 'info', 'bug', 'مزامنة CRM فشلت', n || ' عنصر. آخر خطأ: ' || left(coalesce(v_t, '—'), 200), 'إعادة محاولة تلقائية.');
    v_seen := array_append(v_seen, 'cond:crmfail');
  end if;

  -- 12) payment notices not processed (customer paid, access maybe not opened)
  select count(*) into n from webhook_events where processed_at is null and received_at < now() - interval '10 minutes' and received_at > now() - interval '3 days';
  if n > 0 then
    perform sec_alert('cond:webhook', 'critical', 'bug', 'إشعارات دفع ما اتعالجتش', n || ' إشعار دفع من البوابات وصل ومتعالجش. غالبًا عميل دفع واشتراكه ما اتفعّلش.',
      'راجع المدفوعات وفعّل يدويًا لو لزم.');
    v_seen := array_append(v_seen, 'cond:webhook');
  end if;

  -- 13) the platform's own background calls failing (mail sender, CRM, Fawaterk sweep…)
  select count(*) into n from net._http_response where created > now() - interval '30 minutes' and (status_code >= 500 or error_msg is not null);
  if n >= 4 then
    perform sec_alert('cond:http', 'warning', 'bug', 'خدمات داخلية مش بترد', n || ' طلب داخلي فشل في آخر 30 دقيقة (إرسال الإيميلات / CRM / فواتيرك).', null);
    v_seen := array_append(v_seen, 'cond:http');
  end if;

  -- 14) JavaScript errors visitors hit on the site (bugs)
  for r in select md5(ce.msg) as h, min(ce.msg) as msg, min(ce.page) as page, count(*) as c, count(distinct coalesce(ce.user_id::text, ce.ua)) as people
            from client_errors ce where ce.at > now() - interval '1 hour' group by md5(ce.msg) having count(*) >= 3 loop
    perform sec_alert('js:' || r.h, 'warning', 'bug', 'خطأ في الموقع بيقابل الزوار',
      r.c || ' مرة (' || r.people || ' شخص) في آخر ساعة · الصفحة: ' || coalesce(r.page, '—') || ' · الخطأ: ' || left(r.msg, 250), null);
  end loop;

  perform sec_clear('cond:', v_seen);
  select count(*) into v_alerts from security_alerts where status = 'open';
  insert into security_state (key, value) values ('last_run', jsonb_build_object('at', now(), 'fixed', v_fixed, 'open', v_alerts))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return json_build_object('at', now(), 'fixed', v_fixed, 'open', v_alerts);
end $$;

-- ---------- admin actions ----------
create or replace function public.admin_watchdog_run() returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return security_watchdog();
end $$;

create or replace function public.admin_watchdog_state() returns json language sql stable security definer set search_path = public as $$
  select case when is_admin() then (select value from security_state where key = 'last_run')::json end;
$$;

create or replace function public.admin_alert_set(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare r security_alerts; v_name text; s record;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_status not in ('resolved', 'approved', 'open') then raise exception 'bad status'; end if;
  select * into r from security_alerts where id = p_id;
  if not found then raise exception 'not found'; end if;
  if p_status = 'approved' then
    if r.key like 'anonfn:%' then
      v_name := substr(r.key, 8);
      insert into security_state (key, value) values ('anon_fn_allow', jsonb_build_array(v_name))
      on conflict (key) do update set value = security_state.value || jsonb_build_array(v_name), updated_at = now();
      for s in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_name loop
        execute format('grant execute on function %s to anon', s.sig);
      end loop;
    elsif r.key like 'staff:%' then
      insert into security_state (key, value) values ('staff', jsonb_build_array(substr(r.key, 7)))
      on conflict (key) do update set value = security_state.value || jsonb_build_array(substr(r.key, 7)), updated_at = now();
    else
      raise exception 'this alert cannot be approved';
    end if;
  end if;
  update security_alerts set status = p_status, resolved_at = case when p_status = 'open' then null else now() end,
         resolved_by = case when p_status = 'open' then null else (select full_name from profiles where id = auth.uid()) end
   where id = p_id;
end $$;

create or replace function public.admin_unblock_ip(p_ip text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  delete from blocked_ips where ip = p_ip;
  delete from chat_usage where day = current_date and key in ('rq:' || p_ip, 'ce:' || p_ip);
end $$;

-- staff accounts that lose admin/support are dropped from the approved list
create or replace function public.trg_staff_baseline() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role::text in ('admin', 'support') and new.role::text not in ('admin', 'support') then
    update security_state set value = value - old.id::text, updated_at = now() where key = 'staff';
  end if;
  return new;
end $$;
drop trigger if exists staff_baseline on public.profiles;
create trigger staff_baseline after update of role on public.profiles for each row execute function public.trg_staff_baseline();

-- ---------- grants ----------
revoke execute on function public.sec_alert(text, text, text, text, text, text), public.sec_clear(text, text[]), public.security_watchdog(),
  public.trg_staff_watch(), public.trg_staff_baseline() from public, anon, authenticated;
revoke execute on function public.admin_watchdog_run(), public.admin_watchdog_state(), public.admin_alert_set(uuid, text), public.admin_unblock_ip(text) from public, anon;
grant execute on function public.admin_watchdog_run(), public.admin_watchdog_state(), public.admin_alert_set(uuid, text), public.admin_unblock_ip(text) to authenticated;
revoke execute on function public.ip_blocked(), public.client_ip() from public, anon, authenticated;
grant execute on function public.report_client_error(text, text, text) to anon, authenticated;

-- ---------- baselines: what is allowed today ----------
insert into security_state (key, value)
select 'anon_fn_allow', coalesce(jsonb_agg(distinct p.proname), '[]') || '["report_client_error"]'::jsonb from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
on conflict (key) do nothing;
insert into security_state (key, value)
select 'staff', coalesce(jsonb_agg(id::text), '[]') from profiles where role::text in ('admin', 'support')
on conflict (key) do nothing;

-- ---------- schedule ----------
select cron.unschedule('security-watchdog') where exists (select 1 from cron.job where jobname = 'security-watchdog');
select cron.schedule('security-watchdog', '*/10 * * * *', 'select public.security_watchdog()');
