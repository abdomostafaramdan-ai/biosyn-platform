-- 0121: the 124 freelancers who never confirmed their e-mail on biosynforfreelance.com were added on request
-- (26 Nov 2026), marked email_verified = false. Same one-time key-locked import as 0119, dropped right after.
alter table public.freelance_contacts add column if not exists email_verified boolean not null default true;
drop function if exists public.fl_import(text, jsonb);
delete from security_state where key = 'fl_import_key';
update security_state set value = value - 'fl_import' where key = 'anon_fn_allow';
