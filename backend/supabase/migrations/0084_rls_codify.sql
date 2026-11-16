-- Security: record in the repo the row-level security that is already live for the admin-tool tables created in 0049_0055
-- (that file only created the tables), tighten what browser roles may do, and spell out the public request form rules.
-- Nothing here loosens a policy: every policy below is created only if missing and matches the live definition exactly.

-- 1) RLS on (already on in production; this makes a rebuild from the repo safe)
alter table public.form_attempts       enable row level security;
alter table public.text_overrides      enable row level security;
alter table public.email_optouts       enable row level security;
alter table public.email_campaigns     enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.form_collaborators  enable row level security;
alter table public.form_answer_keys    enable row level security;

do $do$
begin
  -- staff can read open/leave/submit timestamps; nobody writes from the browser (SECURITY DEFINER RPCs do)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='form_attempts' and policyname='form_attempts_staff') then
    create policy form_attempts_staff on public.form_attempts for select to authenticated using (is_staff());
  end if;
  -- site text overrides are public; email overrides and all writes are admin only
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='text_overrides' and policyname='text_overrides_public') then
    create policy text_overrides_public on public.text_overrides for select using (scope = 'site' or is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='text_overrides' and policyname='text_overrides_admin') then
    create policy text_overrides_admin on public.text_overrides for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  -- e-mail opt-outs and campaigns: admin only (unsubscribe goes through a SECURITY DEFINER RPC)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_optouts' and policyname='email_optouts_admin') then
    create policy email_optouts_admin on public.email_optouts for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_campaigns' and policyname='email_campaigns_admin') then
    create policy email_campaigns_admin on public.email_campaigns for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaign_recipients' and policyname='campaign_recipients_admin') then
    create policy campaign_recipients_admin on public.campaign_recipients for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  -- form sharing: admins manage invitations; a signed-in user sees only the invitations addressed to their own e-mail
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='form_collaborators' and policyname='fc_admin') then
    create policy fc_admin on public.form_collaborators for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='form_collaborators' and policyname='fc_self') then
    create policy fc_self on public.form_collaborators for select to authenticated using (lower(email) = my_email());
  end if;
  -- answer keys: only the form's owner/editors, never students
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='form_answer_keys' and policyname='fak_manage') then
    create policy fak_manage on public.form_answer_keys for all to authenticated
      using (form_role(form_id) = any (array['owner','editor'])) with check (form_role(form_id) = any (array['owner','editor']));
  end if;
end $do$;

-- 2) browser roles never need TRUNCATE / TRIGGER / REFERENCES (RLS does not cover TRUNCATE)
revoke truncate, trigger, references on public.form_attempts, public.text_overrides, public.email_optouts, public.email_campaigns,
  public.campaign_recipients, public.form_collaborators, public.form_answer_keys, public.requests from anon, authenticated;

-- 3) requests: public forms keep inserting, but the policy itself now states what the request_validate trigger enforces:
--    the row belongs to the caller (or nobody when signed out), starts as 'new', and refunds only go through request_refund().
--    Reading stays limited to staff and to one's own refund requests; updating stays staff-only; nobody can delete.
alter policy requests_create on public.requests
  with check (user_id is not distinct from auth.uid() and status = 'new' and type <> 'refund');
