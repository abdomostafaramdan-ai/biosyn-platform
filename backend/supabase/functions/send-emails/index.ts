import { admin } from './_shared/db.ts';
import { sendPending } from './_shared/mail.ts';

// Called every 5 minutes by pg_cron (only when the queue is not empty) and by the kick_mailer trigger (at most every 20 s).
// Up to 90 emails per run at ~4/s (Resend allows 10 requests/second). No input is read.
Deno.serve(async () => {
  const r = await sendPending(admin(), 90);
  return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
});
