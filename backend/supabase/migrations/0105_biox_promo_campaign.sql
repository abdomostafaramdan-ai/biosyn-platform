-- Campaign: 50% off all plans, promo code biox, highlight on the semiannual plan.
-- Audience: ALL platform users (non_subscribers = students without an active subscription)
--           + legacy users (old platform, not yet on the new one).
-- Schedule: immediate send + two follow-ups (morning + evening next day).
-- Email text revised below.

-- ─────────────────────────────────────────────
-- 1. Improved reactivation email (cleaner copy,
--    stronger highlight on the semiannual plan,
--    consistent biox code mention)
-- ─────────────────────────────────────────────
create or replace function public.reactivation_mail(r legacy_users, p_variant text)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  cfg    jsonb  := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text   := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_name text   := legacy_first_name(r.full_name);
  v_days int    := coalesce((cfg->>'founder_days')::int, 14);
  v_mail text   := replace(replace(replace(replace(lower(btrim(r.email)), '%', '%25'), '+', '%2B'), '&', '%26'), '#', '%23');
  v_subj text   := coalesce(nullif(cfg->>case when p_variant = 'B' then 'subject_b' else 'subject_a' end, ''),
                             case when p_variant = 'B'
                               then 'عدنا بمنصة جديدة… ومقعدك محجوز{name}'
                               else '{name}، حسابك في Biosyn ما زال بانتظارك 👀'
                             end);
  v_unsub text  := v_site || '/unsubscribe.html?t=' || r.token;
  v_cta   text  := v_site || '/login.html?mode=signup&email=' || v_mail
                   || '&utm_source=reactivation&utm_medium=email&utm_campaign=legacy_' || lower(coalesce(p_variant, 'a'));
  -- سعر الباقة نص السنوية بعد خصم biox (50%)
  v_semi_orig   numeric;
  v_semi_disc   numeric;
  v_semi_name   text;
begin
  -- حل placeholder {name}
  if v_name is null then
    v_subj := btrim(replace(replace(replace(v_subj, '{name}، ', ''), ' يا {name}', ''), '{name}', ''));
  else
    v_subj := replace(v_subj, '{name}', v_name);
  end if;
  subject := v_subj;

  -- جيب سعر الباقة نص السنوية
  select name, price_egp into v_semi_name, v_semi_orig
    from plans where active and duration_months = 6 order by price_egp limit 1;
  v_semi_disc := round(coalesce(v_semi_orig, 1499) * 0.50);

  html := email_html(
    'مرحبًا' || coalesce(' ' || esc_html(v_name), '') || ' 👋',
    array[
      'هل تتذكر Biosyn؟ نحن نتذكرك 😄',

      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية أطلقنا <b>منصة Biosyn الجديدة</b>: دورات مسجلة وتفاعلية لطلاب كليات العلوم والصيدلة والبايوتكنولوجي والزراعة والطب والتمريض والعلوم الصحية، مع <b>شهادات برمز تحقق</b> تُضيفها لسيرتك الذاتية بثقة.',

      -- هايلايت الباقة نص السنوية
      '<div dir="rtl" style="background:#f0ffd6;border:2px solid #c6f84a;border-radius:14px;padding:16px 20px;margin:4px 0">'
      || '<p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#010232">⭐ الباقة الأوفر: نصف سنوية (6 أشهر)</p>'
      || '<p style="margin:0 0 4px;font-size:14px;color:#1d2050">وصول كامل لجميع الدورات لمدة 6 أشهر متواصلة</p>'
      || '<p style="margin:0;font-size:17px;color:#010232"><s style="color:#888">' || to_char(coalesce(v_semi_orig, 1499), 'FM999,999') || ' ج.م</s>'
      || ' &nbsp;→&nbsp; <b style="color:#2d7a00;font-size:19px">' || to_char(v_semi_disc, 'FM999,999') || ' ج.م</b> فقط مع كود <b dir="ltr" style="letter-spacing:1px;color:#010232">biox</b></p>'
      || '</div>',

      '🎁 <b>هدية لمن كانوا معنا من البداية:</b> فعّل حسابك خلال <b>' || v_days || ' يومًا</b> لتحصل على:'
      || '<br>✦ <b>شارة «عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم — ولن تُمنح مرة أخرى.'
      || '<br>✦ <b>خصم 50٪</b> على جميع الباقات باستخدام كود <b dir="ltr" style="font-size:17px;letter-spacing:1px">biox</b> عند الدفع.',

      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي واستخدم الكود ←</a>',

      '🤝 <b>ادعُ أصدقاءك واكسب:</b> بعد التفعيل ستجد رابط دعوة خاصًا بك — كل 3 أصدقاء يشتركون = <b>شهر مجاني لك</b>، و10 أصدقاء = <b>6 أشهر مجانًا</b>.'
    ],
    null, null, v_unsub);
  return next;
