-- Instructors shown on the website (home strip + instructors page), managed from the admin dashboard.
create table if not exists featured_instructors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 80),
  title       text check (title is null or length(title) <= 240),
  photo_url   text check (photo_url is null or photo_url ~ '^https://'),
  faculty     text check (faculty is null or faculty in ('science','biotech','pharmacy','agriculture','medicine','veterinary','dentistry','health_tech')),
  profile_id  uuid references profiles(id) on delete set null,
  sort        int not null default 100,
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table featured_instructors enable row level security;
create policy fi_public_read on featured_instructors for select to anon, authenticated using (visible or is_admin());
create policy fi_admin_write on featured_instructors for all to authenticated using (is_admin()) with check (is_admin());
create index if not exists featured_instructors_sort_idx on featured_instructors (sort, created_at);

-- public bucket for site images (instructor photos); only admins can write
insert into storage.buckets (id, name, public) values ('site-media', 'site-media', true) on conflict (id) do nothing;
create policy site_media_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and is_admin());
create policy site_media_admin_update on storage.objects for update to authenticated using (bucket_id = 'site-media' and is_admin());
create policy site_media_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'site-media' and is_admin());

insert into featured_instructors (name, title, faculty, sort) values
 ('د. غريب السيد', 'أستاذ مشارك، قسم بحوث الإشعاع الدوائي، هيئة الطاقة الذرية المصرية', 'pharmacy', 10),
 ('إسراء مصطفي', 'بكالوريوس العلوم من جامعة الإسكندرية، تخصص كيمياء وعلوم بيئية.', 'science', 20),
 ('د. مينا مايكل', 'أستاذ مساعد، علم العقاقير والمنتجات الطبيعية، جامعة الأهرام الكندية', 'pharmacy', 30),
 ('د. أحمد سيد', 'محاضر علم الأجنة، كلية العلوم، جامعة الأزهر، أسيوط، مصر', 'science', 40),
 ('د. علاء الدين محمود', 'أستاذ مساعد للعلوم البيئية، كلية العلوم، جامعة الإسكندرية', 'science', 50),
 ('د. أحمد عماد', 'مرشح للدكتوراه في معهد الهندسة الحرارية الفيزيائية، الأكاديمية الصينية للعلوم', 'science', 60),
 ('د. محمد إمام', 'طالب دكتوراه، المعلوماتية الحيوية، كلية العلوم، جامعة بورتو، البرتغال', 'biotech', 70),
 ('د. شريف عرفه', 'طالب دكتوراه في قسم الكيمياء الحيوية، جامعة توبنغن، ألمانيا', 'science', 80);
