import type { Gateway } from './lib.ts';
import { sec } from './secrets.ts';
import { fawaterkCode } from './geo.ts';

const env = (k: string) => sec(k);
const need = (k: string) => {
  const v = sec(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

export function feeRates(gw: Gateway) {
  const G = gw.toUpperCase();
  return { pct: Number(env(`FEE_${G}_PCT`) || 0), fixed: Number(env(`FEE_${G}_FIXED`) || 0) };
}
export function enabledGateways(): Gateway[] {
  const out: Gateway[] = [];
  if (env('STRIPE_SECRET_KEY')) out.push('stripe');
  if (env('PAYMOB_SECRET_KEY')) out.push('paymob');
  if (env('FAWATERK_API_KEY')) out.push('fawaterk');
  return out;
}

export interface CheckoutInput {
  paymentId: string;
  total: number;          // what the customer pays (price + gateway fee), in `currency`
  currency?: string;      // ISO code, default EGP
  decimals?: number;      // minor-unit digits of the currency (KWD/BHD/OMR/JOD = 3)
  title: string;
  customer: { name: string; email: string; phone: string };
  successUrl: string;
  cancelUrl: string;
  webhookBase: string;    // https://<ref>.supabase.co/functions/v1
}
export interface CheckoutResult { url: string; gatewayRef: string | null }

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const splitName = (n: string) => {
  const p = n.trim().split(/\s+/);
  return { first: p[0] || 'Student', last: p.slice(1).join(' ') || 'NA' };
};

export async function createCheckout(gw: Gateway, i: CheckoutInput): Promise<CheckoutResult> {
  const cur = (i.currency || 'EGP').toUpperCase(), dec = i.decimals ?? 2;
  if (gw === 'stripe') {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${need('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        mode: 'payment',
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        client_reference_id: i.paymentId,
        'metadata[payment_id]': i.paymentId,
        customer_email: i.customer.email,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': cur.toLowerCase(),
        // 3-decimal currencies must be a multiple of 10 minor units on Stripe; totals are already 2-decimal
        'line_items[0][price_data][unit_amount]': String(Math.round(i.total * 10 ** dec)),
        'line_items[0][price_data][product_data][name]': i.title,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`stripe: ${d?.error?.message ?? r.status}`);
    return { url: d.url, gatewayRef: d.id };
  }

  if (gw === 'paymob') {
    if (cur !== 'EGP') throw new Error('paymob: EGP only');
    const n = splitName(i.customer.name);
    const r = await fetch('https://accept.paymob.com/v1/intention/', {
      method: 'POST',
      headers: { Authorization: `Token ${need('PAYMOB_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(i.total * 100),
        currency: 'EGP',
        payment_methods: need('PAYMOB_INTEGRATION_IDS').split(',').map((x) => Number(x.trim())),
        items: [{ name: i.title.slice(0, 50), amount: Math.round(i.total * 100), description: i.title, quantity: 1 }],
        billing_data: { first_name: n.first, last_name: n.last, email: i.customer.email, phone_number: i.customer.phone || 'NA' },
        special_reference: i.paymentId,
        notification_url: `${i.webhookBase}/webhook-paymob`,
        redirection_url: i.successUrl,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.client_secret) throw new Error(`paymob: ${JSON.stringify(d).slice(0, 200)}`);
    const url = `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(need('PAYMOB_PUBLIC_KEY'))}&clientSecret=${encodeURIComponent(d.client_secret)}`;
    return { url, gatewayRef: null };
  }

  // fawaterk: hosted invoice page (customer picks card / wallet / Fawry there)
  const base = env('FAWATERK_BASE_URL') || 'https://app.fawaterk.com';
  const n = splitName(i.customer.name);
  const r = await fetch(`${base}/api/v2/createInvoiceLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('FAWATERK_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cartTotal: i.total.toFixed(2),
      currency: fawaterkCode(cur) || (() => { throw new Error('fawaterk: currency not supported ' + cur); })(),
      customer: { first_name: n.first, last_name: n.last, email: i.customer.email, phone: i.customer.phone || '01000000000' },
      redirectionUrls: { successUrl: i.successUrl, failUrl: i.cancelUrl, pendingUrl: i.successUrl },
      cartItems: [{ name: i.title, price: i.total.toFixed(2), quantity: '1' }],
      payLoad: { payment_id: i.paymentId },
    }),
  });
  const d = await r.json();
  if (!r.ok || d.status !== 'success') throw new Error(`fawaterk: ${JSON.stringify(d).slice(0, 200)}`);
  const inv = d.data.invoiceId ?? d.data.invoice_id;   // Fawaterk answers with camelCase invoiceId
  return { url: d.data.url, gatewayRef: inv ? String(inv) : null };
}

// Returns true when the refund was executed at the gateway, false when it must be done manually.
export async function refundAtGateway(gw: Gateway, gatewayRef: string, total: number): Promise<boolean> {
  if (gw === 'stripe') {
    const s = await fetch(`https://api.stripe.com/v1/checkout/sessions/${gatewayRef}`, {
      headers: { Authorization: `Bearer ${need('STRIPE_SECRET_KEY')}` },
    }).then((r) => r.json());
    if (!s.payment_intent) throw new Error('stripe: no payment_intent on session');
    const r = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${need('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ payment_intent: s.payment_intent }),
    });
    if (!r.ok) throw new Error(`stripe refund: ${(await r.json())?.error?.message}`);
    return true;
  }
  if (gw === 'paymob') {
    const r = await fetch('https://accept.paymob.com/api/acceptance/void_refund/refund', {
      method: 'POST',
      headers: { Authorization: `Token ${need('PAYMOB_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: gatewayRef, amount_cents: Math.round(total * 100) }),
    });
    if (!r.ok) throw new Error(`paymob refund: ${(await r.text()).slice(0, 200)}`);
    return true;
  }
  return false; // fawaterk: refund from the Fawaterk dashboard, then confirm in the admin panel
}
