import type { admin as AdminFn } from './db.ts';
import { loadSecrets, sec } from './secrets.ts';

type Sb = ReturnType<typeof AdminFn>;

// Plain-text twin of the HTML body: mail filters score HTML-only messages worse.
export function htmlToText(html: string) {
  return html
    .replace(/<(style|title|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const t = label.replace(/<[^>]+>/g, '').trim();
      if (!t) return '';
      return href.startsWith('mailto:') || href.includes(t) ? t : `${t}: ${href}`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|tr|div|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Sends queued rows from email_outbox through Resend. Safe to call from anywhere (webhooks, cron).
// Without RESEND_API_KEY nothing is claimed, so rows simply wait in the queue.
export async function sendPending(sb: Sb, max = 20): Promise<{ sent: number; failed: number; skipped?: string }> {
  await loadSecrets(sb);
  const key = sec('RESEND_API_KEY'), from = sec('MAIL_FROM');
  if (!key || !from) return { sent: 0, failed: 0, skipped: 'RESEND_API_KEY / MAIL_FROM not set' };
  const replyTo = sec('MAIL_REPLY_TO') || 'contact@biosynegypt.com';
  const { data: rows, error } = await sb.rpc('claim_emails', { p_n: max });
  if (error || !rows) return { sent: 0, failed: 0, skipped: error?.message };
  let sent = 0, failed = 0;
  for (const r of rows as Array<{ id: string; to_email: string; subject: string; body_html: string; attempts: number }>) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': r.id },
        body: JSON.stringify({
          from, to: [r.to_email], subject: r.subject, html: r.body_html, text: htmlToText(r.body_html),
          reply_to: replyTo,
          headers: { 'List-Unsubscribe': `<mailto:${replyTo}?subject=unsubscribe>`, 'X-Entity-Ref-ID': r.id },
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await sb.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', r.id);
      sent++;
    } catch (e) {
      failed++;
      await sb.from('email_outbox').update({ status: r.attempts >= 5 ? 'failed' : 'pending', last_error: String(e).slice(0, 500) }).eq('id', r.id);
    }
  }
  return { sent, failed };
}
