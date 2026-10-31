import { admin } from './_shared/db.ts';
import { crmFlush } from './_shared/crm.ts';

// Called every 5 minutes by pg_cron (only when the CRM queue is not empty), and from the admin panel. No input is read.
Deno.serve(async () => {
  const r = await crmFlush(admin(), 30);
  return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
});
