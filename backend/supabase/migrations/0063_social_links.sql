-- Footer social links (admin-editable from «السوشيال والنشرة البريدية»); public read via site_content policy.
-- Newsletter sign-ups use the existing newsletter_subscribers table + newsletter_subscribe() RPC; campaigns target
-- them with audience 'newsletter' (campaign_audience). The SEO build also adds these links to Organization.sameAs.
insert into site_content (key, data) values ('social', jsonb_build_object(
  'facebook', 'https://www.facebook.com/share/1DXjWkp4oc/',
  'instagram', 'https://www.instagram.com/biosyn_eg',
  'linkedin', 'https://www.linkedin.com/company/biosyneg/',
  'tiktok', 'https://www.tiktok.com/@biosyneg',
  'whatsapp', 'https://wa.me/201069151456'))
on conflict (key) do nothing;
