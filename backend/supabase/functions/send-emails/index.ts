import { admin } from './_shared/db.ts';
import { sendPending } from './_shared/mail.ts';

// Called every 5 minutes by pg_cron (only when the queue is not empty). No input is read.
Deno.serve(async () => {
  const r = await sendPending(admin(), 30);
  return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
});
