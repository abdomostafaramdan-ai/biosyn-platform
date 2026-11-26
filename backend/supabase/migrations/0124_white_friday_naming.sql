-- 0124: offer renamed «White Friday» (الجمعة البيضاء); page moved to /white-friday (/black-friday redirects there).
-- Popup title and button, bf_popup()'s title and bf_wave()'s page link updated in place (text patch of the live functions).
update site_content set updated_at = now(), data = data || jsonb_build_object('title', 'WHITE FRIDAY',
  'cta_url', '/white-friday?utm_source=popup&utm_campaign=black-friday') where key = 'promo_popup';
do $$
declare d text;
begin
  d := pg_get_functiondef('public.bf_wave(text)'::regprocedure);
  d := replace(d, '''black-friday?utm_source=campaign', '''white-friday?utm_source=campaign');
  execute d;
  d := pg_get_functiondef('public.bf_popup(boolean)'::regprocedure);
  d := replace(d, '''title'', ''BLACK FRIDAY''', '''title'', ''WHITE FRIDAY''');
  execute d;
end $$;
