-- SEO / GEO / AEO settings edited from the admin dashboard and read by the static build (scripts/seo/build.py).
-- Everything here is public site information (organization facts, page titles, FAQ), so visitors may read it.
create table if not exists seo_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  rebuild_requested_at timestamptz
);
insert into seo_settings (id) values (1) on conflict do nothing;
alter table seo_settings enable row level security;
drop policy if exists seo_settings_read on seo_settings;
create policy seo_settings_read on seo_settings for select using (true);
drop policy if exists seo_settings_admin on seo_settings;
create policy seo_settings_admin on seo_settings for all using (is_admin()) with check (is_admin());
grant select on seo_settings to anon, authenticated;
grant update on seo_settings to authenticated;

create or replace function trg_seo_settings_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
revoke execute on function trg_seo_settings_touch() from public, anon, authenticated;
drop trigger if exists seo_settings_touch on seo_settings;
create trigger seo_settings_touch before update on seo_settings for each row execute function trg_seo_settings_touch();

-- "rebuild now" from the dashboard (the build checks every 15 minutes)
create or replace function seo_request_rebuild() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update seo_settings set rebuild_requested_at = t where id = 1;
  return t;
end $$;
revoke execute on function seo_request_rebuild() from public, anon;
grant execute on function seo_request_rebuild() to authenticated;

-- fingerprint of everything the static pages are built from: the build skips work when nothing changed
create or replace function seo_fingerprint() returns text
language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select string_agg(concat_ws('~', c.id, c.slug, c.title, c.summary, c.description, c.kind, c.faculty, c.specialty, c.level, c.cover_code,
                                 c.price_egp, c.intl_price, c.starts_at, c.ends_at, c.hours, c.seats, c.featured_instructor_ids::text, c.instructor_id,
                                 (select string_agg(concat_ws('^', l.title, l.position, l.duration_seconds), ',' order by l.position) from lectures l where l.course_id = c.id)), '#' order by c.id)
       from courses c where c.status = 'published'),
    (select string_agg(concat_ws('~', id, name, title, photo_url, visible, faculty), '#' order by id) from featured_instructors),
    (select string_agg(concat_ws('~', code, name, price_egp, old_price_egp, intl_price, duration_months), '#' order by code) from plans where active),
    (select string_agg(concat_ws('~', slug, title, excerpt, updated_at), '#' order by slug) from posts where published),
    (select concat_ws('~', data::text, rebuild_requested_at) from seo_settings where id = 1)));
$$;
grant execute on function seo_fingerprint() to anon, authenticated;
