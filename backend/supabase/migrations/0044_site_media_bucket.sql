-- public bucket for images managed from the dashboard (founder photo on «من نحن»); admins upload (policies already existed)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
-- seo_fingerprint(): now also covers site_content (about page) and the date (live counters are refreshed once a day)
-- (full definition applied in the database; same as 0040 plus: site_content rows and current_date)
