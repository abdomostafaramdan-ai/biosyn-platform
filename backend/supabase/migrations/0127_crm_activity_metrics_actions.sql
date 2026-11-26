-- 0127: richer CRM sync + CRM-side controls
--   * activity: per student — sign-up date, last sign-in, watch minutes (all time / last 30 days), last watch,
--     courses started, lectures completed, certificates, first-touch and sign-up source, referrer. Sent nightly, only
--     for students whose numbers changed. Every registered student reaches the CRM (new ones as leads).
--   * metrics: subscription health — MRR by plan, active subscribers, new vs renewals, churn, renewal rate, ARPU,
--     estimated lifetime value, 6-month MRR trend, sign-ups and conversion. Sent nightly.
--   * crm_sub_action / crm_coupon: run by the crm-bridge function (service role only, request signed by the CRM).
--     Subscription actions reuse the admin functions as the platform owner, so their checks, history and student
--     notifications stay exactly the same.

create or replace function public.crm_src_label(p text) returns text language sql immutable as $$
  select case
    when p is null or p = '' then null
    when p = 'direct' then 'مباشر'
    when p = 'google' then 'بحث جوجل'
    when p in ('bing', 'yahoo', 'duckduckgo') then 'محركات بحث أخرى'
    when p in ('facebook', 'fb', 'm.facebook.com', 'l.facebook.com') then 'فيسبوك'
    when p in ('ig', 'instagram', 'l.instagram.com') then 'إنستجرام'
    when p like '%linkedin%' then 'لينكدإن'
    when p in ('chatgpt', 'perplexity', 'gemini', 'claude', 'copilot') then 'ChatGPT / مساعدات AI'
    when p in ('campaign', 'email', 'reactivation') then 'حملات البريد'
    when p in ('bf_page', 'popup') then 'عرض الجمعة البيضاء'
    when p in ('whatsapp', 'wa', 'l.wl.co') then 'واتساب'
    when p in ('tiktok') then 'تيك توك'
    when p in ('youtube', 'youtu.be') then 'يوتيوب'
    else p end $$;

create or replace function public.crm_student_activity(p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; n int := 0;
begin
  for r in
    select u.id, lower(u.email) email, p.full_name, coalesce(nullif(p.phone, ''), p.whatsapp) phone, p.created_at, u.last_sign_in_at, p.banned_at,
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
     where p.role::text = 'student' and (p_user is null or u.id = p_user) and not is_excluded_email(u.email)
  loop
    v := jsonb_build_object('id', 'act-' || r.id, 'biosyn_event', 'activity', 'email', r.email, 'name', left(coalesce(r.full_name, ''), 80),
      'phone', coalesce(r.phone, ''), 'signup', to_char(r.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
      'last_login', coalesce(to_char(r.last_sign_in_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), ''),
      'wmin', r.wmin, 'w30', r.w30, 'last_watch', coalesce(to_char(r.last_watch at time zone 'Africa/Cairo', 'YYYY-MM-DD'), ''),
      'courses', r.courses, 'lec_done', r.lec_done, 'certs', r.certs,
      'src_first', coalesce(crm_src_label(r.src_first), case when r.has_visits then 'مباشر' else '' end),
      'src_signup', coalesce(crm_src_label(r.src_signup), ''), 'ref', coalesce(r.ref_name, ''),
      'banned', r.banned_at is not null, 'optout', r.optout);
    insert into crm_outbox (dedupe_key, kind, payload) values ('act:' || r.id || ':' || md5(v::text), 'order', v)
    on conflict (dedupe_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.crm_student_activity(uuid) from public, anon, authenticated;

create or replace function public.crm_metrics()
returns jsonb language plpgsql security definer set search_path = public as $$
declare m jsonb; v_active int; v_mrr numeric; v_prev int; v_churn int; v_new int; v_ren int; v_ended int; v_renewed int;
        v_rate numeric; v_arpu numeric; v_life numeric; v_trend jsonb; v_plans jsonb; v_students int; v_signups int; v_payers int;
begin
  create temp table if not exists _subs on commit drop as
    select s.id, s.user_id, s.status, s.starts_at, s.ends_at, s.created_at, coalesce(pl.name, 'باقة') plan,
           coalesce(py.amount_egp, 0) / greatest(coalesce(pl.duration_months, 1), 1) monthly
      from subscriptions s left join plans pl on pl.id = s.plan_id left join payments py on py.id = s.payment_id
      join auth.users u on u.id = s.user_id where not is_excluded_email(u.email);
  select count(distinct user_id), coalesce(round(sum(monthly)), 0) into v_active, v_mrr from _subs where status = 'active' and ends_at > now();
  select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'n', n, 'mrr', mrr) order by mrr desc), '[]') into v_plans
    from (select plan, count(*) n, round(sum(monthly)) mrr from _subs where status = 'active' and ends_at > now() group by plan) x;
  select count(distinct user_id) into v_prev from _subs where starts_at <= now() - interval '30 days' and ends_at > now() - interval '30 days';
  select count(distinct user_id) into v_churn from _subs s
   where s.ends_at between now() - interval '30 days' and now() and s.status <> 'paused'
     and not exists (select 1 from _subs t where t.user_id = s.user_id and t.status = 'active' and t.ends_at > now());
  select count(*) filter (where not exists (select 1 from _subs t where t.user_id = s.user_id and t.created_at < s.created_at)),
         count(*) filter (where exists (select 1 from _subs t where t.user_id = s.user_id and t.created_at < s.created_at))
    into v_new, v_ren from _subs s where s.created_at > now() - interval '30 days';
  select count(*), count(*) filter (where exists (select 1 from _subs t where t.user_id = s.user_id and t.id <> s.id and t.created_at >= s.ends_at - interval '14 days'))
    into v_ended, v_renewed from _subs s where s.ends_at between now() - interval '90 days' and now() and s.status <> 'paused';
  v_rate := case when v_prev > 0 then round(v_churn::numeric / v_prev * 100, 1) end;
  v_arpu := case when v_active > 0 then round(v_mrr / v_active) end;
  v_life := case when coalesce(v_rate, 0) > 0 then least(round(100 / v_rate, 1), 24) end;
  select coalesce(jsonb_agg(jsonb_build_object('m', to_char(me, 'YYYY-MM'), 'mrr', mrr, 'n', n) order by me), '[]') into v_trend
    from (select me, coalesce(round(sum(s.monthly)), 0) mrr, count(distinct s.user_id) n
            from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') g(ms)
            cross join lateral (select least(g.ms + interval '1 month' - interval '1 second', now()) me) e
            left join _subs s on s.starts_at <= e.me and s.ends_at > e.me
           group by me) t;
  select count(*) into v_students from profiles p join auth.users u on u.id = p.id where p.role::text = 'student' and not is_excluded_email(u.email);
  select count(*) into v_signups from profiles p join auth.users u on u.id = p.id where p.role::text = 'student' and p.created_at > now() - interval '30 days' and not is_excluded_email(u.email);
  select count(distinct py.user_id) into v_payers from payments py join auth.users u on u.id = py.user_id where py.status = 'paid' and not is_excluded_email(u.email);
  m := jsonb_build_object('at', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), 'mrr', v_mrr, 'active', v_active, 'plans', v_plans,
    'new30', v_new, 'renew30', v_ren, 'churn30', v_churn, 'churn_rate', v_rate, 'active_30d_ago', v_prev,
    'ended90', v_ended, 'renewed90', v_renewed, 'renewal_rate', case when v_ended > 0 then round(v_renewed::numeric / v_ended * 100) end,
    'arpu', v_arpu, 'lifetime_months', v_life, 'ltv', case when v_life is not null then round(v_arpu * v_life) end,
    'trend', v_trend, 'students', v_students, 'signups30', v_signups, 'payers', v_payers,
    'conversion', case when v_students > 0 then round(v_payers::numeric / v_students * 100, 1) end);
  insert into crm_outbox (dedupe_key, kind, payload)
  values ('metrics:' || md5(m::text), 'order', jsonb_build_object('id', 'metrics', 'biosyn_event', 'metrics', 'data', m))
  on conflict (dedupe_key) do nothing;
  return m;
