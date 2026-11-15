-- Welcome email: new copy (faculty list, referral wording); support line removed since the footer carries contact info.
create or replace function public.trg_welcome_user()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare v_name text; v_link text;
begin
  if new.email is null or new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;
  select nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), '') into v_name from profiles where id = new.id;
  v_name := coalesce(v_name, nullif(split_part(btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ' ', 1), ''));
  v_link := ref_link(new.id);
  perform enqueue_email('welcome:' || new.id, new.email, 'أهلًا بك في Biosyn Eg 👋',
    email_html('أهلًا بك في Biosyn' || case when v_name is not null then ' يا ' || v_name else '' end || ' 👋', array_remove(array[
      'حسابك على منصة Biosyn Eg جاهز. ستجد هنا كورسات مسجلة وتفاعلية لكليات العلوم، والصيدلة، والبايوتكنولوجي، والزراعة، والطب البشري، والطب البيطري، وطب الأسنان، والعلاج الطبيعي، والعلوم الصحية والتطبيقية.',
      '<b>من أين تبدأ؟</b><br>• جرّب المعاينة المجانية في أي دورة قبل الاشتراك.<br>• اختر الباقة المناسبة لك (شهرية، نصف سنوية، سنوية) لتُفتح لك جميع الدورات المسجلة.<br>• أتمّ الدورة واستلم شهادتك تلقائيًا.',
      '<b>🎁 أشهر مجانية لك:</b> أرسل رابط دعوتك إلى أصدقائك. عندما يشترك 3 منهم تحصل على شهر مجاني (ويمكنك تكرار هذا بعد مرور 6 أشهر)، وإذا وصلوا إلى 10 تحصل على 6 أشهر مجانًا.',
      case when v_link is not null then 'رابط دعوتك: <a href="' || v_link || '" dir="ltr" style="color:#3b3fd8">' || esc_html(v_link) || '</a>' end], null),
      'تصفّح الدورات', 'courses.html'));
  perform notify_user(new.id, 'n:hello:' || new.id, 'info', 'أهلًا بك في Biosyn 👋',
    'جرّب المعاينة المجانية في أي دورة، واختر الباقة المناسبة لك عندما تكون مستعدًا.', 'courses.html');
  return new;
end $function$;
