import type { admin as AdminFn } from './db.ts';

type Sb = ReturnType<typeof AdminFn>;

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.trim().toLowerCase())))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Meta Conversions API "Purchase" (server side). event_id = payment id, so it de-duplicates with the browser pixel event.
// Optional: does nothing unless META_PIXEL_ID and META_CAPI_TOKEN are set.
export async function sendMetaPurchase(sb: Sb, paymentId: string) {
  const pixel = Deno.env.get('META_PIXEL_ID'), token = Deno.env.get('META_CAPI_TOKEN');
  if (!pixel || !token) return;
  const { data: p } = await sb.from('payments').select('id,user_id,amount_egp,fee_egp,paid_at,status').eq('id', paymentId).single();
  if (!p || p.status !== 'paid') return;
  const { data: u } = await sb.auth.admin.getUserById(p.user_id);
  const email = u?.user?.email;
  const body = {
    data: [{
      event_name: 'Purchase', event_time: Math.floor(new Date(p.paid_at ?? Date.now()).getTime() / 1000), event_id: p.id,
      action_source: 'website', event_source_url: Deno.env.get('SITE_URL') ?? undefined,
      user_data: email ? { em: [await sha256(email)] } : {},
      custom_data: { currency: 'EGP', value: Number(p.amount_egp) + Number(p.fee_egp) },
    }],
  };
  const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error('meta capi failed', r.status, (await r.text()).slice(0, 200));
}