end $$;
revoke all on function public.crm_metrics() from public, anon, authenticated;

-- CRM → platform: subscription actions run as the platform owner (one admin), with the CRM user's name in the note
create or replace function public.crm_sub_action(p_email text, p_action text, p_days int default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_owner uuid; v_note text := left(btrim(coalesce(p_note, '')), 280); s record;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'not allowed'; end if;
  if p_action not in ('extend', 'pause', 'resume', 'cancel') then raise exception 'unknown action'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'لا يوجد حساب على المنصة بهذا البريد'; end if;
  select p.id into v_owner from profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_note := nullif('من CRM' || case when v_note <> '' then ': ' || v_note else '' end, '');
  if p_action = 'extend' then perform admin_sub_extend(v_user, p_days, v_note);
  elsif p_action = 'pause' then perform admin_sub_pause(v_user, v_note);
  elsif p_action = 'resume' then perform admin_sub_resume(v_user, v_note);
  else perform admin_sub_cancel(v_user, v_note); end if;
  perform set_config('request.jwt.claims', '', true);
  select status, ends_at into s from subscriptions where user_id = v_user order by (status = 'active' and ends_at > now()) desc, (status = 'paused') desc, ends_at desc limit 1;
  return json_build_object('ok', true, 'status', s.status, 'ends_at', to_char(s.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'));
end $$;
revoke all on function public.crm_sub_action(text, text, int, text) from public, anon, authenticated;

-- CRM → platform: a single-use personal discount code
create or replace function public.crm_coupon(p_email text, p_pct int, p_days int default 7, p_by text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'not allowed'; end if;
  if p_pct is null or p_pct < 5 or p_pct > 90 then raise exception 'نسبة الخصم بين 5 و90'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'مدة الكود بين 1 و90 يومًا'; end if;
  v_code := 'CRM' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into coupons (code, percent_off, applies_to, max_redemptions, starts_at, expires_at, active, note)
  values (v_code, p_pct, 'any', 1, now(), now() + make_interval(days => p_days), true,
          left('كود شخصي من CRM لـ ' || lower(btrim(p_email)) || coalesce(' · ' || nullif(btrim(p_by), ''), ''), 300));
  return json_build_object('ok', true, 'code', v_code, 'pct', p_pct, 'expires', to_char((now() + make_interval(days => p_days)) at time zone 'Africa/Cairo', 'YYYY-MM-DD'));
end $$;
revoke all on function public.crm_coupon(text, int, int, text) from public, anon, authenticated;

select cron.schedule('crm-student-activity', '35 0 * * *', 'select public.crm_student_activity()');
select cron.schedule('crm-metrics', '40 0 * * *', 'select public.crm_metrics()');
