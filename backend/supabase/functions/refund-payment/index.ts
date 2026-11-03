import { admin, asUser, currentUser } from './_shared/db.ts';
import { cors, json, type Gateway } from './_shared/lib.ts';
import { refundAtGateway } from './_shared/gateways.ts';
import { loadSecrets } from './_shared/secrets.ts';

// Admin only. POST { payment_id, manual_confirmed? }
// Interactive courses only, within 7 days of payment. Subscriptions are never refundable.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: isAdmin } = await asUser(req).rpc('is_admin');
  if (!isAdmin) return json({ error: 'admin only' }, 403);

  const { payment_id, manual_confirmed } = await req.json().catch(() => ({}));
  const sb = admin();
  await loadSecrets(sb);
  const check = await sb.rpc('refund_payment', { p_payment: payment_id, p_dry: true });
  if (check.error) return json({ error: check.error.message }, 400);
  const p = check.data;

  try {
    const free = String(p.gateway_ref ?? '').startsWith('free:'); // 100% coupon: nothing was charged
    const done = free ? true : p.gateway_ref ? await refundAtGateway(p.gateway as Gateway, p.gateway_ref, p.currency && p.currency !== 'EGP' ? Number(p.amount_local) + Number(p.fee_local) : Number(p.amount_egp) + Number(p.fee_egp)) : false;
    if (!done && !manual_confirmed) {
      return json({ manual: true, message: 'Refund this payment from the gateway dashboard, then call again with manual_confirmed=true.' }, 202);
    }
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
  const { error } = await sb.rpc('refund_payment', { p_payment: payment_id, p_dry: false });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
