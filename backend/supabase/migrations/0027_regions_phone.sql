-- Regional pricing + phone/country at signup.
--  * Outside Egypt, prices show and charge in the visitor's currency: local price = round(EGP price × factor).
--    factor = 1 means "same number" (200 EGP plan → 200 SAR). Edited from the admin panel.
--  * egp_rate (EGP per 1 unit) converts what was actually collected back to EGP, so revenue share,
--    dashboards and reports keep working in one currency.
--  * Country '*' covers every country without its own row.

create table if not exists price_regions (
  country    text primary key check (country = '*' or country ~ '^[A-Z]{2}$'),
  name       text not null,
  currency   text not null check (currency ~ '^[A-Z]{3}$'),
  symbol     text not null,
  factor     numeric(10,4) not null default 1 check (factor > 0),
  egp_rate   numeric(12,4) not null check (egp_rate > 0),
  decimals   int not null default 2 check (decimals between 0 and 3),
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table price_regions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'price_regions' and policyname = 'regions_read') then
    create policy regions_read on price_regions for select to anon, authenticated using (true);
    create policy regions_admin on price_regions for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;

-- exchange rates: CBE-area USD ≈ 56.3 EGP (late Oct 2026); Gulf/Jordan currencies are pegged to USD
insert into price_regions (country, name, currency, symbol, factor, egp_rate, decimals) values
  ('SA', 'السعودية', 'SAR', 'ر.س', 1, 15.01, 2),
  ('AE', 'الإمارات', 'AED', 'د.إ', 1, 15.33, 2),
  ('QA', 'قطر',      'QAR', 'ر.ق', 1, 15.47, 2),
  ('KW', 'الكويت',   'KWD', 'د.ك', 1, 183.40, 3),
  ('BH', 'البحرين',  'BHD', 'د.ب', 1, 149.70, 3),
  ('OM', 'عُمان',    'OMR', 'ر.ع', 1, 146.40, 3),
  ('JO', 'الأردن',   'JOD', 'د.أ', 1, 79.40, 3),
  ('*',  'باقي الدول', 'USD', '$', 1, 56.30, 2)
on conflict (country) do nothing;

-- what was charged, in the customer's currency (amount_egp / fee_egp stay the EGP equivalent)
alter table payments add column if not exists currency text not null default 'EGP';
alter table payments add column if not exists amount_local numeric(14,3);
alter table payments add column if not exists fee_local numeric(14,3);
alter table payments add column if not exists fx_egp numeric(12,4);
alter table payments add column if not exists country text;

-- phone + country from the signup form (or completed later for Google sign-ins)
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid; m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  select id into v_ref from profiles where ref_code = upper(btrim(coalesce(m->>'ref','')));
  insert into profiles (id, full_name, referred_by, phone, country)
  values (new.id, coalesce(nullif(m->>'full_name',''), m->>'name', ''), v_ref,
          nullif(left(regexp_replace(coalesce(m->>'phone',''), '[^0-9+]', '', 'g'), 20), ''),
          nullif(upper(left(coalesce(m->>'country',''), 2)), ''));
  return new;
end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;
