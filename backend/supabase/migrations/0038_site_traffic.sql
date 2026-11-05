-- First-party traffic analytics for the admin dashboard: who visited, when, from which country/source/device.
-- No IP addresses are stored. The country comes from the server-side geo lookup the site already does (functions/v1/geo).

create table if not exists visits (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  vid        text not null,                 -- anonymous visitor id (localStorage), not linked to a person unless signed in
  sid        text not null,                 -- session id (30 min of inactivity = new session)
  user_id    uuid references auth.users(id) on delete set null,
  path       text not null,
  ref_host   text,
  source     text not null default 'direct',
  country    text,
  device     text,
  browser    text,
  os         text,
  lang       text,
  is_new     boolean not null default false
);
create index if not exists visits_at_idx on visits (at);
create index if not exists visits_vid_at_idx on visits (vid, at);
alter table visits enable row level security;   -- no policies: written by track_visit(), read by admin_traffic() only

create or replace function track_visit(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_vid text := left(coalesce(p->>'vid', ''), 40);
  v_sid text := left(coalesce(p->>'sid', ''), 40);
  v_path text := left(coalesce(p->>'path', '/'), 200);
  v_cc text := upper(coalesce(p->>'cc', ''));
  v_dev text := p->>'dev';
begin
  if v_vid !~ '^[A-Za-z0-9-]{8,40}$' or v_sid !~ '^[A-Za-z0-9-]{8,40}$' then return; end if;
  if v_path !~ '^/' then v_path := '/' || v_path; end if;
  if v_cc !~ '^[A-Z]{2}$' then v_cc := null; end if;
  if v_dev not in ('mobile', 'tablet', 'desktop') then v_dev := null; end if;
  if auth.uid() is not null and is_staff() then return; end if;                  -- the team's own browsing doesn't count
  if (select count(*) from visits where vid = v_vid and at > now() - interval '1 minute') >= 30 then return; end if;   -- flood guard
  insert into visits (vid, sid, user_id, path, ref_host, source, country, device, browser, os, lang, is_new)
  values (v_vid, v_sid, auth.uid(), v_path, nullif(left(p->>'ref', 100), ''), coalesce(nullif(left(lower(p->>'src'), 40), ''), 'direct'),
          v_cc, v_dev, left(p->>'br', 20), left(p->>'os', 20), left(p->>'lang', 10), coalesce((p->>'new')::boolean, false));
end $$;
revoke execute on function track_visit(jsonb) from public;
grant execute on function track_visit(jsonb) to anon, authenticated;

-- one call for the whole dashboard. Calendar boundaries in Cairo time.
create or replace function admin_traffic(p_from timestamptz default null, p_to timestamptz default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := 'Africa/Cairo';
  t_now timestamp := now() at time zone tz;
  d0 timestamptz := date_trunc('day', t_now) at time zone tz;
  m0 timestamptz := date_trunc('month', t_now) at time zone tz;
  y0 timestamptz := date_trunc('year', t_now) at time zone tz;
  f timestamptz := coalesce(p_from, now() - interval '30 days');
  t timestamptz := coalesce(p_to, now());
  daily boolean;
begin
  if not is_staff() then raise exception 'not allowed'; end if;
  daily := t - f <= interval '93 days';
  return json_build_object(
    'kpi', json_build_object(
      'online',      (select count(distinct vid) from visits where at > now() - interval '5 minutes'),
      'today_v',     (select count(distinct vid) from visits where at >= d0),
      'today_pv',    (select count(*) from visits where at >= d0),
      'month_v',     (select count(distinct vid) from visits where at >= m0),
      'month_pv',    (select count(*) from visits where at >= m0),
      'year_v',      (select count(distinct vid) from visits where at >= y0),
      'year_pv',     (select count(*) from visits where at >= y0),
      'all_v',       (select count(distinct vid) from visits),
      'yesterday_v', (select count(distinct vid) from visits where at >= d0 - interval '1 day' and at < d0),
      'signups_today', (select count(*) from auth.users where created_at >= d0),
      'signups_month', (select count(*) from auth.users where created_at >= m0),
      'signups_year',  (select count(*) from auth.users where created_at >= y0)),
    'range', json_build_object(
      'visitors',  (select count(distinct vid) from visits where at >= f and at < t),
      'sessions',  (select count(distinct sid) from visits where at >= f and at < t),
      'pageviews', (select count(*) from visits where at >= f and at < t),
      'new_v',     (select count(distinct vid) from visits where at >= f and at < t and is_new),
      'signed_in', (select count(distinct user_id) from visits where at >= f and at < t and user_id is not null),
      'signups',   (select count(*) from auth.users where created_at >= f and created_at < t),
      'signups_by', (select coalesce(json_object_agg(k, n), '{}') from (select coalesce(raw_app_meta_data->>'provider', 'email') k, count(*) n from auth.users where created_at >= f and created_at < t group by 1) s),
      'paid',      (select count(*) from payments where status = 'paid' and paid_at >= f and paid_at < t)),
    'series', (select coalesce(json_agg(json_build_object('d', b, 'v', v, 'pv', pv) order by b), '[]') from (
        select to_char(date_trunc(case when daily then 'day' else 'month' end, at at time zone tz), case when daily then 'YYYY-MM-DD' else 'YYYY-MM' end) b,
               count(distinct vid) v, count(*) pv
          from visits where at >= f and at < t group by 1) s),
    'countries', (select coalesce(json_agg(json_build_object('k', k, 'v', v, 'pv', pv) order by v desc), '[]') from (
        select coalesce(country, '??') k, count(distinct vid) v, count(*) pv from visits where at >= f and at < t group by 1 order by 2 desc limit 30) s),
    'sources', (select coalesce(json_agg(json_build_object('k', k, 'v', v) order by v desc), '[]') from (
        select source k, count(distinct sid) v from visits where at >= f and at < t group by 1 order by 2 desc limit 15) s),
    'pages', (select coalesce(json_agg(json_build_object('k', k, 'v', v, 'pv', pv) order by pv desc), '[]') from (
        select path k, count(distinct vid) v, count(*) pv from visits where at >= f and at < t group by 1 order by 3 desc limit 20) s),
    'devices', (select coalesce(json_agg(json_build_object('k', k, 'v', v) order by v desc), '[]') from (
        select coalesce(device, 'unknown') k, count(distinct vid) v from visits where at >= f and at < t group by 1) s),
    'browsers', (select coalesce(json_agg(json_build_object('k', k, 'v', v) order by v desc), '[]') from (
        select coalesce(browser, 'Other') k, count(distinct vid) v from visits where at >= f and at < t group by 1 order by 2 desc limit 8) s),
    'hours', (select coalesce(json_agg(json_build_object('h', h, 'pv', pv) order by h), '[]') from (
        select extract(hour from at at time zone tz)::int h, count(*) pv from visits where at >= f and at < t group by 1) s),
    'daily', daily,
    'from', f, 'to', t);
end $$;
revoke execute on function admin_traffic(timestamptz, timestamptz) from public, anon;
grant execute on function admin_traffic(timestamptz, timestamptz) to authenticated;

-- keep 25 months of raw visits (enough for year-over-year)
select cron.unschedule('purge-visits') where exists (select 1 from cron.job where jobname = 'purge-visits');
select cron.schedule('purge-visits', '41 3 * * *', $$delete from visits where at < now() - interval '25 months'$$);
