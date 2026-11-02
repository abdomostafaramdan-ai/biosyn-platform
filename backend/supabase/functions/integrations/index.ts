import { admin, asUser, currentUser } from './_shared/db.ts';
import { cors, json } from './_shared/lib.ts';
import { loadSecrets, secSource } from './_shared/secrets.ts';

const KEYS = ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS', 'FEE_PAYMOB_PCT', 'FEE_PAYMOB_FIXED',
  'FAWATERK_API_KEY', 'FAWATERK_BASE_URL', 'FEE_FAWATERK_PCT', 'FEE_FAWATERK_FIXED',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'FEE_STRIPE_PCT', 'FEE_STRIPE_FIXED',
  'BUNNY_LIBRARY_ID', 'BUNNY_TOKEN_KEY', 'BUNNY_API_KEY', 'BUNNY_ACCOUNT_KEY', 'RESEND_API_KEY', 'MAIL_FROM', 'META_PIXEL_ID', 'META_CAPI_TOKEN', 'GA4_ID',
  'ANTHROPIC_API_KEY', 'CRM_URL', 'CRM_WOO_SECRET', 'SITE_URL'];

// Admin only: which integration keys are configured (never their values) + CRM queue health.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: isAdmin } = await asUser(req).rpc('is_admin');
  if (!isAdmin) return json({ error: 'admin only' }, 403);
  const sb = admin();
  await loadSecrets(sb);
  const status = Object.fromEntries(KEYS.map((k) => [k, secSource(k)]));
  const { data: q } = await sb.from('crm_outbox').select('status');
  const crm = { pending: 0, sent: 0, failed: 0, sending: 0 } as Record<string, number>;
  for (const r of q ?? []) crm[r.status] = (crm[r.status] ?? 0) + 1;
  const { data: last } = await sb.from('crm_outbox').select('sent_at,last_error,status').order('created_at', { ascending: false }).limit(1);
  return json({ status, crm, crm_last: last?.[0] ?? null, functions_base: `${Deno.env.get('SUPABASE_URL')}/functions/v1` });
});
