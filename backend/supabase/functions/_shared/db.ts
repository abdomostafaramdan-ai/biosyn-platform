import { sendPending } from './mail.ts';
import { sendMetaPurchase } from './track.ts';
import { crmFlush } from './crm.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

// client acting as the signed-in caller (uses their JWT)
export const asUser = (req: Request) =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });

export async function currentUser(req: Request) {
  const { data, error } = await asUser(req).auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// Common webhook flow: store the event once, then apply it. Returns false if already processed.
export async function recordEvent(sb: ReturnType<typeof admin>, gateway: string, eventId: string, payload: unknown) {
  const { error } = await sb.from('webhook_events').insert({ gateway, event_id: eventId, payload });
  if (error?.code === '23505') {
    const { data } = await sb.from('webhook_events').select('processed_at').eq('gateway', gateway).eq('event_id', eventId).single();
    return !data?.processed_at; // duplicate delivery: retry only if it never finished
  }
  if (error) throw error;
  return true;
}
export const markProcessed = (sb: ReturnType<typeof admin>, gateway: string, eventId: string) =>
  sb.from('webhook_events').update({ processed_at: new Date().toISOString() }).eq('gateway', gateway).eq('event_id', eventId);

// Confirms the amount the gateway says it collected matches what we asked for, then grants access.
export async function settle(sb: ReturnType<typeof admin>, paymentId: string, paidCents: number | null, gatewayRef: string | null) {
  const { data: p, error } = await sb.from('payments').select('id,status,amount_egp,fee_egp').eq('id', paymentId).single();
  if (error || !p) return { ok: false, reason: 'payment not found' };
  if (p.status === 'paid') return { ok: true, reason: 'already paid' };
  const expected = Math.round((Number(p.amount_egp) + Number(p.fee_egp)) * 100);
  if (paidCents !== null && paidCents !== expected) return { ok: false, reason: `amount mismatch: got ${paidCents}, expected ${expected}` };
  const { error: e2 } = await sb.rpc('fulfil_payment', { p_payment: paymentId, p_gateway_ref: gatewayRef });
  if (e2) return { ok: false, reason: e2.message };
  await afterPaid(sb, paymentId);
  return { ok: true, reason: 'fulfilled' };
}

// best-effort side effects after a payment is fulfilled: confirmation emails + Meta CAPI. Never throws.
export async function afterPaid(sb: ReturnType<typeof admin>, paymentId?: string) {
  try { await sendPending(sb); } catch (e) { console.error('mail flush failed', e); }
  if (paymentId) { try { await sendMetaPurchase(sb, paymentId); } catch (e) { console.error('capi failed', e); } }
  try { await crmFlush(sb); } catch (e) { console.error('crm flush failed', e); }
}
