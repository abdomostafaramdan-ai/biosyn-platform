-- More lifecycle emails + faster delivery.
--  * welcome email when an account becomes active (email confirmed, or Google sign-in)
--  * subscription expiry: reminders 7/3/1 days before, on the last day, "expired" the day after, win-back after 7 days
--  * manual transfer received (student), consultation paid (student)
--  * queued emails are pushed to the sender right away (no waiting for the 5-minute cron)
--  * sender shows as "Biosyn Egypt" (a display name helps inbox placement)

update integration_secrets set value = 'Biosyn Egypt <noreply@biosyneg.com>', updated_at = now()
 where key = 'MAIL_FROM' and value = 'noreply@biosyneg.com';

-- ---------- push the queue right away ----------
create or replace function trg_kick_mailer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/send-emails',
                        headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000);
  return null;
exception when others then return null;   -- never block the insert; the cron picks it up
end $$;
create or replace trigger kick_mailer after insert on email_outbox for each statement execute function trg_kick_mailer();

-- ---------- welcome on activation ----------
create or replace function trg_welcome_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_link text;
begin
  if new.email is null or new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;
  select nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), '') into v_name from profiles where id = new.id;
  v_name := coalesce(v_name, nullif(split_part(btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ' ', 1), ''));
  v_link := ref_link(new.id);
  perform enqueue_email('welcome:' || new.id, new.email, 'أهلاً بيك في Biosyn Egypt 👋',
    email_html('أهلاً بيك في Biosyn' || case when v_name is not null then ' يا ' || v_name else '' end || ' 👋', array_remove(array[
      'حسابك على منصة Biosyn Egypt جاهز. هنا هتلاقي كورسات مسجلة وتفاعلية في العلوم والطب والبايوانفورماتكس والبرمجة، بمحتوى عملي من متخصصين.',
      '<b>ابدأ منين؟</b><br>• جرّب المعاينة المجانية في أي كورس قبل ما تشترك.<br>• اختار الباقة اللي تناسبك (شهري، نص سنوي، سنوي) وكل الكورسات المسجلة تفتح لك.<br>• خلّص الكورس واستلم شهادتك تلقائي.',
      '<b>🎁 شهر مجاني ليك:</b> ابعت رابط دعوتك لصحابك، وكل صديق يشترك لأول مرة بياخد لك شهر مجاني.',
      case when v_link is not null then 'رابط دعوتك: <a href="' || v_link || '" dir="ltr" style="color:#3b3fd8">' || esc_html(v_link) || '</a>' end,
      'عندك سؤال؟ رد على الإيميل ده أو افتح تذكرة من حسابك، وفريقنا هيرد عليك.'], null),
      'تصفّح الكورسات', 'courses.html'));
  perform notify_user(new.id, 'n:hello:' || new.id, 'info', 'أهلاً بيك في Biosyn 👋',
    'جرّب المعاينة المجانية في أي كورس، واختار الباقة اللي تناسبك لما تكون جاهز.', 'courses.html');
  return new;
end $$;
create or replace trigger welcome_user after insert or update of email_confirmed_at on auth.users
  for each row execute function trg_welcome_user();

