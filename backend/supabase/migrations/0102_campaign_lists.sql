-- Campaign emails: consecutive body lines that start with "• " or "- " render as one tight checklist
-- (each item on its own line, English names kept left-to-right inside the Arabic layout).
create or replace function public.campaign_mail(c email_campaigns, p_name text, p_token uuid)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_first text := legacy_first_name(p_name);
  v_lines text[] := array[]::text[]; l text; v_href text; v_list text := ''; v_item text;
begin
  subject := btrim(replace(replace(replace(c.subject, '{name}، ', case when v_first is null then '' else v_first || '، ' end), ' يا {name}', case when v_first is null then '' else ' يا ' || v_first end), '{name}', coalesce(v_first, '')));
  foreach l in array regexp_split_to_array(c.body || E'\n', E'\\n') loop
    l := btrim(l);
    if l ~ '^(•|-)\s+' then
      v_item := regexp_replace(replace(esc_html(regexp_replace(l, '^(•|-)\s+', '')), '{name}', coalesce(esc_html(v_first), '')), '\*\*(.+?)\*\*', '<b>\1</b>', 'g');
      v_list := v_list || '<span style="display:block;padding:3px 0"><span style="color:#5b8f0a;font-weight:700">✓</span>&nbsp; <span dir="auto" style="unicode-bidi:isolate">' || v_item || '</span></span>';
      continue;
    end if;
    if v_list <> '' then v_lines := v_lines || v_list; v_list := ''; end if;
    if l <> '' then
      v_lines := v_lines || regexp_replace(replace(esc_html(l), '{name}', coalesce(esc_html(v_first), '')), '\*\*(.+?)\*\*', '<b>\1</b>', 'g');
    end if;
  end loop;
  if v_list <> '' then v_lines := v_lines || v_list; end if;
  if nullif(btrim(coalesce(c.cta_label, '')), '') is not null and nullif(btrim(coalesce(c.cta_url, '')), '') is not null then
    v_href := case when p_token is not null then email_track_url(p_token, 'cta')
                   when c.cta_url ~* '^https?://' then c.cta_url else v_site || '/' || ltrim(c.cta_url, '/') end;
    v_lines := v_lines || ('<a href="' || esc_html(v_href) || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">' || esc_html(c.cta_label) || '</a>');
  end if;
  html := email_html(replace(c.heading, '{name}', coalesce(v_first, '')), v_lines, null, null, v_site || '/unsubscribe.html?t=' || coalesce(p_token::text, ''));
  if p_token is not null then
    html := replace(html, '</body>', '<img src="' || email_track_url(p_token) || '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0"></body>');
  end if;
  return next;
end $function$;
