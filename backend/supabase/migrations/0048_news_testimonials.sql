-- «الأخبار والفعاليات» (news + events, one page) and «آراء الطلاب» (feedback strip on the home page).
create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'news' check (kind in ('news','event')),
  title text not null,
  summary text,
  body text,
  cover_url text,
  gallery jsonb not null default '[]',
  video_url text,
  event_date date,
  location text,
  published_at timestamptz not null default now(),
  visible boolean not null default true,
  featured boolean not null default false,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists news_items_pub on public.news_items (visible, published_at desc);
alter table public.news_items enable row level security;
create policy news_public on public.news_items for select using (visible or is_admin());
create policy news_admin on public.news_items for all to authenticated using (is_admin()) with check (is_admin());

create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  image_url text,
  quote text,
  author text,
  role text,
  sort int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  check (image_url is not null or quote is not null)
);
alter table public.testimonials enable row level security;
create policy testimonials_public on public.testimonials for select using (visible or is_admin());
create policy testimonials_admin on public.testimonials for all to authenticated using (is_admin()) with check (is_admin());
-- (data: 10 feedback screenshots and 8 news/events posts imported from the old WordPress site)
