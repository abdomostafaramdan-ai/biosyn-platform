-- 0118: Black Friday schedule (times in Cairo; cron runs in UTC = Cairo − 2h)
--  (the 24-25 Nov teasers were never sent: the session paused; plan moved to 26 Nov)
--  26 Nov 12:00   BF · إعلان        → everyone not subscribed (≈5,200)
--  26 Nov 20:00   BF · تذكير الليلة → people who opened/clicked any campaign (≈500)
--  27 Nov 14:00   BF · الكود        → everyone not subscribed, Black Friday clickers first (≈5,200)
--  27 Nov 14:00   BF · ترقية        → subscribers on monthly / 6-month plans (≈45)
--  27 Nov 14:00   popup shows the code; 27 Nov 23:59 code expires (coupon window) and popup turns off at midnight.

-- the copy lives here so each scheduled job only names its wave
create or replace function public.bf_wave(p_wave text) returns json language plpgsql security definer set search_path = public as $$
declare v_cta text := 'black-friday?utm_source=campaign&utm_medium=email&utm_campaign=bf_';
        v_prices text := E'**الأسعار قبل الخصم وبعده:**\n• الباقة نصف السنوية: **450 جنيهًا** بدلًا من 1,499 (توفّر 1,049 جنيهًا)\n• الباقة السنوية: **1,260 جنيهًا** بدلًا من 4,199 (توفّر 2,939 جنيهًا)';
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  if p_wave = 'today' then
    return bf_send('BF · إعلان (26 نوفمبر)', '{name}، غدًا: خصم 70% لأول 100 مشترك فقط', 'الجمعة البيضاء: خصم 70% 🔥',
      E'نجهّز لك أكبر عرض في تاريخ Biosyn Eg، ويبدأ **غدًا الجمعة 27 نوفمبر الساعة 2 ظهرًا**.\n\n' || v_prices ||
      E'\n\n**ماذا تحصل مع الباقة؟**\n• وصول كامل لجميع الدورات المسجلة طوال مدة الباقة\n• أكثر من 15 دورة لطلاب العلوم والبايوتكنولوجي والصيدلة والزراعة والطب\n• شهادات برمز تحقق تضيفها إلى LinkedIn وسيرتك الذاتية\n\n⚠️ **العرض محدود جدًا:** يوم الجمعة فقط حتى منتصف الليل، ولأول 100 مشترك.\n\n**جهّز نفسك من الآن:** أنشئ حسابك اليوم، وانتظر رسالتنا غدًا الساعة 2 ظهرًا، ففيها كود الخصم.',
      'سجّل الآن وانتظر العرض ←', v_cta || 'today', 'bf_all', now());
  elsif p_wave = 'tonight' then
    return bf_send('BF · تذكير الليلة (26 نوفمبر)', '{name}، غدًا الساعة 2 ظهرًا يصلك كود خصم 70%', 'غدًا يبدأ العرض ⏳',
      E'غدًا **الجمعة الساعة 2 ظهرًا** نرسل كود خصم 70% على هذا البريد، لأول 100 مشترك فقط.\n\n' || v_prices ||
      E'\n\nأنشئ حسابك الليلة حتى تدفع في دقيقة واحدة غدًا قبل أن تكتمل المقاعد.',
      'جهّز حسابك الآن ←', v_cta || 'tonight', 'bf_engaged', now());
  elsif p_wave = 'code' then
    return bf_send('BF · الكود (27 نوفمبر 2 ظهرًا)', '{name}، بدأ العرض: كود BIOSYN بخصم 70% لأول 100', 'بدأ العرض الآن 🔥',
      E'كود الخصم: **BIOSYN**\n\n' || v_prices ||
      E'\n\n**طريقة الاستخدام:** اختر الباقة، واكتب الكود **BIOSYN** في خانة كود الخصم، ثم أكمل الدفع.\n\n⚠️ العرض صالح اليوم فقط حتى 11:59 مساءً، ولأول 100 عملية دفع. المقاعد تنفد بسرعة.',
      'اشترك الآن بكود BIOSYN ←', 'pricing?utm_source=campaign&utm_medium=email&utm_campaign=bf_code', 'bf_friday', '2026-11-27 14:00:00+02');
  elsif p_wave = 'upgrade' then
    return bf_send('BF · ترقية المشتركين (27 نوفمبر)', '{name}، عرض للمشتركين: رقِّ باقتك بخصم 70% اليوم فقط', 'رقِّ باقتك بخصم 70%',
      E'شكرًا لأنك مشترك معنا ❤️ اليوم فقط يمكنك الترقية إلى باقة أطول بخصم 70% باستخدام كود **BIOSYN**.\n\n' || v_prices ||
      E'\n\nالعرض صالح اليوم حتى 11:59 مساءً، ولأول 100 عملية دفع على المنصة كلها.',
      'رقِّ باقتك الآن ←', 'pricing?utm_source=campaign&utm_medium=email&utm_campaign=bf_upgrade', 'bf_upgrade', '2026-11-27 14:00:00+02');
  end if;
  raise exception 'unknown wave %', p_wave;
