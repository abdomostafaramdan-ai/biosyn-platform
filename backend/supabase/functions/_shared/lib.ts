// Shared helpers. Pure functions are unit-tested in tests/lib.test.mjs.

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export type Gateway = 'stripe' | 'paymob' | 'fawaterk';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(algo: 'SHA-256' | 'SHA-512', secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: algo }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export async function sha256Hex(data: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The customer pays the gateway fee on top, so the platform nets exactly `amount`:
// total = (amount + fixed) / (1 - pct/100). Fee rates come from env (FEE_<GW>_PCT, FEE_<GW>_FIXED).
export function grossUp(amount: number, pct: number, fixed: number) {
  if (pct < 0 || pct >= 100) throw new Error('bad fee pct');
  const total = Math.ceil(((amount + fixed) / (1 - pct / 100)) * 100) / 100;
  return { total, fee: Math.round((total - amount) * 100) / 100 };
}

// ---- Stripe ----
export async function verifyStripe(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t'];
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || sigs.length === 0 || Math.abs(nowSec - Number(t)) > 300) return false;
  const expected = await hmacHex('SHA-256', secret, `${t}.${rawBody}`);
  return sigs.some((s) => safeEqual(s, expected));
}

// ---- Paymob ----
const PAYMOB_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id',
  'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];
export function paymobConcat(obj: Record<string, any>) {
  const get = (path: string) => path.split('.').reduce((o: any, k) => (o == null ? o : o[k]), obj);
  return PAYMOB_FIELDS.map((f) => String(get(f) ?? '')).join('');
}
export async function verifyPaymob(obj: Record<string, any>, hmac: string | null, secret: string) {
  if (!hmac) return false;
  return safeEqual((await hmacHex('SHA-512', secret, paymobConcat(obj))).toLowerCase(), hmac.toLowerCase());
}

// ---- Fawaterk ----
export async function verifyFawaterk(body: Record<string, any>, secret: string) {
  const data = `InvoiceId=${body.invoice_id}&InvoiceKey=${body.invoice_key}&PaymentMethod=${body.payment_method}`;
  return !!body.hashKey && safeEqual((await hmacHex('SHA-256', secret, data)).toLowerCase(), String(body.hashKey).toLowerCase());
}

// ---- Bunny Stream signed embed URL (token auth: SHA256(key + videoId + expires)) ----
export async function bunnyEmbedUrl(libraryId: string, videoId: string, tokenKey: string, ttlSec = 4 * 3600, nowSec = Math.floor(Date.now() / 1000)) {
  const expires = nowSec + ttlSec;
  const token = await sha256Hex(tokenKey + videoId + expires);
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}`;
}
