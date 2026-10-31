import { admin, markProcessed, recordEvent, settle } from './_shared/db.ts';
import { verifyFawaterk } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

Deno.serve(async (req) => {
  const body = await req.json().catch(() => null);
  await loadSecrets(admin());
  const secret = sec('FAWATERK_API_KEY');
  if (!body || !secret || !(await verifyFawaterk(body, secret))) return new Response('bad signature', { status: 400 });

  const sb = admin();
  const eventId = `${body.invoice_id}:${body.invoice_status}`;
  if (!(await recordEvent(sb, 'fawaterk', eventId, body))) return new Response('duplicate', { status: 200 });

  let payload: any = body.pay_load ?? body.payLoad ?? {};
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  let paymentId: string | undefined = payload.payment_id;
  if (!paymentId) {
    const { data } = await sb.from('payments').select('id').eq('gateway', 'fawaterk').eq('gateway_ref', String(body.invoice_id)).maybeSingle();
    paymentId = data?.id;
  }
  if (String(body.invoice_status).toLowerCase() === 'paid' && paymentId) {
    const paid = Number(body.total ?? body.paid_amount ?? NaN);
    const r = await settle(sb, paymentId, Number.isFinite(paid) ? Math.round(paid * 100) : null, String(body.invoice_id));
    if (!r.ok) { console.error('fawaterk settle failed', r.reason); return new Response(r.reason, { status: 500 }); }
  }
  await markProcessed(sb, 'fawaterk', eventId);
  return new Response('ok');
});
