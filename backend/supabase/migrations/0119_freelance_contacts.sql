-- 0119: freelancers from biosynforfreelance.com (email-verified, not banned) for Biosyn Eg campaigns.
-- Imported once on 26 Nov 2026 (424 contacts) through a one-time key-locked function that 0120 drops.
create table if not exists public.freelance_contacts (
  email text primary key, name text, source text not null default 'biosynforfreelance', imported_at timestamptz not null default now()
);
alter table public.freelance_contacts enable row level security;
drop policy if exists freelance_contacts_admin on public.freelance_contacts;
create policy freelance_contacts_admin on public.freelance_contacts for select to authenticated using (is_admin());
revoke all on public.freelance_contacts from anon, authenticated;
grant select on public.freelance_contacts to authenticated;
