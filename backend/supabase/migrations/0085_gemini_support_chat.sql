-- Support assistant moves from Anthropic to Google Gemini.
-- GEMINI_API_KEY can be saved from the admin integrations page; the help button appears once it is saved.

create or replace function public.integration_keys()
returns text[]
language sql immutable set search_path = public
as $function$
  select array[
    'PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','FEE_PAYMOB_PCT','FEE_PAYMOB_FIXED',
    'FAWATERK_API_KEY','FAWATERK_VENDOR_KEY','FAWATERK_BASE_URL','FEE_FAWATERK_PCT','FEE_FAWATERK_FIXED',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FEE_STRIPE_PCT','FEE_STRIPE_FIXED',
    'BUNNY_LIBRARY_ID','BUNNY_TOKEN_KEY','BUNNY_API_KEY','BUNNY_ACCOUNT_KEY','BUNNY_TOKEN_KEYS',
    'RESEND_API_KEY','MAIL_FROM',
    'META_PIXEL_ID','META_CAPI_TOKEN','GA4_ID',
    'GEMINI_API_KEY',
    'CRM_URL','CRM_WOO_SECRET'
  ]::text[];
$function$;

create or replace function public.public_settings()
returns json
language sql stable security definer set search_path = public
as $function$
  select json_build_object(
    'instapay', (select nullif(value,'') from app_settings where key = 'instapay_handle'),
    'vodafone_cash', (select nullif(value,'') from app_settings where key = 'vodafone_cash_number'),
    'paypal', (select nullif(value,'') from app_settings where key = 'paypal_me'),
    'consultation_price', (select nullif(value,'')::numeric from app_settings where key = 'consultation_price_egp'),
    'consultation_intl', (select nullif(value,'')::numeric from app_settings where key = 'consultation_intl_price'),
    'gateways', (select coalesce(json_agg(g), '[]'::json) from (values ('paymob','PAYMOB_SECRET_KEY'), ('fawaterk','FAWATERK_API_KEY'), ('stripe','STRIPE_SECRET_KEY')) v(g, k)
                  where exists (select 1 from integration_secrets s where s.key = v.k)),
    'support_chat', exists (select 1 from integration_secrets where key = 'GEMINI_API_KEY'),
    'meta_pixel', (select value from integration_secrets where key = 'META_PIXEL_ID'),
    'ga4', (select value from integration_secrets where key = 'GA4_ID'));
$function$;
