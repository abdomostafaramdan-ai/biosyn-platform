import { admin, markProcessed, recordEvent, settle } from './_shared/db.ts';
import { cors, json, verifyFawaterk } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

// Fawaterk payments are never trusted from the request body. A webhook, the customer's return to the site
// ({ verify: payment_id }) or the 5-minute sweep ({ sweep: true }) only says "go check"; the invoice is then
// read from Fawaterk's API with our API key and settled only when Fawaterk itself says it is paid in full.

type Sb = ReturnType<typeof admin>;

async function confirm(sb: Sb, paymentId: string) {
  const { data: p } = await sb.from('payments').select('id,status,gateway,gateway_ref,currency,amount_egp,fee_egp,amount_local,fee_local')
    .eq('id', paymentId).maybeSingle();
  if (!p || p.gateway !== 'fawaterk') return { ok: false, reason: 'not found' };
  if (p.status === 'paid') return { ok: true, reason: 'already paid', status: 'paid' };
  if (p.status !== 'pending' || !p.gateway_ref) return { ok: false, reason: 'not pending', status: p.status };

  const base = sec('FAWATERK_BASE_URL') || 'https://app.fawaterk.com';
  const r = await fetch(`${base}/api/v2/getInvoiceData/${encodeURIComponent(p.gateway_ref)}`, {
    headers: { Authorization: `Bearer ${sec('FAWATERK_API_KEY')}`, 'Content-Type': 'application/json' },
  });
  const d = await r.json().catch(() => null);
  const inv = d && d.status === 'success' ? d.data : null;
  if (!inv) return { ok: false, reason: 'fawaterk lookup failed', status: 'pending' };
  if (!(Number(inv.paid) === 1 || String(inv.paid).toLowerCase() === 'true')) return { ok: true, reason: 'not paid yet', status: 'pending' };

  const local = p.currency && p.currency !== 'EGP';
  const expected = local ? Number(p.amount_local) + Number(p.fee_local) : Number(p.amount_egp) + Number(p.fee_egp);
  // Fawaterk may add its own commission on top when the vendor passes fees to the customer: never accept less
  if (Number(inv.total) + 0.01 < expected) return { ok: false, reason: `amount too low: ${inv.total} < ${expected}`, status: 'pending' };
  const s = await settle(sb, p.id, null, String(inv.id ?? inv.invoice_id ?? p.gateway_ref), 2, 'fawaterk');
  return { ...s, status: s.ok ? 'paid' : 'pending' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => null);
  const sb = admin();
  await loadSecrets(sb);
  if (!sec('FAWATERK_API_KEY')) return json({ error: 'fawaterk not configured' }, 503);

  // customer came back from the payment page
  if (body && typeof body.verify === 'string') {
    if (!/^[0-9a-f-]{36}$/i.test(body.verify)) return json({ error: 'bad id' }, 400);
    const r = await confirm(sb, body.verify);
    return json({ status: r.status ?? 'unknown' });
  }

  // scheduled sweep: pending Fawaterk payments from the last 3 days
  if (body && body.sweep === true) {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const { data } = await sb.from('payments').select('id').eq('gateway', 'fawaterk').eq('status', 'pending')
      .not('gateway_ref', 'is', null).gte('created_at', since).limit(50);
    let paid = 0;
    for (const row of data ?? []) { const r = await confirm(sb, row.id); if (r.status === 'paid' && r.reason === 'fulfilled') paid++; }
    return json({ checked: (data ?? []).length, paid });
  }

  // Fawaterk webhook
  if (!body || !body.invoice_id) return new Response('bad request', { status: 400 });
  const vendor = sec('FAWATERK_VENDOR_KEY');
  const signed = vendor ? await verifyFawaterk(body, vendor) : false;
  if (!signed) console.warn('fawaterk webhook without a valid signature; confirming via API', body.invoice_id);

  const eventId = `${body.invoice_id}:${body.invoice_status ?? ''}`;
  if (!(await recordEvent(sb, 'fawaterk', eventId, body))) return new Response('duplicate', { status: 200 });

  // only invoices we created, matched by our gateway_ref. Fawaterk reuses an open invoice when the same customer
  // retries the same amount (its pay_load then still names the first attempt), so take the newest pending match.
  const { data: rows } = await sb.from('payments').select('id,status').eq('gateway', 'fawaterk').eq('gateway_ref', String(body.invoice_id))
    .order('created_at', { ascending: false }).limit(5);
  const p = (rows ?? []).find((x: any) => x.status === 'pending') ?? (rows ?? [])[0];
  if (!p) { await markProcessed(sb, 'fawaterk', eventId); return new Response('ignored'); }

  const r = await confirm(sb, p.id);
  if (!r.ok) { console.error('fawaterk confirm failed', r.reason); return new Response(r.reason, { status: 500 }); }
  await markProcessed(sb, 'fawaterk', eventId);
  return new Response('ok');
});
