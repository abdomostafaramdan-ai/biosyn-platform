// Admin-only: copy an image from the old WordPress site into our own storage (site-media bucket)
// so the platform never depends on old-site links. Body: { url, path } → { url } (public URL).
// Only https://new.biosynegypt.com/wp-content/uploads/… images are accepted.
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://biosyneg.com,https://www.biosyneg.com').split(',').map((s) => s.trim()).filter(Boolean);
// Access-Control-Allow-Origin is added per response, only for an allow-listed Origin (no credentials; the app uses the Authorization header)
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const URL_ = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') || '';
  const ok = await fetch(`${URL_}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => false);
  if (ok !== true) return json({ error: 'not allowed' }, 403);
  const { url, path } = await req.json().catch(() => ({}));
  if (!/^https:\/\/new\.biosynegypt\.com\/wp-content\/uploads\/[\w./%-]+\.(png|jpe?g|webp)$/i.test(String(url || ''))) return json({ error: 'bad url' }, 400);
  if (!/^[a-z0-9][\w/.-]{2,120}\.(png|jpe?g|webp)$/i.test(String(path || '')) || String(path).includes('..')) return json({ error: 'bad path' }, 400);
  const img = await fetch(url);
  if (!img.ok) return json({ error: 'fetch failed ' + img.status }, 502);
  const type = img.headers.get('content-type') || 'image/png';
  if (!/^image\//.test(type)) return json({ error: 'not an image' }, 400);
  const buf = await img.arrayBuffer();
  if (buf.byteLength > 5 * 1024 * 1024) return json({ error: 'too large' }, 413);
  const up = await fetch(`${URL_}/storage/v1/object/site-media/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${SRV}`, apikey: SRV, 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': '3600' }, body: buf });
  if (!up.ok) return json({ error: 'upload failed ' + up.status + ' ' + (await up.text()).slice(0, 200) }, 500);
  return json({ url: `${URL_}/storage/v1/object/public/site-media/${path}`, bytes: buf.byteLength });
};

Deno.serve(async (req) => {
  const res = await handle(req), o = req.headers.get('origin');
  if (o && ALLOWED.includes(o)) res.headers.set('Access-Control-Allow-Origin', o);
  return res;
});
