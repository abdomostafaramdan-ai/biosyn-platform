-- Follow-up e-mails (daily cron, 10:00 Cairo):
--   'abandon'  — started a subscription payment through a gateway and didn't finish: one e-mail a day for 5 days
--   'nurture'  — created an account and never tried to pay: one e-mail a day for 3 days
-- Both stop as soon as the person pays / subscribes, skip opted-out addresses, carry an unsubscribe link, and stay inside
-- the daily sending cap (site_content.reactivation.total_daily_cap, leaving room for transactional mail).
-- Manual transfers waiting for review are never chased. Wording is editable in Admin → رسائل البريد.

-- unsubscribe link for registered users
alter table public.profiles add column if not exists unsub_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_unsub_token_idx on public.profiles (unsub_token);

create or replace function public.reactivation_unsubscribe(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $function$
declare v_email text;
begin
  update legacy_users set status = case when status in ('queued','sent','failed') then 'unsubscribed' else status end, note = 'unsubscribed ' || now()::date
   where token = p_token returning lower(btrim(email)) into v_email;
  if v_email is null then select lower(btrim(email)) into v_email from campaign_recipients where token = p_token; end if;
  if v_email is null then select lower(btrim(u.email)) into v_email from profiles p join auth.users u on u.id = p.id where p.unsub_token = p_token; end if;
  if v_email is null then return false; end if;
  insert into email_optouts (email, source) values (v_email, 'unsubscribe link') on conflict do nothing;
  update campaign_recipients set status = 'skipped' where lower(email) = v_email and status = 'queued';
  return true;
end $function$;

-- progress of each person's series
create table if not exists public.nurture_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('abandon', 'nurture')),
  started_at timestamptz not null,
  step int not null default 0,
  last_sent_at timestamptz,
  done boolean not null default false,
  primary key (user_id, kind)
);
alter table public.nurture_state enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'nurture_state' and policyname = 'nurture_state_admin') then
    create policy nurture_state_admin on public.nurture_state for select to authenticated using (is_admin());
  end if;
end $do$;
revoke insert, update, delete, truncate on public.nurture_state from anon, authenticated;

create or replace function public.enqueue_nurture_emails()
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_budget int; r record; v_next int; v_first text; v_subj text; v_head text; v_lines text[]; v_btn text; v_path text;
  v_sent_a int := 0; v_sent_n int := 0;