-- ---------- expiry reminders, expired, win-back (daily cron 06:00 UTC = 08:00 Cairo) ----------
create or replace function enqueue_expiry_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d int; v_subj text; v_head text; v_lines text[]; v_kind text; v_end text; v_semi text; v_btn text;
begin
  select name into v_semi from plans where code = 'semiannual' and active;
  for r in
    -- the subscription that ends last for each user (queued renewals push the date forward)
    select distinct on (s.user_id) s.id, s.user_id, s.ends_at, u.email, pl.name as plan_name, pl.duration_months,
           (s.ends_at at time zone 'Africa/Cairo')::date - (now() at time zone 'Africa/Cairo')::date as days_left
      from subscriptions s join auth.users u on u.id = s.user_id join plans pl on pl.id = s.plan_id
     where s.ends_at > now() - interval '8 days' and s.ends_at <= now() + interval '8 days'
     order by s.user_id, s.ends_at desc
  loop
    d := r.days_left;
    if d not in (7, 3, 1, 0, -1, -7) then continue; end if;
    v_end := to_char(r.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
    v_kind := 'warning'; v_btn := 'جدّد اشتراكك';
    if d = 7 then
      v_subj := 'اشتراكك في Biosyn بيخلص بعد أسبوع'; v_head := 'فاضل أسبوع على اشتراكك';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص يوم <b>' || v_end || '</b>.',
        'تقدر تجدّد من دلوقتي، والمدة الجديدة بتبدأ بعد ما الحالية تخلص مباشرة، فمش هتخسر ولا يوم.'];
    elsif d = 3 then
      v_subj := 'فاضل 3 أيام على اشتراكك في Biosyn'; v_head := 'فاضل 3 أيام بس';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص يوم <b>' || v_end || '</b>.',
        'جدّد عشان تكمّل الكورسات اللي بدأتها من غير ما تقف، وتقدمك في المحاضرات محفوظ زي ما هو.'];
    elsif d = 1 then
      v_subj := 'اشتراكك في Biosyn بيخلص بكرة'; v_head := 'اشتراكك بيخلص بكرة ⏰';
      v_lines := array['آخر يوم في اشتراكك <b>' || v_end || '</b>.', 'جدّد النهارده عشان ما يقفلش عليك الوصول للكورسات.'];
    elsif d = 0 then
      v_subj := 'النهارده آخر يوم في اشتراكك'; v_head := 'النهارده آخر يوم في اشتراكك';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> بيخلص النهارده.', 'جدّد دلوقتي وكمّل من مكانك، تقدمك وشهاداتك محفوظين.'];
    elsif d = -1 then
      if exists (select 1 from subscriptions s2 where s2.user_id = r.user_id and s2.ends_at > now()) then continue; end if;
      v_subj := 'اشتراكك في Biosyn انتهى'; v_head := 'اشتراكك انتهى';
      v_lines := array['اشتراكك في <b>' || esc_html(r.plan_name) || '</b> انتهى يوم <b>' || v_end || '</b>، فالكورسات المسجلة اتقفلت مؤقتًا.',
        'تقدمك في كل محاضرة وشهاداتك محفوظين. أول ما تجدّد، كل حاجة بترجع زي ما كانت وتكمّل من نفس النقطة.'];
      v_btn := 'جدّد وكمّل من مكانك';
    else
      if exists (select 1 from subscriptions s2 where s2.user_id = r.user_id and s2.ends_at > now()) then continue; end if;
      v_kind := 'info'; v_btn := 'ارجع للكورسات';
      v_subj := 'كورساتك لسه مستنياك في Biosyn'; v_head := 'وحشتنا 👋';
      v_lines := array['بقالك أسبوع من غير اشتراك، بس تقدمك في الكورسات وشهاداتك لسه محفوظين.',
        'ارجع كمّل من مكان ما وقفت، وكل الكورسات المسجلة هتفتح لك تاني أول ما تشترك.'];
    end if;
    if r.duration_months = 1 and v_semi is not null then
      v_lines := v_lines || ('💡 لو بتجدّد كل شهر، <b>' || esc_html(v_semi) || '</b> بيوفّر عليك أكتر.')::text;
    end if;
    v_lines := v_lines || 'وكمان: كل صديق يشترك من رابط دعوتك بيضيف لك شهر مجاني، يعني ممكن تكمّل من غير ما تدفع.'::text;

    perform enqueue_email('exp' || d || ':' || r.id, r.email, v_subj, email_html(v_head, v_lines, v_btn, 'pricing.html'));
    perform notify_user(r.user_id, 'n:exp' || d || ':' || r.id, v_kind, v_head,
      case when d >= 0 then 'اشتراكك («' || r.plan_name || '») بيخلص يوم ' || v_end || '. جدّد عشان تكمّل من غير انقطاع.'
           when d = -1 then 'اشتراكك انتهى، وتقدمك محفوظ. جدّد وكمّل من مكانك.'
           else 'كورساتك لسه مستنياك. جدّد وكمّل من مكانك.' end, 'pricing.html');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- payments: manual transfer received, consultation paid, transfer rejected ----------
