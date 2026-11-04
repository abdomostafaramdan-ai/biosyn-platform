-- Branded email layout (navy header + logo, lime accent and button, RTL), same design as the Supabase Auth templates
-- (backend/email-templates/build.py). Signature unchanged, so every existing email picks it up.
create or replace function email_html(p_heading text, p_lines text[], p_link_label text default null, p_link_path text default null)
returns text language plpgsql stable set search_path = public as $$
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
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Biosyn Egypt</title></head>'
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
    || '<p style="margin:0 0 6px;font-size:13px;line-height:21px;color:#010232;font-weight:700">Biosyn Egypt · تعليم علمي وطبي بمحتوى مهني</p>'
    || '<p style="margin:0;font-size:12px;line-height:20px;color:#5d6088"><a href="' || v_site || '" style="color:#5d6088;text-decoration:underline">biosyneg.com</a> · '
    || '<a href="mailto:contact@biosynegypt.com" style="color:#5d6088;text-decoration:underline">contact@biosynegypt.com</a><br>وصلك الإيميل ده لأن عندك حساب على منصة Biosyn Egypt.</p>'
    || '</td></tr></table></td></tr></table></body></html>';
end $$;
