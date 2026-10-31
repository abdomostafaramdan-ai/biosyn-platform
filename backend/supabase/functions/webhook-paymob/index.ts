import { admin, markProcessed, recordEvent, settle } from './_shared/db.ts';
import { verifyPaymob } from './_shared/lib.ts';

Deno.serve(async (req) => {
  const body = await req.json().catch(() => null);
  const obj = body?.obj;
  const hmac = new URL(req.url).searchParams.get('hmac');
  const secret = Deno.env.get('PAYMOB_HMAC_SECRET') ?? '';
  if (!obj || !secret || !(await verifyPaymob(obj, hmac, secret))) return new Response('bad signature', { status: 400 });

  const sb = admin();
  const eventId = `${obj.id}`;
  if (!(await recordEvent(sb, 'paymob', eventId, body))) return new Response('duplicate', { status: 200 });

  const success = obj.success === true && obj.pending === false && !obj.is_voided && !obj.is_refunded && !obj.error_occured;
  const paymentId = obj.order?.merchant_order_id;
  if (success && paymentId) {
    const r = await settle(sb, String(paymentId), Number(obj.amount_cents), String(obj.id)); // gateway_ref = transaction id (used for refunds)
    if (!r.ok) { console.error('paymob settle failed', r.reason); return new Response(r.reason, { status: 500 }); }
  } else if (!success && paymentId && !obj.pending && !obj.is_refunded) {
    await sb.rpc('fail_payment', { p_payment: String(paymentId) });
  }
  await markProcessed(sb, 'paymob', eventId);
  return new Response('ok');
});
