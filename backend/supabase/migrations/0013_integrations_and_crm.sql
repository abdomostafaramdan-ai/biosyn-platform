-- Integrations hub (keys entered from the admin panel) + CRM sync outbox.

-- ======================= integration secrets =======================
-- Values are write-only from the admin panel: no policy lets any user read them; Edge Functions read them with the service role.
create table if not exists integration_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table integration_secrets enable row level security;

create or replace function integration_keys() returns text[] language sql immutable as $$
  select array[
    'PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','FEE_PAYMOB_PCT','FEE_PAYMOB_FIXED',
    'FAWATERK_API_KEY','FAWATERK_BASE_URL','FEE_FAWATERK_PCT','FEE_FAWATERK_FIXED',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FEE_STRIPE_PCT','FEE_STRIPE_FIXED',
    'BUNNY_LIBRARY_ID','BUNNY_TOKEN_KEY',
    'RESEND_API_KEY','MAIL_FROM',
    'META_PIXEL_ID','META_CAPI_TOKEN','GA4_ID',
    'ANTHROPIC_API_KEY',
    'CRM_URL','CRM_WOO_SECRET'
  ]::text[];
$$;

create or replace function set_integration_secret(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if not (p_key = any(integration_keys())) then raise exception 'unknown key'; end if;
  if nullif(btrim(coalesce(p_value,'')),'') is null then
    delete from integration_secrets where key = p_key;
  else
    insert into integration_secrets (key, value, updated_at) values (p_key, btrim(p_value), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
revoke execute on function set_integration_secret(text, text) from public, anon;
grant execute on function set_integration_secret(text, text) to authenticated;

-- which keys are saved (never the values). Edge Function `integrations` adds keys set as Supabase secrets.
create or replace function integration_saved() returns json
language sql stable security definer set search_path = public as $$
  select case when is_admin() then coalesce(json_object_agg(key, updated_at), '{}'::json) else null end from integration_secrets;
$$;
revoke execute on function integration_saved() from public, anon;
grant execute on function integration_saved() to authenticated;

-- public, non-secret settings the website needs
create or replace function public_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'instapay', (select nullif(value,'') from app_settings where key = 'instapay_handle'),
    'vodafone_cash', (select nullif(value,'') from app_settings where key = 'vodafone_cash_number'),
    'gateways', (select coalesce(json_agg(g), '[]'::json) from (values ('paymob','PAYMOB_SECRET_KEY'), ('fawaterk','FAWATERK_API_KEY'), ('stripe','STRIPE_SECRET_KEY')) v(g, k)
                  where exists (select 1 from integration_secrets s where s.key = v.k)),
    'support_chat', exists (select 1 from integration_secrets where key = 'ANTHROPIC_API_KEY'),
    'meta_pixel', (select value from integration_secrets where key = 'META_PIXEL_ID'),
    'ga4', (select value from integration_secrets where key = 'GA4_ID'));
$$;
revoke execute on function public_settings() from public;
grant execute on function public_settings() to anon, authenticated;

-- ======================= CRM sync =======================
create table if not exists crm_outbox (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  kind        text not null check (kind in ('order','lead')),
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table crm_outbox enable row level security;
create policy crm_outbox_staff_read on crm_outbox for select to authenticated using (is_staff());

-- payment paid / refunded -> WooCommerce-shaped order (the CRM already ingests this format)
create or replace function trg_crm_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text; v_phone text; v_item text; v_method text; v_cpn text; v_status text;
begin
  if new.status = old.status or new.status not in ('paid','refunded') then return new; end if;
  select email into v_email from auth.users where id = new.user_id;
  select full_name, coalesce(phone, whatsapp) into v_name, v_phone from profiles where id = new.user_id;
  select coalesce((select name from plans where id = new.plan_id), (select title from courses where id = new.course_id), 'Biosyn') into v_item;
  select code into v_cpn from coupons where id = new.coupon_id;
  v_method := case new.gateway::text when 'manual' then case new.manual_method when 'instapay' then 'InstaPay' else 'Vodafone Cash' end
                                     else new.gateway::text end;
  v_status := case new.status when 'paid' then 'completed' else 'refunded' end;
  insert into crm_outbox (dedupe_key, kind, payload) values (
    'pay:' || new.id || ':' || new.status, 'order',
    jsonb_build_object(
      'id', 'bp-' || new.id,
      'status', v_status,
      'total', (coalesce(new.amount_egp,0) + coalesce(new.fee_egp,0))::text,
      'date_created', to_char(coalesce(new.paid_at, now()) at time zone 'Africa/Cairo', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'payment_method_title', v_method,
      'billing', jsonb_build_object('first_name', coalesce(v_name,''), 'last_name', '', 'email', coalesce(v_email,''), 'phone', coalesce(v_phone,'')),
      'line_items', jsonb_build_array(jsonb_build_object('name', v_item, 'quantity', 1)),
      'coupon_lines', case when v_cpn is not null then jsonb_build_array(jsonb_build_object('code', v_cpn)) else '[]'::jsonb end))
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
drop trigger if exists crm_payment on payments;
create trigger crm_payment after update of status on payments for each row execute function trg_crm_payment();

-- website forms (institution / consultation / instructor) -> CRM lead
create or replace function trg_crm_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type::text = 'refund' then return new; end if;
  insert into crm_outbox (dedupe_key, kind, payload) values ('req:' || new.id, 'lead',
    jsonb_build_object('name', left(coalesce(new.name,''), 80), 'email', coalesce(new.email,''), 'phone', coalesce(new.phone,''),
      'course', case new.type::text when 'institution' then 'طلب مؤسسي' when 'consultation' then 'طلب استشارة'
                                    when 'instructor_recorded' then 'تقديم محاضر (كورس مسجل)' when 'instructor_interactive' then 'تقديم محاضر (كورس تفاعلي)' else new.type::text end,
      'message', left(coalesce((select string_agg(k || ': ' || v, ' | ') from jsonb_each_text(coalesce(new.payload,'{}'::jsonb)) as t(k, v)), ''), 480),
      'src', 'الموقع'))
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
drop trigger if exists crm_request on requests;
create trigger crm_request after insert on requests for each row execute function trg_crm_request();

create or replace function claim_crm(p_n int default 20) returns setof crm_outbox
language plpgsql security definer set search_path = public as $$
begin
  update crm_outbox set status = 'pending' where status = 'sending' and created_at < now() - interval '15 minutes' and sent_at is null;
  return query
    update crm_outbox c set status = 'sending', attempts = c.attempts + 1
     where c.id in (select id from crm_outbox where status = 'pending' and attempts < 8 order by created_at limit p_n for update skip locked)
    returning c.*;
end $$;

revoke execute on function trg_crm_payment(), trg_crm_request(), claim_crm(int), integration_keys() from public, anon, authenticated;
grant execute on function claim_crm(int) to service_role;

select cron.schedule('crm-sync', '*/5 * * * *', $$
  select net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/crm-sync',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)
   where exists (select 1 from public.crm_outbox where status = 'pending' and attempts < 8)
$$);
alter function integration_keys() set search_path = public;
