-- Applied to the live project via MCP (2026-11-05/06) as migrations:
--   0049_home_stats_from_about      public_stats(): students/countries/instructors from about_stats() (base + live growth)
--   0050_admin_users_export         admin_users_export(): every account + subscription, payments, referrals, legacy flags (Excel export)
--   0051_request_threads            threads.request_id / contact_email, student_id nullable; request_thread(); link on sign-up;
--                                   staff replies to people without an account are emailed with a sign-up link
--   0052_timed_forms                forms.settings {lock_on_leave, total_minutes}; fields[].time_limit; form_attempts; form_start();
--                                   submit_form() accepts __meta {attempt, left_page, timed_out} and records time taken
--   0053_text_overrides_email_settings  text_overrides (scope site|email); enqueue_email() applies email overrides, header/accent
--                                   colours and per-type disabling (site_content.email_settings); email_catalog(), email_latest()
--   0054/0055_email_campaigns       email_optouts, email_campaigns, campaign_recipients; campaign_audience(), campaign_mail(),
--                                   campaign_preview/send_test/start/send_batch(); marketing_daily_batch(); unsubscribe → opt-out
-- Function bodies: see the live database (pg_get_functiondef) — this file records the schema.
alter table public.courses add column if not exists cover_url text;
alter table public.threads alter column student_id drop not null;
alter table public.threads add column if not exists request_id uuid references public.requests(id) on delete set null;
alter table public.threads add column if not exists contact_email text;
alter table public.forms add column if not exists settings jsonb not null default '{}';
create table if not exists public.form_attempts (id uuid primary key default gen_random_uuid(), form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, started_at timestamptz not null default now(), left_at timestamptz, submitted_at timestamptz);
create table if not exists public.text_overrides (id uuid primary key default gen_random_uuid(), scope text not null default 'site' check (scope in ('site','email')),
  original text not null, replacement text not null, replacement_en text, page text, updated_at timestamptz not null default now(), unique (scope, original));
create table if not exists public.email_optouts (email text primary key, source text, created_at timestamptz not null default now());
create table if not exists public.email_campaigns (id uuid primary key default gen_random_uuid(), name text not null, subject text not null, heading text not null, body text not null,
  cta_label text, cta_url text, audience text not null default 'all_users', status text not null default 'draft' check (status in ('draft','sending','paused','done')),
  total int not null default 0, sent int not null default 0, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz);
create table if not exists public.campaign_recipients (id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  email text not null, name text, user_id uuid, token uuid not null default gen_random_uuid() unique, status text not null default 'queued' check (status in ('queued','sent','skipped')), sent_at timestamptz);
