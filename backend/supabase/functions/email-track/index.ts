// GET ?t=<token>&o=1        -> records an open, returns a 1x1 transparent GIF
// GET ?t=<token>&l=cta|teach -> records a click, redirects to the destination the server stores for that token
// Links never carry a URL, so this can't be used as an open redirect. Public (no JWT): it's loaded from e-mail clients.
// Self-contained (no _shared imports) so it can be redeployed on its own.
const SB = Deno.env.get('SUPABASE_URL')!, KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE = 'https://biosyneg.com';
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, max-age=0', 'Referrer-Policy': 'no-referrer' };

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  const token = q.get('t') || '', link = q.get('l');
  const isClick = link !== null, linkKey = link === 'teach' ? 'teach' : 'cta';
  let dest = SITE;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    try {
      const r = await fetch(`${SB}/rest/v1/rpc/log_email_event`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: token, p_link: isClick ? linkKey : null, p_ua: (req.headers.get('user-agent') || '').slice(0, 200) }),
      });
      if (r.ok) { const v = await r.json(); if (typeof v === 'string' && /^https:\/\//.test(v)) dest = v; }
    } catch (e) { console.error('email-track', String(e)); }
  }
  if (isClick) return new Response(null, { status: 302, headers: { ...NO_CACHE, Location: dest } });
  return new Response(GIF, { headers: { ...NO_CACHE, 'Content-Type': 'image/gif' } });
});
