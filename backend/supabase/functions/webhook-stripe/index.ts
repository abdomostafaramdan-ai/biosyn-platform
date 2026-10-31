import { admin, markProcessed, recordEvent, settle } from './_shared/db.ts';
import { verifyStripe } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

Deno.serve(async (req) => {
  const raw = await req.text();
  await loadSecrets(admin());
  const secret = sec('STRIPE_WEBHOOK_SECRET');
  if (!secret || !(await verifyStripe(raw, req.headers.get('stripe-signature'), secret))) {
    return new Response('bad signature', { status: 400 });
  }
  const ev = JSON.parse(raw);
  const sb = admin();
  if (!(await recordEvent(sb, 'stripe', ev.id, ev))) return new Response('duplicate', { status: 200 });

  const o = ev.data?.object;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type) && o?.payment_status === 'paid') {
    const r = await settle(sb, o.metadata?.payment_id, o.amount_total ?? null, o.id);
    if (!r.ok) { console.error('stripe settle failed', r.reason); return new Response(r.reason, { status: 500 }); }
  }
  await markProcessed(sb, 'stripe', ev.id);
  return new Response('ok');
});
