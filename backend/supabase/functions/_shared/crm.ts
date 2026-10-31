import type { admin as AdminFn } from './db.ts';
import { loadSecrets, sec } from './secrets.ts';

type Sb = ReturnType<typeof AdminFn>;
type Row = { id: string; kind: 'order' | 'lead'; payload: Record<string, unknown>; attempts: number };

async function wooSignature(secret: string, raw: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)));
  return btoa(String.fromCharCode(...sig));
}

// Sends queued payments/requests to the Biosyn CRM (orders -> woo-webhook, form requests -> lead-capture).
export async function crmFlush(sb: Sb, max = 20) {
  await loadSecrets(sb);
  const base = sec('CRM_URL').replace(/\/$/, ''), woo = sec('CRM_WOO_SECRET');
  if (!base || !woo) return { sent: 0, failed: 0, skipped: 'CRM not connected' };
  const { data: rows, error } = await sb.rpc('claim_crm', { p_n: max });
  if (error || !rows) return { sent: 0, failed: 0, skipped: error?.message };
  let sent = 0, failed = 0;
  for (const r of rows as Row[]) {
    try {
      const raw = JSON.stringify(r.payload);
      const res = r.kind === 'order'
        ? await fetch(`${base}/functions/v1/woo-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wc-webhook-signature': await wooSignature(woo, raw) }, body: raw })
        : await fetch(`${base}/functions/v1/lead-capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
      const txt = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${txt.slice(0, 300)}`);
      await sb.from('crm_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', r.id);
      sent++;
    } catch (e) {
      failed++;
      await sb.from('crm_outbox').update({ status: r.attempts >= 8 ? 'failed' : 'pending', last_error: String(e).slice(0, 500) }).eq('id', r.id);
    }
  }
  return { sent, failed };
}
