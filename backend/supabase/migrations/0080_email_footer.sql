-- New shared email footer (platform description + contact by email and WhatsApp).
-- Marketing mails (reactivation, campaigns) pass p_unsub so a short unsubscribe link stays at the very bottom;
-- the old "وصلتك هذه الرسالة لأنك سجّلت سابقًا…" lines are removed from their bodies.

drop function if exists public.email_html(text, text[], text, text);
create function public.email_html(p_heading text, p_lines text[], p_link_label text default null, p_link_path text default null, p_unsub text default null)
returns text
language plpgsql stable set search_path = public
as $function$
declare
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_font text := 'Tahoma,''Segoe UI'',Arial,sans-serif';
  v_body text := ''; v_href text; l text;
begin
  foreach l in array coalesce(p_lines, array[]::text[]) loop
    if nullif(btrim(l), '') is not null then
      v_body := v_body || '<p style="margin:0 0 14px;font-size:15px;line-height:27px;color:#1d2050">' || l || '</p>';
    end if;
  end loop;
  if p_link_label is not null then
    v_href := v_site || '/' || ltrim(coalesce(p_link_path, ''), '/');
    v_body := v_body
      || '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px"><tr><td align="center" bgcolor="#c6f84a" style="border-radius:12px">'
      || '<a href="' || v_href || '" target="_blank" style="display:inline-block;padding:14px 30px;font-family:' || v_font || ';font-size:16px;font-weight:700;color:#010232;text-decoration:none;border-radius:12px">'
      || esc_html(p_link_label) || '</a></td></tr></table>';
  end if;
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Biosyn Eg</title></head>'
    || '<body style="margin:0;padding:0;background:#eef0f8">'
    || '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' || esc_html(p_heading) || '</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f8"><tr><td align="center" style="padding:28px 12px">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:' || v_font || '" dir="rtl">'
    || '<tr><td align="center" bgcolor="#010232" style="background:#010232;padding:26px 24px 22px"><a href="' || v_site || '" target="_blank">'
    || '<img src="https://biosyneg.com/img/email-logo.png" width="168" height="52" alt="BIOSYN" style="display:block;border:0;width:168px;height:auto;color:#ffffff;font-size:22px;font-weight:800"></a></td></tr>'
    || '<tr><td style="height:4px;line-height:4px;font-size:0;background:#c6f84a">&nbsp;</td></tr>'
    || '<tr><td style="padding:30px 30px 10px;text-align:right">'
    || '<h1 style="margin:0 0 18px;font-size:22px;line-height:34px;color:#010232;font-weight:800">' || esc_html(p_heading) || '</h1>'
    || v_body
    || '</td></tr>'
    || '<tr><td style="padding:22px 30px 26px;text-align:right"><hr style="border:none;border-top:1px solid #e5e7f2;margin:0 0 16px">'
    || '<p style="margin:0 0 8px;font-size:13px;line-height:22px;color:#010232;font-weight:700">منصة تعليمية وبحثية تساعدك على تطوير مهاراتك العلمية والمهنية، وتحويل معرفتك إلى فرص حقيقية.</p>'
    || '<p style="margin:0 0 8px;font-size:12px;line-height:20px;color:#5d6088"><a href="' || v_site || '" style="color:#5d6088;text-decoration:underline">biosyneg.com</a></p>'
    || '<p style="margin:0;font-size:12px;line-height:20px;color:#5d6088">وصلتك هذه الرسالة من منصة Biosyn Eg. إذا كان لديك أي استفسار أو تحتاج إلى مساعدة، يسعدنا تواصلك معنا عبر البريد الإلكتروني أو الواتساب:<br>'
    || '<a href="mailto:contact@biosyneg.com" style="color:#5d6088;text-decoration:underline">contact@biosyneg.com</a> · '
    || '<a href="https://wa.me/201069151456" target="_blank" style="color:#5d6088;text-decoration:underline">واتساب <span dir="ltr">+20 106 915 1456</span></a></p>'
    || case when p_unsub is not null then '<p style="margin:10px 0 0;font-size:11px;line-height:18px;color:#8a8db0"><a href="' || p_unsub || '" style="color:#8a8db0;text-decoration:underline">إلغاء الاشتراك في الرسائل التسويقية</a></p>' else '' end
    || '</td></tr></table></td></tr></table></body></html>';
end $function$;

create or replace function public.campaign_mail(c email_campaigns, p_name text, p_token uuid)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_first text := legacy_first_name(p_name);
  v_lines text[] := array[]::text[]; l text; v_href text;
begin
  subject := btrim(replace(replace(replace(c.subject, '{name}، ', case when v_first is null then '' else v_first || '، ' end), ' يا {name}', case when v_first is null then '' else ' يا ' || v_first end), '{name}', coalesce(v_first, '')));
  foreach l in array regexp_split_to_array(c.body, E'\\n+') loop
    if btrim(l) <> '' then
      v_lines := v_lines || regexp_replace(replace(esc_html(btrim(l)), '{name}', coalesce(esc_html(v_first), '')), '\*\*(.+?)\*\*', '<b>\1</b>', 'g');
    end if;
  end loop;
  if nullif(btrim(coalesce(c.cta_label, '')), '') is not null and nullif(btrim(coalesce(c.cta_url, '')), '') is not null then
    v_href := case when c.cta_url ~* '^https?://' then c.cta_url else v_site || '/' || ltrim(c.cta_url, '/') end;
    v_lines := v_lines || ('<a href="' || esc_html(v_href) || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">' || esc_html(c.cta_label) || '</a>');
  end if;
  html := email_html(replace(c.heading, '{name}', coalesce(v_first, '')), v_lines, null, null, v_site || '/unsubscribe.html?t=' || coalesce(p_token::text, ''));
  return next;
end $function$;

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
      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية عملنا على بناء شيء أكبر بكثير: <b>منصة Biosyn الجديدة</b>. دورات في الطب والأحياء والمعلوماتية الحيوية والبرمجة، يقدّمها محاضرون يعملون في المجال فعلًا، وشهادات برمز تحقق يمكنك إضافتها إلى سيرتك الذاتية بثقة.',
      'مكانك محفوظ، ويكفي أن تفعّل حسابك على المنصة الجديدة بالبريد الإلكتروني نفسه، ولن يستغرق ذلك أكثر من دقيقة.',
      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي ←</a>',
      '🏅 <b>هدية لمن كانوا معنا من البداية:</b> فعّل حسابك خلال ' || v_days || ' يومًا لتحصل على شارة <b>«عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم، ولن تُمنح مرة أخرى.',
      '🎁 <b>وأيضًا:</b> بعد التفعيل ستجد في حسابك رابط دعوة خاصًا بك. كل 3 أصدقاء يشتركون عبره = <b>شهر مجاني لك</b>، وإذا وصلوا إلى 10 تحصل على 6 أشهر مجانًا.',
      'لديك سؤال؟ ردّ على هذه الرسالة مباشرة، فنحن أشخاص حقيقيون ونرد بأنفسنا 🙂',
      'إلى اللقاء داخل المنصة،<br><b>عبده مصطفى</b><br>مؤسس Biosyn Eg'
    ],
    null, null, v_unsub);
  return next;
end $function$;

revoke all on function public.email_html(text, text[], text, text, text) from public, anon, authenticated;
