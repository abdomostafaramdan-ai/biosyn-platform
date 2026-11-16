import { admin } from './_shared/db.ts';
import { crmFlush } from './_shared/crm.ts';

// Called every 5 minutes by pg_cron (only when the CRM queue is not empty), and from the admin panel. No input is read.
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://biosyneg.com,https://www.biosyneg.com').split(',').map((s) => s.trim()).filter(Boolean);
Deno.serve(async (req) => {
  const o = req.headers.get('origin') ?? '';
  const cors = { ...(ALLOWED.includes(o) ? { 'Access-Control-Allow-Origin': o } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const r = await crmFlush(admin(), 30);
  return new Response(JSON.stringify(r), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