end $function$;

-- ─────────────────────────────────────────────
-- 2. Campaign template: خصم biox 50% للجميع
--    (platform students + legacy users)
-- ─────────────────────────────────────────────
insert into email_campaigns (name, subject, heading, body, cta_label, cta_url, audience, status, total)
values (
  'biox 50% · template',

  '{name}، خصم 50٪ حصري على Biosyn — كود biox 🎁',

  '{name}، هدية منّا لك 🎁',

  E'وصلك الإيميل ده لأن عندك حساب على Biosyn وما اشتركتش في الباقات بعد — وإحنا عايزين يتغير ده 😄\n'
  || E'\n'
  || E'⭐ **الباقة نصف السنوية — الأوفر والأنسب:**\n'
  || E'• وصول كامل لجميع الدورات لمدة 6 أشهر\n'
  || E'• أكثر من 15 دورة في العلوم والصيدلة والبيولوجيا والبايوانفورماتكس والطب\n'
  || E'• شهادات برمز تحقق يمكنك إضافتها لـ LinkedIn وسيرتك الذاتية\n'
  || E'• حضور الجلسات التفاعلية والمباشرة عبر Zoom\n'
  || E'• دعم ومتابعة من المدرسين عبر مجموعات الواتساب\n'
  || E'\n'
  || E'💡 ليه نصف سنوية بالذات؟ لأنك بتاخد وقت كافي تخلص أكتر من كورس وتتابع بجدية، بدل ما تضغط على نفسك في شهر واحد.\n'
  || E'\n'
  || E'🎁 **العرض الحصري:**\n'
  || E'استخدم كود **biox** وهتاخد خصم 50٪ على أي باقة تختارها، سواء الشهرية أو نصف السنوية أو السنوية.\n'
  || E'\n'
  || E'العرض ده مش هيتكرر — استخدم الكود دلوقتي 👇',

  'اشترك دلوقتي واستخدم كود biox ←',
  'pricing.html?utm_source=campaign&utm_medium=email&utm_campaign=biox50',
  'non_subscribers+legacy',
  'draft',
  0
)
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 3. Function: إرسال حملة biox مع جدولة follow-ups
-- ─────────────────────────────────────────────
create or replace function public.biox_campaign_launch()
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  v_tmpl uuid;
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  r1 json; r2 json; r3 json;
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then
    raise exception 'not allowed';
  end if;

  select id into v_tmpl from email_campaigns where name = 'biox 50% · template' limit 1;
  if v_tmpl is null then raise exception 'template not found'; end if;

  -- الإرسال الفوري (platform + legacy)
  r1 := promo_campaign_send(
    v_tmpl,
    'biox 50% · إرسال 1',
    '{name}، خصم 50٪ حصري على Biosyn — كود biox 🎁',
    true,
    null
  );

  -- Follow-up 1: الغد 10:00 صباحًا (platform فقط)
  perform cron.schedule('biox-followup-1',
    to_char((now() at time zone 'Africa/Cairo')::date + 1 || ' 08:00:00+02', '"0 8 "DD" "MM" * "'),
    format($$select public.promo_campaign_send(%L, 'biox 50%% · follow-up 1', '{name}، لسه في وقت — كود biox شغّال ⏳', false, 'biox-followup-1')$$, v_tmpl)
  );

  -- Follow-up 2: الغد 6:00 مساءً (platform فقط)
  perform cron.schedule('biox-followup-2',
    to_char((now() at time zone 'Africa/Cairo')::date + 1 || ' 16:00:00+02', '"0 16 "DD" "MM" * "'),
    format($$select public.promo_campaign_send(%L, 'biox 50%% · follow-up 2', 'آخر فرصة {name} — كود biox ينتهي الليلة 🔥', false, 'biox-followup-2')$$, v_tmpl)
  );

  return json_build_object('wave_1', r1, 'followup_1', 'scheduled tomorrow 10:00 Cairo', 'followup_2', 'scheduled tomorrow 18:00 Cairo');
end $function$;
revoke all on function public.biox_campaign_launch() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. ظبط نص email_html: تغيير footer ليحمل اسم "Biosyn Eg"
-- ─────────────────────────────────────────────
do $do$
declare
  d text;
  old_footer text := 'Biosyn Egypt · تعليم علمي وطبي بمحتوى مهني';
  new_footer text := 'Biosyn Eg · تعليم علمي وطبي بمحتوى مهني';
begin
  d := pg_get_functiondef('public.email_html(text, text[], text, text, text)'::regprocedure);
  if position(old_footer in d) > 0 then
    d := replace(d, old_footer, new_footer);
    execute d;
    raise notice 'email_html footer updated';
  else
    raise notice 'email_html footer already updated or not found — skipping';
  end if;
end $do$;
