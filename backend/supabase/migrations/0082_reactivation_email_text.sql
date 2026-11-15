-- Reactivation email: new copy (faculty list, 50% off all plans with code biox); support/signature lines removed.

create or replace function public.reactivation_mail(r legacy_users, p_variant text)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_name text := legacy_first_name(r.full_name);
  v_days int := coalesce((cfg->>'founder_days')::int, 14);
  v_mail text := replace(replace(replace(replace(lower(btrim(r.email)), '%', '%25'), '+', '%2B'), '&', '%26'), '#', '%23');
  v_subj text := coalesce(nullif(cfg->>case when p_variant = 'B' then 'subject_b' else 'subject_a' end, ''), 'حسابك في Biosyn ما زال بانتظارك 👀');
  v_unsub text := v_site || '/unsubscribe.html?t=' || r.token;
  v_cta text := v_site || '/login.html?mode=signup&email=' || v_mail || '&utm_source=reactivation&utm_medium=email&utm_campaign=legacy_' || lower(coalesce(p_variant, 'a'));
begin
  if v_name is null then
    v_subj := btrim(replace(replace(replace(v_subj, '{name}، ', ''), ' يا {name}', ''), '{name}', ''));
  else
    v_subj := replace(v_subj, '{name}', v_name);
  end if;
  subject := v_subj;
  html := email_html(
    'مرحبًا' || coalesce(' ' || esc_html(v_name), '') || ' 👋',
    array[
      'هل تتذكر Biosyn؟ نحن نتذكرك جيدًا 😄',
      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية عملنا على بناء شيء أكبر بكثير: <b>منصة Biosyn الجديدة</b>. دورات مسجلة وتفاعلية لكليات العلوم، والصيدلة، والبايوتكنولوجي، والزراعة، والطب البشري، والطب البيطري، وطب الأسنان، والعلاج الطبيعي، والعلوم الصحية والتطبيقية، وشهادات برمز تحقق يمكنك إضافتها إلى سيرتك الذاتية بثقة.',
      'مكانك محفوظ، ويكفي أن تفعّل حسابك على المنصة الجديدة بالبريد الإلكتروني نفسه، ولن يستغرق ذلك أكثر من دقيقة.',
      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي ←</a>',
      '🏅 <b>هدية لمن كانوا معنا من البداية:</b> فعّل حسابك خلال ' || v_days || ' يومًا لتحصل على شارة <b>«عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم، ولن تُمنح مرة أخرى، و<b>خصم 50٪ على جميع الباقات</b> باستخدام كود <b dir="ltr" style="font-size:16px;letter-spacing:1px">biox</b>.',
      '🎁 <b>وأيضًا:</b> بعد التفعيل ستجد في حسابك رابط دعوة خاصًا بك. كل 3 أصدقاء يشتركون عبره = <b>شهر مجاني لك</b>، وإذا وصلوا إلى 10 تحصل على 6 أشهر مجانًا.'
    ],
    null, null, v_unsub);
  return next;
end $function$;

