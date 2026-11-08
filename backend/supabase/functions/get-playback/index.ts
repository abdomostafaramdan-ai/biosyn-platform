// POST { lecture_id, device_id, device_label } -> { url }  (Bunny embed URL; signed, valid 4 hours, when the library's token key is saved)
// Self-contained (no _shared imports) so it can be redeployed on its own.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function embedUrl(lib: string, vid: string, key: string, ttl = 4 * 3600) {
  const expires = Math.floor(Date.now() / 1000) + ttl;
  return `https://iframe.mediadelivery.net/embed/${lib}/${vid}?token=${await sha256Hex(key + vid + expires)}&expires=${expires}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: au } = await asUser.auth.getUser();
  const user = au?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { lecture_id, device_id, device_label } = await req.json().catch(() => ({}));
  if (!lecture_id || !/^[0-9a-f-]{36}$/i.test(String(lecture_id))) return json({ error: 'lecture_id required' }, 400);

  const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: l } = await sb.from('lectures').select('id,course_id').eq('id', lecture_id).single();
  if (!l) return json({ error: 'not found' }, 404);

  // subscribers/enrolled students, or a free preview lecture for any signed-in user
  const { data: allowed } = await sb.rpc('can_watch_lecture', { uid: user.id, lid: lecture_id });
  if (!allowed) return json({ error: 'subscription required' }, 403);
  // lectures open in order: the previous one must be watched to 50% first
  const { data: unlocked } = await sb.rpc('lecture_unlocked', { uid: user.id, lid: lecture_id });
  if (unlocked === false) return json({ error: 'lecture locked' }, 403);
  // account-sharing protection: max 2 devices per student account
  const { data: devOk } = await sb.rpc('claim_device', { p_user: user.id, p_device: String(device_id ?? ''), p_label: String(device_label ?? '').slice(0, 80) });
  if (!devOk) return json({ error: 'device limit' }, 403);

  const { data: v } = await sb.from('lecture_videos').select('bunny_video_id,bunny_library_id').eq('lecture_id', lecture_id).single();
  const { data: rows } = await sb.from('integration_secrets').select('key,value').in('key', ['BUNNY_LIBRARY_ID', 'BUNNY_TOKEN_KEY', 'BUNNY_TOKEN_KEYS']);
  const sec = (k: string) => Deno.env.get(k) || (rows ?? []).find((r: any) => r.key === k)?.value || '';
  const def = String(sec('BUNNY_LIBRARY_ID'));
  const lib = String((v && v.bunny_library_id) || def || '');
  if (!v || !lib) return json({ error: 'video not available yet' }, 404);
  // every library is signed with its own embed token key (BUNNY_TOKEN_KEYS: "libraryId=key" pairs separated by commas or
  // new lines; the default library may use BUNNY_TOKEN_KEY). Turn on "Embed view token authentication" in each Bunny
  // library once its key is saved, so an embed link copied out of the page stops working after 4 hours.
  const keys = new Map(String(sec('BUNNY_TOKEN_KEYS')).split(/[\n,;]+/).map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2 && x[0] && x[1]) as [string, string][]);
  const key = keys.get(lib) || (lib === def ? sec('BUNNY_TOKEN_KEY') : '');
  return json({ url: key ? await embedUrl(lib, v.bunny_video_id, key) : `https://iframe.mediadelivery.net/embed/${lib}/${v.bunny_video_id}` });
});