create or replace function trg_notify_misc() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_email text; v_item text;
begin
  if tg_table_name = 'certificates' then
    select title into v_title from courses where id = new.course_id;
    perform notify_user(new.user_id, 'n:cert:' || new.id, 'success', 'شهادتك جاهزة 🎓', 'خلّصت ' || coalesce(v_title,'الكورس') || '، وتقدر تحمّل شهادتك.', 'account.html#certs');
  elsif tg_table_name = 'enrollments' then
    select title into v_title from courses where id = new.course_id;
    perform notify_user(new.user_id, 'n:enr:' || new.user_id || ':' || new.course_id, 'success', 'تم تسجيلك ✓', 'اتسجلت في ' || coalesce(v_title,'الدورة') || '، وهنبعتلك المواعيد.', 'account.html');
  elsif tg_table_name = 'payments' then
    select email into v_email from auth.users where id = new.user_id;
    v_item := coalesce((select name from plans where id = new.plan_id), (select title from courses where id = new.course_id),
                       case when new.purpose::text = 'consultation' then 'استشارة' end, 'Biosyn');
    -- manual transfer submitted (manual details are written right after the pending row is created)
    if new.gateway::text = 'manual' and new.status = 'pending' and old.manual_method is null and new.manual_method is not null then
      perform enqueue_email('mrecv:' || new.id, v_email, 'استلمنا طلب التحويل · Biosyn',
        email_html('استلمنا طلب التحويل ✓', array[
          'استلمنا تحويلك الخاص بـ <b>' || esc_html(v_item) || '</b> بقيمة <b>' || paid_txt(new) || '</b>.',
          'الفريق بيراجع وصول المبلغ، وأول ما يتأكد هيتفعّل لك تلقائي ويوصلك إيميل بالتأكيد. ده عادة بياخد ساعات قليلة في أوقات العمل.',
          'رقم المرجع اللي كتبته: <span dir="ltr">' || esc_html(coalesce(new.manual_ref,'')) || '</span>'], 'متابعة الطلب', 'account.html#payments'));
      perform notify_user(new.user_id, 'n:mrecv:' || new.id, 'info', 'استلمنا طلب التحويل', 'بنراجع وصول المبلغ، وهيتفعّل لك تلقائي بعد التأكيد.', 'account.html#payments');
    end if;
    if new.gateway::text = 'manual' and old.status = 'pending' and new.status = 'failed' then
      perform notify_user(new.user_id, 'n:mrej:' || new.id, 'warning', 'التحويل ما اتأكدش', 'ما قدرناش نأكد وصول التحويل. لو حوّلت فعلًا افتح تذكرة دعم وابعت السكرين.', 'account.html#messages');
      perform enqueue_email('mrej:' || new.id, v_email, 'بخصوص التحويل اللي بعته · Biosyn',
        email_html('ما قدرناش نأكد التحويل', array['راجعنا التحويل (المرجع: <span dir="ltr">' || esc_html(coalesce(new.manual_ref,'')) || '</span>) وما لقيناش المبلغ وصل.',
          'لو حوّلت فعلًا، افتح تذكرة دعم من حسابك وهنراجعها معاك فورًا.'], 'افتح تذكرة دعم', 'account.html#messages'));
    end if;
    if new.purpose::text = 'consultation' and old.status is distinct from 'paid' and new.status = 'paid' then
      perform enqueue_email('pay:' || new.id, v_email, 'تم تأكيد حجز الاستشارة · Biosyn',
        email_html('تم تأكيد حجز الاستشارة ✓', array_remove(array[
          'استلمنا رسوم الاستشارة: <b>' || paid_txt(new) || '</b>' || case when new.receipt_no is not null then ' · رقم الإيصال: <b>' || new.receipt_no || '</b>' else '' end,
          'فريق Biosyn هيتواصل معاك خلال يوم عمل لتحديد موعد الاستشارة المناسب ليك.',
          'لو حابب تضيف تفاصيل أو أسئلة قبل الموعد، رد على الإيميل ده.'], null), 'حسابي', 'account.html#payments'));
      perform notify_user(new.user_id, 'n:cons:' || new.id, 'success', 'تم تأكيد حجز الاستشارة ✓', 'هنتواصل معاك لتحديد الموعد.', 'account.html#payments');
    end if;
  end if;
  return new;
end $$;
create or replace trigger notify_manual_reject after update on payments for each row execute function trg_notify_misc();
