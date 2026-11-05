-- Reactivation campaign for users of the old platform (Hostinger): a queue of legacy contacts,
-- a daily batch of at most N emails (Resend free plan = 100/day), unsubscribe, and the «عضو مؤسس» badge.
create table if not exists public.legacy_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  phone text,
  legacy_id text,
  legacy_created_at timestamptz,
  last_active_at timestamptz,
  source text not null default 'hostinger',
  priority int not null default 0,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped','unsubscribed','activated')),
  variant text,
  token uuid not null default gen_random_uuid() unique,
  sent_at timestamptz,
  activated_at timestamptz,
  user_id uuid references auth.users(id) on delete set null,
  founding boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists legacy_users_email_key on public.legacy_users (lower(btrim(email)));
create index if not exists legacy_users_queue on public.legacy_users (status, priority desc, legacy_created_at desc);
create index if not exists legacy_users_user on public.legacy_users (user_id);
alter table public.legacy_users enable row level security;
create policy legacy_admin on public.legacy_users for all to authenticated using (is_admin()) with check (is_admin());
create policy legacy_own on public.legacy_users for select to authenticated using (user_id = auth.uid());

insert into public.site_content (key, data) values ('reactivation', jsonb_build_object(
  'enabled', false, 'daily_limit', 80, 'total_daily_cap', 95, 'founder_days', 14,
  'subject_a', '{name}، حسابك في Biosyn ما زال بانتظارك 👀',
  'subject_b', 'عدنا بمنصة جديدة… ومقعدك محجوز يا {name}'))
on conflict (key) do nothing;