end $$;
revoke execute on function public.bf_wave(text) from public, anon, authenticated;

-- popup: show the code during the offer, off afterwards
create or replace function public.bf_popup(p_on boolean) returns void language sql security definer set search_path = public as $$
  update site_content set updated_at = now(), data = data || case when p_on then jsonb_build_object(
      'on', true, 'title', 'BLACK FRIDAY', 'subtitle', 'العرض متاح الآن · اليوم فقط',
      'discount', 'خصم 70% على الباقة نصف السنوية والسنوية', 'expires', 'ينتهي الليلة 11:59 مساءً · لأول 100 مشترك',
      'cta', 'اشترك الآن', 'cta_url', '/pricing?utm_source=popup&utm_campaign=black-friday', 'promo_code', 'BIOSYN')
    else jsonb_build_object('on', false, 'promo_code', '') end
  where key = 'promo_popup';
$$;
revoke execute on function public.bf_popup(boolean) from public, anon, authenticated;

select cron.unschedule(j) from unnest(array['bf-today','bf-tonight','bf-code','bf-upgrade','bf-popup-on','bf-popup-off']) j
 where exists (select 1 from cron.job where jobname = j);
select cron.schedule('bf-today',    '0 10 26 11 *',  $$select public.bf_wave('today'); select cron.unschedule('bf-today');$$);
select cron.schedule('bf-tonight',  '0 18 26 11 *',  $$select public.bf_wave('tonight'); select cron.unschedule('bf-tonight');$$);
select cron.schedule('bf-code',     '50 11 27 11 *', $$select public.bf_wave('code'); select cron.unschedule('bf-code');$$);
select cron.schedule('bf-upgrade',  '52 11 27 11 *', $$select public.bf_wave('upgrade'); select cron.unschedule('bf-upgrade');$$);
select cron.schedule('bf-popup-on', '0 12 27 11 *',  $$select public.bf_popup(true); select cron.unschedule('bf-popup-on');$$);
select cron.schedule('bf-popup-off','0 22 27 11 *',  $$select public.bf_popup(false); select cron.unschedule('bf-popup-off');$$);

-- thank-you gift: the 4 subscribers who paid with the 50% «biox» code this week get one extra month (mail at noon)
do $$
declare r record;
begin
  for r in select s.id sid, s.user_id, s.ends_at, u.email, p.full_name from subscriptions s join payments pay on pay.id = s.payment_id
            join coupons c on c.id = pay.coupon_id join auth.users u on u.id = s.user_id join profiles p on p.id = s.user_id
           where lower(c.code) = 'biox' and pay.status = 'paid' and s.ends_at > now()
             and not exists (select 1 from email_outbox o where o.dedupe_key = 'bf-gift:' || s.id) loop
    update subscriptions set ends_at = ends_at + interval '1 month' where id = r.sid;
    perform enqueue_email('bf-gift:' || r.sid, r.email, 'هدية منّا: شهر إضافي مجانًا على اشتراكك 🎁',
      email_html('شكرًا لثقتك بنا ❤️', array[
        'أهلًا ' || coalesce(esc_html(legacy_first_name(r.full_name)), '') || '،',
        'لأنك من أوائل من اشتركوا معنا هذا الأسبوع، أضفنا <b>شهرًا إضافيًا مجانًا</b> إلى اشتراكك.',
        'ينتهي اشتراكك الآن في <b>' || to_char((r.ends_at + interval '1 month') at time zone 'Africa/Cairo', 'YYYY-MM-DD') || '</b>.',
        'استمتع بالتعلّم، ونحن هنا لأي سؤال.'], 'ابدأ التعلّم', 'account.html'));
    update email_outbox set send_after = '2026-11-26 12:00:00+02' where dedupe_key = 'bf-gift:' || r.sid;
  end loop;
end $$;
