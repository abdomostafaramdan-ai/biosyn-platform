-- Admin → المدفوعات: permanently delete a payment (e.g. a test order) together with what it created:
-- the subscription or the course enrollment it opened and any referral credit it earned.
-- A copy of everything removed is kept in payment_deletions (who, when, why), so the books can always be explained.
-- Refused when the payment's month is already closed for instructor earnings (it would change paid-out numbers),
-- and when its subscription was used to grant a referral reward.

create table if not exists public.payment_deletions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  receipt_no int,
  snapshot jsonb not null,
  linked jsonb not null default '{}',
  reason text not null,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now()
);
alter table public.payment_deletions enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'payment_deletions' and policyname = 'payment_deletions_admin') then
    create policy payment_deletions_admin on public.payment_deletions for select to authenticated using (is_admin());
  end if;
end $do$;
revoke insert, update, delete, truncate on public.payment_deletions from anon, authenticated;

-- what deleting would remove (shown in the confirmation dialog)
create or replace function public.admin_payment_links(p_payment uuid)
returns json
language plpgsql stable security definer set search_path = public
as $function$
declare p payments;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into p from payments where id = p_payment;
  if not found then raise exception 'payment not found'; end if;
  return json_build_object(
    'subscriptions', (select count(*) from subscriptions where payment_id = p_payment),
    'active_subscriptions', (select count(*) from subscriptions where payment_id = p_payment and status = 'active' and ends_at > now()),
    'enrollments', (select count(*) from enrollments where payment_id = p_payment),
    'referrals', (select count(*) from referral_qualified where payment_id = p_payment),
    'month_closed', p.purpose = 'subscription' and p.paid_at is not null
                    and exists (select 1 from month_pools m where m.month = date_trunc('month', p.paid_at at time zone 'UTC')::date and m.closed_at is not null),
    'reward_used', exists (select 1 from referral_grants g join subscriptions s on s.id = g.subscription_id where s.payment_id = p_payment));
end $function$;

create or replace function public.admin_delete_payment(p_payment uuid, p_reason text)
returns json
language plpgsql security definer set search_path = public
as $function$
declare p payments; v_subs jsonb; v_enr jsonb; v_ref jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason required'; end if;
  select * into p from payments where id = p_payment for update;
  if not found then raise exception 'payment not found'; end if;
  if p.purpose = 'subscription' and p.paid_at is not null
     and exists (select 1 from month_pools m where m.month = date_trunc('month', p.paid_at at time zone 'UTC')::date and m.closed_at is not null) then
    raise exception 'month closed: instructor earnings for this month were already calculated';
  end if;
  if exists (select 1 from referral_grants g join subscriptions s on s.id = g.subscription_id where s.payment_id = p_payment) then
    raise exception 'subscription used for a referral reward';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into v_subs from subscriptions s where s.payment_id = p_payment;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into v_enr from enrollments e where e.payment_id = p_payment;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into v_ref from referral_qualified r where r.payment_id = p_payment;

  insert into payment_deletions (payment_id, receipt_no, snapshot, linked, reason, deleted_by)
  values (p.id, p.receipt_no, to_jsonb(p), jsonb_build_object('subscriptions', v_subs, 'enrollments', v_enr, 'referrals', v_ref),
          left(btrim(p_reason), 300), auth.uid());

  delete from referral_qualified where payment_id = p_payment;
  delete from subscriptions where payment_id = p_payment;
  delete from enrollments where payment_id = p_payment;
  delete from payments where id = p_payment;

  return json_build_object('deleted', true, 'subscriptions', jsonb_array_length(v_subs), 'enrollments', jsonb_array_length(v_enr),
                           'referrals', jsonb_array_length(v_ref));
end $function$;

revoke all on function public.admin_payment_links(uuid), public.admin_delete_payment(uuid, text) from public, anon;
grant execute on function public.admin_payment_links(uuid), public.admin_delete_payment(uuid, text) to authenticated;
