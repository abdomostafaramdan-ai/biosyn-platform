-- Subscription rules + in-app notifications + lifecycle emails.
--  * while a paid plan is running you can't buy the same (or a shorter) plan again; you can upgrade to a longer one.
--    In the last 7 days any plan can be bought as a renewal. New time always starts after the current end (no day lost).
--  * notifications: per-user inbox shown in the dashboard bell (every lifecycle email also lands here).
--  * emails: welcome on the first paid subscription (with the invite-a-friend free month), confirmation on later ones,
--    renewal reminders 7 / 3 / 1 days before, on the expiry day, and a win-back 3 days after.

-- ---------- notifications ----------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  dedupe_key text unique,
  kind       text not null default 'info',          -- info | success | warning | gift
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_recent on notifications (user_id, created_at desc);
alter table notifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'notif_own_read') then
    create policy notif_own_read on notifications for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

create or replace function notify_user(p_user uuid, p_key text, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, dedupe_key, kind, title, body, link)
  select p_user, p_key, coalesce(p_kind, 'info'), p_title, p_body, p_link where p_user is not null
  on conflict (dedupe_key) do nothing;
$$;
revoke execute on function notify_user(uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function mark_notifications_read(p_id uuid default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id);
$$;
revoke execute on function mark_notifications_read(uuid) from public, anon;
grant execute on function mark_notifications_read(uuid) to authenticated;

-- ---------- where a user stands ----------
create or replace function plan_state(uid uuid)
returns table (plan_id uuid, plan_code text, plan_name text, duration int, ends_at timestamptz, days_left int, renew_open boolean)
language sql stable security definer set search_path = public as $$
  with paid as (
    select s.ends_at, p.id, p.code, p.name, p.duration_months
      from subscriptions s join plans p on p.id = s.plan_id
     where s.user_id = uid and s.ends_at > now() and s.source = 'payment'),
  top as (select * from paid order by duration_months desc, ends_at desc limit 1),
  last_end as (select max(ends_at) e from subscriptions where user_id = uid and ends_at > now())
  select t.id, t.code, t.name, t.duration_months, le.e,
         greatest(0, ceil(extract(epoch from (le.e - now())) / 86400))::int,
         le.e <= now() + interval '7 days'
    from top t, last_end le;
$$;
revoke execute on function plan_state(uuid) from public, anon, authenticated;

create or replace function my_plan_state() returns json
language sql stable security definer set search_path = public as $$
  select coalesce((select row_to_json(x) from plan_state(auth.uid()) x), '{}'::json);
$$;
revoke execute on function my_plan_state() from public, anon;
grant execute on function my_plan_state() to authenticated;

-- raises (Arabic) when this plan can't be bought now
create or replace function check_plan_allowed(uid uuid, p_plan uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare st record; v_dur int;
begin
  select * into st from plan_state(uid);
  if st.plan_id is null or st.renew_open then return; end if;
  select duration_months into v_dur from plans where id = p_plan;
  if v_dur > st.duration then return; end if;
  if p_plan = st.plan_id then
    raise exception 'أنت مشترك بالفعل في «%» لحد %. تقدر تجدّدها في آخر 7 أيام، أو ترقّي لباقة أطول دلوقتي.',
      st.plan_name, to_char(st.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
  end if;
  raise exception 'باقتك الحالية «%» أطول من الباقة دي. تقدر تشترك فيها في آخر 7 أيام من اشتراكك الحالي (بيخلص %)، أو ترقّي لباقة أطول دلوقتي.',
    st.plan_name, to_char(st.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
end $$;
revoke execute on function check_plan_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function create_pending_payment(p_user uuid, p_gateway gateway, p_purpose pay_purpose, p_plan uuid, p_course uuid, p_fee numeric, p_coupon text default null)
returns payments language plpgsql security definer set search_path = public as $$
declare v_row payments; v_c courses; v_taken int; q record;
begin
  if p_purpose = 'subscription' then
    if p_plan is null then raise exception 'plan not found'; end if;
    perform check_plan_allowed(p_user, p_plan);
  end if;
  if p_purpose = 'interactive_course' then
    select * into v_c from courses where id = p_course and kind = 'interactive' and status = 'published';
    if v_c.id is null or v_c.price_egp is null then raise exception 'course not available'; end if;
    if exists (select 1 from enrollments where user_id = p_user and course_id = p_course) then
      raise exception 'already enrolled';
    end if;
    if v_c.seats is not null then
      select count(*) into v_taken from enrollments where course_id = p_course;
      if v_taken >= v_c.seats then raise exception 'course is full'; end if;
    end if;
  end if;
  select * into q from quote_price(p_user, p_coupon, p_purpose, p_plan, p_course);

  insert into payments (user_id, gateway, purpose, plan_id, course_id, amount_egp, fee_egp, coupon_id, list_price_egp, discount_egp)
  values (p_user, p_gateway, p_purpose,
          case when p_purpose = 'subscription' then p_plan end,
          case when p_purpose = 'interactive_course' then p_course end,
          q.final, case when q.final = 0 then 0 else greatest(coalesce(p_fee,0),0) end,
          q.coupon_id, q.list_price, q.discount)
  returning * into v_row;
  return v_row;
end $$;

-- ---------- helpers for emails ----------
create or replace function ref_link(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select rtrim(coalesce((select value from app_settings where key = 'site_url'), ''), '/') || '/index.html?ref=' || p.ref_code
    from profiles p where p.id = uid and p.ref_code is not null;
$$;
revoke execute on function ref_link(uuid) from public, anon, authenticated;

create or replace function paid_txt(p payments) returns text language sql immutable as $$
  select case when p.currency is not null and p.currency <> 'EGP'
              then (coalesce(p.amount_local,0) + coalesce(p.fee_local,0))::numeric(14,2)::text || ' ' || p.currency
              else (coalesce(p.amount_egp,0) + coalesce(p.fee_egp,0))::numeric(14,2)::text || ' ج.م' end;
$$;

-- ---------- subscription emails + notifications ----------
create or replace function trg_mail_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_plan text; v_p payments; v_name text; v_first boolean; v_link text; v_end text; v_queued boolean;
begin
  select email into v_email from auth.users where id = new.user_id;
  select name into v_plan from plans where id = new.plan_id;
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), '') into v_name from profiles where id = new.user_id;
  v_end := to_char(new.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
  v_link := ref_link(new.user_id);

  if new.payment_id is null then
    if new.source = 'referral' then
      perform enqueue_email('ref:' || new.id, v_email, 'هدية: شهر مجاني في Biosyn 🎁',
        email_html('شكرًا لدعوتك! 🎁', array[
          'صديقك اشترك في Biosyn من رابط دعوتك، فأضفنا لك <b>شهرًا مجانيًا</b> على اشتراكك.',
          'اشتراكك ساري الآن حتى <b>' || v_end || '</b>.',
          'كل صديق جديد يشترك من رابطك = شهر مجاني جديد ليك.'], 'ابدأ التعلّم', 'courses.html'));
      perform notify_user(new.user_id, 'n:ref:' || new.id, 'gift', 'كسبت شهر مجاني 🎁',
        'صديقك اشترك من رابط دعوتك، واشتراكك اتمدّ لحد ' || v_end || '.', 'account.html#settings');
    end if;
    return new;
  end if;

  select * into v_p from payments where id = new.payment_id;
  v_first := not exists (select 1 from subscriptions s where s.user_id = new.user_id and s.source = 'payment' and s.id <> new.id);
  v_queued := new.starts_at > now() + interval '1 minute';

  if v_first then
    perform enqueue_email('pay:' || new.payment_id, v_email, 'أهلاً بيك في Biosyn — اشتراكك اتفعّل ✓',
      email_html('أهلاً بيك في Biosyn' || case when v_name <> '' then ' يا ' || esc_html(v_name) else '' end || ' 👋', array_remove(array[
        'تم استلام دفعتك وتفعيل <b>' || esc_html(v_plan) || '</b>. كل الكورسات المسجلة متاحة ليك من دلوقتي.',
        'المبلغ المدفوع: <b>' || paid_txt(v_p) || '</b>' ||
          case when v_p.receipt_no is not null then ' · رقم الإيصال: <b>' || v_p.receipt_no || '</b>' else '' end,
        'اشتراكك ساري حتى <b>' || v_end || '</b>. الاشتراك مش بيتجدد تلقائي، وهنفكّرك قبل ما يخلص.',
        '<b>🎁 اكسب شهور مجانية:</b> ابعت رابط الدعوة بتاعك لصحابك، وكل صديق يشترك لأول مرة في أي باقة مدفوعة بتاخد عنه <b>شهر مجاني</b> يتضاف على اشتراكك تلقائي.',
        case when v_link is not null then 'رابط دعوتك: <a href="' || v_link || '" dir="ltr" style="color:#3b3fd8">' || esc_html(v_link) || '</a>' end,
        'نصيحة للبداية: افتح أي كورس وكمّل كل محاضرة لحد 50٪ على الأقل عشان المحاضرة اللي بعدها تفتح، ولما تخلّص الكورس كله شهادتك بتطلع تلقائي.'], null),
        'ابدأ أول كورس', 'courses.html'));
    perform notify_user(new.user_id, 'n:welcome:' || new.id, 'success', 'اشتراكك اتفعّل — أهلاً بيك 👋',
      v_plan || ' ساري حتى ' || v_end || '. كل الكورسات المسجلة متاحة ليك.', 'courses.html');
    perform notify_user(new.user_id, 'n:invite:' || new.user_id, 'gift', 'ادعُ صديق وخُد شهر مجاني 🎁',
      'كل صديق يشترك لأول مرة من رابط دعوتك بيضيف لك شهر مجاني تلقائي. انسخ رابطك من الإعدادات.', 'account.html#settings');
  else
    perform enqueue_email('pay:' || new.payment_id, v_email, 'تم تأكيد اشتراكك في Biosyn ✓',
      email_html('تم تأكيد الدفع ✓', array_remove(array[
        case when v_name <> '' then 'أهلاً ' || esc_html(v_name) || '،' end,
        'تم استلام دفعتك وتفعيل <b>' || esc_html(v_plan) || '</b>.',
        'المبلغ المدفوع: <b>' || paid_txt(v_p) || '</b>' ||
          case when v_p.receipt_no is not null then ' · رقم الإيصال: <b>' || v_p.receipt_no || '</b>' else '' end,
        case when v_queued then 'المدة الجديدة بتبدأ بعد ما اشتراكك الحالي يخلص، فمفيش ولا يوم ضاع عليك. اشتراكك بقى ساري حتى <b>' || v_end || '</b>.'
             else 'اشتراكك ساري حتى <b>' || v_end || '</b>.' end,
        case when v_link is not null then '🎁 متنساش: كل صديق يشترك من <a href="' || v_link || '" style="color:#3b3fd8">رابط دعوتك</a> = شهر مجاني ليك.' end], null),
        'كمّل التعلّم', 'courses.html'));
    perform notify_user(new.user_id, 'n:sub:' || new.id, 'success', 'تم تأكيد اشتراكك ✓',
      v_plan || ' — اشتراكك ساري حتى ' || v_end || '.', 'account.html#payments');
  end if;

  perform notify_team('pay-team:' || new.payment_id, 'دفعة جديدة: ' || coalesce(v_plan,''),
    email_html('دفعة اشتراك جديدة', array[esc_html(v_plan) || ' · ' || paid_txt(v_p) || ' · ' || v_p.gateway::text || ' · ' || esc_html(v_email)]));
  return new;
end $$;

-- ---------- renewal reminders (daily cron at 06:00 UTC = 08:00 Cairo) ----------
create or replace function enqueue_expiry_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d int; v_subj text; v_head text; v_lines text[]; v_kind text; v_end text; v_semi text;
begin
  select name into v_semi from plans where code = 'semiannual' and active;
  for r in
    -- the subscription that ends last for each user (queued renewals push the date forward)
    select distinct on (s.user_id) s.id, s.user_id, s.ends_at, u.email, pl.name as plan_name, pl.duration_months,
           (s.ends_at at time zone 'Africa/Cairo')::date - (now() at time zone 'Africa/Cairo')::date as days_left
      from subscriptions s join auth.users u on u.id = s.user_id join plans pl on pl.id = s.plan_id
     where s.ends_at > now() - interval '4 days' and s.ends_at <= now() + interval '8 days'
     order by s.user_id, s.ends_at desc
  loop
    d := r.days_left;
    if d not in (7, 3, 1, 0, -3) then continue; end if;
    v_end := to_char(r.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
    v_kind := 'warning';
    if d = 7 then
      v_subj := 'اشتراكك في Biosyn بيخلص بعد أسبوع'; v_head := 'فاضل أسبوع على اشتراكك';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص يوم <b>' || v_end || '</b>.',
        'تقدر تجدّد من دلوقتي، والمدة الجديدة بتبدأ بعد ما الحالية تخلص مباشرة، فمش هتخسر ولا يوم.'];
    elsif d = 3 then
      v_subj := 'فاضل 3 أيام على اشتراكك'; v_head := 'فاضل 3 أيام بس';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص يوم <b>' || v_end || '</b>.',
        'جدّد عشان تكمّل الكورسات اللي بدأتها من غير ما تقف، وتقدمك في المحاضرات محفوظ زي ما هو.'];
    elsif d = 1 then
      v_subj := 'اشتراكك بيخلص بكرة'; v_head := 'اشتراكك بيخلص بكرة ⏰';
      v_lines := array['آخر يوم في اشتراكك <b>' || v_end || '</b>.', 'جدّد النهارده عشان ما يقفلش عليك الوصول للكورسات.'];
    elsif d = 0 then
      v_subj := 'اشتراكك بيخلص النهارده'; v_head := 'النهارده آخر يوم في اشتراكك';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص النهارده.', 'جدّد دلوقتي وكمّل من مكانك، تقدمك وشهاداتك محفوظين.'];
    else
      if exists (select 1 from subscriptions s2 where s2.user_id = r.user_id and s2.ends_at > now()) then continue; end if;
      v_kind := 'info';
      v_subj := 'وحشتنا في Biosyn'; v_head := 'كورساتك لسه مستنياك';
      v_lines := array['اشتراكك خلص من 3 أيام، بس تقدمك في الكورسات وشهاداتك لسه محفوظين.', 'ارجع كمّل من مكان ما وقفت في أي وقت.'];
    end if;
    -- monthly subscribers: point at the better-value plan
    if r.duration_months = 1 and v_semi is not null then
      v_lines := v_lines || ('💡 لو بتجدّد كل شهر، <b>' || esc_html(v_semi) || '</b> بيوفّر عليك أكتر.');
    end if;
    v_lines := v_lines || 'وكمان: كل صديق يشترك من رابط دعوتك بيضيف لك شهر مجاني، يعني ممكن تكمّل من غير ما تدفع.'::text;

    perform enqueue_email('exp' || d || ':' || r.id, r.email, v_subj, email_html(v_head, v_lines, case when d = -3 then 'ارجع للكورسات' else 'جدّد اشتراكك' end, 'pricing.html'));
    perform notify_user(r.user_id, 'n:exp' || d || ':' || r.id, v_kind, v_head,
      case when d >= 0 then 'اشتراكك («' || r.plan_name || '») بيخلص يوم ' || v_end || '. جدّد عشان تكمّل من غير انقطاع.'
           else 'اشتراكك خلص، وتقدمك محفوظ. جدّد وكمّل من مكانك.' end, 'pricing.html');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- other events also land in the bell ----------
create or replace function trg_notify_misc() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if tg_table_name = 'certificates' then
    select title into v_title from courses where id = new.course_id;
    perform notify_user(new.user_id, 'n:cert:' || new.id, 'success', 'شهادتك جاهزة 🎓', 'خلّصت ' || coalesce(v_title,'الكورس') || '، وتقدر تحمّل شهادتك.', 'account.html#certs');
  elsif tg_table_name = 'enrollments' then
    select title into v_title from courses where id = new.course_id;
    perform notify_user(new.user_id, 'n:enr:' || new.user_id || ':' || new.course_id, 'success', 'تم تسجيلك ✓', 'اتسجلت في ' || coalesce(v_title,'الدورة') || '، وهنبعتلك المواعيد.', 'account.html');
  elsif tg_table_name = 'payments' then
    if new.gateway::text = 'manual' and old.status = 'pending' and new.status = 'failed' then
      perform notify_user(new.user_id, 'n:mrej:' || new.id, 'warning', 'التحويل ما اتأكدش', 'ما قدرناش نأكد وصول التحويل. لو حوّلت فعلًا افتح تذكرة دعم وابعت السكرين.', 'account.html#messages');
      perform enqueue_email('mrej:' || new.id, (select email from auth.users where id = new.user_id), 'بخصوص التحويل اللي بعته',
        email_html('ما قدرناش نأكد التحويل', array['راجعنا التحويل (المرجع: <span dir="ltr">' || esc_html(coalesce(new.manual_ref,'')) || '</span>) وما لقيناش المبلغ وصل.',
          'لو حوّلت فعلًا، افتح تذكرة دعم من حسابك وهنراجعها معاك فورًا.'], 'افتح تذكرة دعم', 'account.html#messages'));
    end if;
  end if;
  return new;
end $$;
create or replace trigger notify_certificate after insert on certificates for each row execute function trg_notify_misc();
create or replace trigger notify_enrollment after insert on enrollments for each row execute function trg_notify_misc();
create or replace trigger notify_manual_reject after update of status on payments for each row execute function trg_notify_misc();