begin
  if session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if not is_admin() then raise exception 'not allowed'; end if;
  end if;
  v_budget := coalesce((cfg->>'total_daily_cap')::int, 95) - 15
              - (select count(*) from email_outbox where created_at > now() - interval '24 hours');
  if v_budget <= 0 then return json_build_object('abandon', 0, 'nurture', 0, 'skipped', 'daily cap reached'); end if;

  -- a series ends once the person has any paid payment or time left on a subscription
  update nurture_state ns set done = true
   where not done and (exists (select 1 from payments p where p.user_id = ns.user_id and p.status::text = 'paid')
                       or exists (select 1 from subscriptions s where s.user_id = ns.user_id and s.ends_at > now()));

  -- start abandoned-checkout series: gateway payment for a subscription left pending/failed in the last 5 days
  insert into nurture_state (user_id, kind, started_at)
  select p.user_id, 'abandon', min(p.created_at)
    from payments p join profiles pr on pr.id = p.user_id
   where p.purpose::text = 'subscription' and p.gateway::text <> 'manual' and p.status::text in ('pending', 'failed')
     and p.created_at > now() - interval '5 days' and p.created_at < now() - interval '2 hours'
     and pr.role::text = 'student'
     and not exists (select 1 from payments q where q.user_id = p.user_id and (q.status::text = 'paid' or (q.gateway::text = 'manual' and q.status::text = 'pending')))
     and not exists (select 1 from subscriptions s where s.user_id = p.user_id and s.ends_at > now())
   group by p.user_id
  on conflict (user_id, kind) do update set started_at = excluded.started_at, step = 0, last_sent_at = null, done = false
   where nurture_state.done and nurture_state.started_at < now() - interval '30 days';

  -- start sign-up series: new student account (last 3 days) with no payment attempt at all
  insert into nurture_state (user_id, kind, started_at)
  select pr.id, 'nurture', u.created_at
    from profiles pr join auth.users u on u.id = pr.id
   where pr.role::text = 'student' and u.created_at > now() - interval '3 days'
     and not exists (select 1 from payments q where q.user_id = pr.id)
     and not exists (select 1 from subscriptions s where s.user_id = pr.id)
  on conflict (user_id, kind) do nothing;
  -- someone who started paying moves to the abandoned-checkout series
  update nurture_state ns set done = true
   where ns.kind = 'nurture' and not ns.done and exists (select 1 from payments q where q.user_id = ns.user_id);

  for r in
    select ns.*, u.email, pr.full_name, pr.unsub_token
      from nurture_state ns join auth.users u on u.id = ns.user_id join profiles pr on pr.id = ns.user_id
     where not ns.done and u.email is not null
       and ns.step < case ns.kind when 'abandon' then 5 else 3 end
       and now() >= ns.started_at + make_interval(days => ns.step + 1)
       and (ns.last_sent_at is null or ns.last_sent_at < now() - interval '20 hours')
       and not exists (select 1 from email_optouts o where o.email = lower(btrim(u.email)))
     order by ns.kind, ns.started_at
  loop
    exit when v_budget <= 0;
    v_next := r.step + 1;
    v_first := legacy_first_name(r.full_name);
    v_path := 'pricing.html?utm_source=email&utm_medium=nurture&utm_campaign=' || r.kind || v_next;
    v_btn := 'اختر باقتك';
    if r.kind = 'abandon' then
      if v_next = 1 then
        v_subj := 'اشتراكك في Biosyn لم يكتمل بعد'; v_head := 'خطوة واحدة وتبدأ 👋';
        v_lines := array['لاحظنا أنك بدأت الاشتراك في Biosyn ولم تكتمل عملية الدفع.',
          'يمكنك إكمال الاشتراك الآن خلال دقيقة، بالبطاقة أو المحفظة الإلكترونية، أو بالتحويل عبر إنستاباي وفودافون كاش.',
          'لو واجهتك أي مشكلة أثناء الدفع، ردّ على هذه الرسالة وسنساعدك بأنفسنا.'];
        v_btn := 'أكمل الاشتراك';
      elsif v_next = 2 then
        v_subj := 'ماذا ستحصل عليه مع اشتراك Biosyn؟'; v_head := 'كل الدورات المسجلة في اشتراك واحد';
        v_lines := array['اشتراك واحد يفتح لك كل الدورات المسجلة على المنصة في الطب والأحياء والمعلوماتية الحيوية والبرمجة.',
          'تتعلم بالسرعة التي تناسبك، وتقدّمك في كل محاضرة محفوظ، وتحصل على شهادة برمز تحقق عند إنهاء كل دورة.',
          'الاشتراك يُدفع مرة واحدة ولا يتجدد تلقائيًا.'];
      elsif v_next = 3 then
        v_subj := 'هل واجهت مشكلة في الدفع؟'; v_head := 'نساعدك تكمل اشتراكك';
        v_lines := array['إذا رُفضت البطاقة، جرّب الدفع بالمحفظة الإلكترونية أو عبر فوري من صفحة الدفع نفسها.',
          'ويمكنك أيضًا التحويل عبر إنستاباي أو فودافون كاش ورفع صورة الإيصال، ويتفعّل اشتراكك بعد مراجعة الفريق.',
          'ولأي استفسار راسلنا على واتساب <a href="https://wa.me/201069151456" style="color:#1d2050">+20 106 915 1456</a>.'];
        v_btn := 'أكمل الاشتراك';
      elsif v_next = 4 then
        v_subj := 'دوراتك ما زالت بانتظارك'; v_head := 'ابدأ بمحاضرة مجانية';
        v_lines := array['لم تقرر بعد؟ كثير من دوراتنا فيها محاضرات معاينة مجانية تقدر تشاهدها الآن من حسابك قبل الاشتراك.',
          'شاهدها وقرر بنفسك، وعندما تكون جاهزًا اشترك وتابع من حيث توقفت.'];
        v_btn := 'تصفّح الدورات'; v_path := 'courses.html?utm_source=email&utm_medium=nurture&utm_campaign=abandon4';
      else
        v_subj := 'آخر تذكير بخصوص اشتراكك'; v_head := 'آخر رسالة منّا بخصوص اشتراكك';
        v_lines := array['هذه آخر رسالة تذكير نرسلها لك بخصوص اشتراكك الذي لم يكتمل.',
          'وتذكّر: كل 3 أصدقاء يشتركون عبر رابط الدعوة الخاص بك يمنحونك شهرًا مجانيًا.',
          'نتمنى أن نراك قريبًا داخل المنصة.'];
        v_btn := 'أكمل الاشتراك';
      end if;
    else
      if v_next = 1 then
        v_subj := 'ابدأ من هنا: جولة سريعة في Biosyn'; v_head := 'أهلًا بك في Biosyn 👋';
        v_lines := array['حسابك جاهز، وهذه 3 خطوات لتبدأ:',
          '1. تصفّح الدورات واختر ما يناسب تخصصك.<br>2. شاهد محاضرات المعاينة المجانية.<br>3. اختر الباقة التي تناسبك وابدأ التعلم.'];
        v_btn := 'تصفّح الدورات'; v_path := 'courses.html?utm_source=email&utm_medium=nurture&utm_campaign=nurture1';
      elsif v_next = 2 then
        v_subj := 'تعلّم بالطريقة التي تناسبك'; v_head := 'دورات مسجلة وأخرى تفاعلية';
        v_lines := array['الدورات المسجلة متاحة كلها في اشتراك واحد، تشاهدها في أي وقت وعلى جهازين.',
          'والدورات التفاعلية جلسات مباشرة مع المحاضر ومجموعة متابعة، وتُحجز كل دورة منها على حدة.',
          'وفي الحالتين تحصل على شهادة برمز تحقق يمكن لأي جهة التأكد منها.'];
        v_btn := 'اكتشف الدورات التفاعلية'; v_path := 'interactive.html?utm_source=email&utm_medium=nurture&utm_campaign=nurture2';
      else
        v_subj := 'جاهز تبدأ؟ اختر باقتك'; v_head := 'اختر الباقة التي تناسبك';
        v_lines := array['الاشتراك يفتح لك كل الدورات المسجلة على المنصة، ويُدفع مرة واحدة ولا يتجدد تلقائيًا.',
          'وكل 3 أصدقاء يشتركون عبر رابط الدعوة الخاص بك يمنحونك شهرًا مجانيًا.'];
      end if;
    end if;
    perform enqueue_email(r.kind || ':' || r.user_id || ':' || v_next, r.email, v_subj,
      email_html(v_head,
                 array_prepend('مرحبًا' || coalesce(' ' || esc_html(v_first), '') || '،', v_lines),
                 v_btn, v_path, v_site || '/unsubscribe.html?t=' || r.unsub_token));
    update nurture_state set step = v_next, last_sent_at = now(), done = (v_next >= case r.kind when 'abandon' then 5 else 3 end)
     where user_id = r.user_id and kind = r.kind;
    v_budget := v_budget - 1;
    if r.kind = 'abandon' then v_sent_a := v_sent_a + 1; else v_sent_n := v_sent_n + 1; end if;
  end loop;
  return json_build_object('abandon', v_sent_a, 'nurture', v_sent_n);
end $function$;
revoke all on function public.enqueue_nurture_emails() from public, anon;

-- show the new series in Admin → رسائل البريد (wording editable, on/off per type)
do $do$
declare d text := pg_get_functiondef('public.email_catalog'::regproc);
begin
  if position('enqueue_nurture_emails' in d) = 0 then
    execute replace(d, '''campaign_mail''))', '''campaign_mail'',''enqueue_nurture_emails''))');
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from cron.job where jobname = 'nurture-emails') then
    perform cron.schedule('nurture-emails', '0 8 * * *', 'select public.enqueue_nurture_emails()');
  end if;
end $do$;
