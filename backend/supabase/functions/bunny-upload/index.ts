import { admin, asUser, currentUser } from './_shared/db.ts';
import { bunnyEmbedUrl, cors, json, sha256Hex } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

// Direct-to-Bunny video uploads (TUS). The browser never sees the Bunny API key:
// this function creates the video slot and returns a short-lived TUS signature.
//   { action: 'status' }                         -> { ready }
//   { action: 'create', lesson_id }              -> instructor uploading a lesson of their draft proposal
//   { action: 'create_admin', title }            -> admin uploading a lecture from the dashboard
//   { action: 'preview', lesson_id | video_id }  -> staff: signed player URL
const BUNNY = 'https://video.bunnycdn.com';

async function createVideo(lib: string, key: string, title: string) {
  const r = await fetch(`${BUNNY}/library/${lib}/videos`, { method: 'POST', headers: { AccessKey: key, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ title: title.slice(0, 200) }) });
  if (!r.ok) throw new Error('bunny create failed: ' + r.status);
  const d = await r.json();
  return String(d.guid);
}
async function tusAuth(lib: string, key: string, guid: string) {
  const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
  return { library_id: lib, video_id: guid, expire, signature: await sha256Hex(lib + key + expire + guid), endpoint: `${BUNNY}/tusupload` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = admin();
  await loadSecrets(sb);
  const lib = sec('BUNNY_LIBRARY_ID'), key = sec('BUNNY_API_KEY');
  if (body.action === 'status') return json({ ready: !!(lib && key) });

  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!lib || !key) return json({ error: 'uploads not configured' }, 503);

  try {
    if (body.action === 'create') {
      const { data: l } = await sb.from('proposal_lessons').select('id,title,proposal_id,course_proposals!inner(user_id,status,title)').eq('id', String(body.lesson_id ?? '')).single();
      const p = (l as any)?.course_proposals;
      if (!l || !p || p.user_id !== user.id) return json({ error: 'not found' }, 404);
      if (p.status !== 'draft') return json({ error: 'already submitted' }, 409);
      const { count } = await sb.from('proposal_lessons').select('id', { count: 'exact', head: true }).eq('proposal_id', (l as any).proposal_id).not('bunny_video_id', 'is', null);
      if ((count ?? 0) > 120) return json({ error: 'too many videos' }, 429);
      const guid = await createVideo(lib, key, `${p.title || 'Proposal'} — ${(l as any).title}`);
      await sb.from('proposal_lessons').update({ bunny_video_id: guid, uploaded: false }).eq('id', (l as any).id);
      return json(await tusAuth(lib, key, guid));
    }
    if (body.action === 'create_admin') {
      const { data: isAdmin } = await asUser(req).rpc('is_admin');
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const guid = await createVideo(lib, key, String(body.title || 'Lecture'));
      return json(await tusAuth(lib, key, guid));
    }
    if (body.action === 'preview') {
      const { data: isStaff } = await asUser(req).rpc('is_staff');
      if (!isStaff) return json({ error: 'staff only' }, 403);
      let guid = String(body.video_id ?? '');
      if (body.lesson_id) { const { data: l } = await sb.from('proposal_lessons').select('bunny_video_id').eq('id', String(body.lesson_id)).single(); guid = (l as any)?.bunny_video_id ?? ''; }
      if (!guid) return json({ error: 'no video' }, 404);
      const tk = sec('BUNNY_TOKEN_KEY');
      return json({ url: tk ? await bunnyEmbedUrl(lib, guid, tk) : `https://iframe.mediadelivery.net/embed/${lib}/${guid}` });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
