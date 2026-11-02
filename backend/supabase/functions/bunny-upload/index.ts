import { admin, asUser, currentUser } from './_shared/db.ts';
import { bunnyEmbedUrl, cors, json, sha256Hex } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

// Direct-to-Bunny video uploads (TUS). The browser never sees the Bunny API key:
// this function creates the video slot and returns a short-lived TUS signature.
//   { action: 'status' }                         -> { ready }
//   { action: 'create', lesson_id }              -> instructor uploading a lesson of their draft proposal
//   { action: 'create_admin', title }            -> admin uploading a lecture from the dashboard
//   { action: 'preview', lesson_id | video_id }  -> staff: signed player URL
//   { action: 'import', lesson_id } / { action: 'import_all', proposal_id } -> Bunny downloads the lesson's Drive/Dropbox link
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


// Turn share links into direct-download links Bunny can fetch (file must be shared "anyone with the link").
function directUrl(u: string) {
  const s = u.trim();
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/) || s.match(/docs\.google\.com\/[^?]*\/d\/([\w-]{10,})/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  if (/dropbox\.com\//.test(s)) return s.replace(/([?&])dl=0/, '$1dl=1').replace(/^(?!.*[?&](dl|raw)=1)(.*)$/, (m) => m + (m.includes('?') ? '&' : '?') + 'dl=1');
  return s;
}
const isYouTube = (u: string) => /(?:youtube\.com|youtu\.be)\//i.test(u);
async function findByTag(lib: string, key: string, tag: string) {
  const r = await fetch(`${BUNNY}/library/${lib}/videos?page=1&itemsPerPage=5&search=${encodeURIComponent(tag)}&orderBy=date`, { headers: { AccessKey: key, accept: 'application/json' } });
  if (!r.ok) return null;
  const d = await r.json();
  const it = (d.items ?? []).find((v: any) => String(v.title ?? '').includes(tag));
  return it ? String(it.guid) : null;
}
// Ask Bunny to download the file from the link, then find the new video by a unique tag in its title.
async function importFromUrl(sb: any, lib: string, key: string, lesson: any, courseTitle: string) {
  if (isYouTube(lesson.video_url)) return { error: 'youtube' };
  const tag = `[bp-${String(lesson.id).slice(0, 8)}]`;
  let guid = await findByTag(lib, key, tag);
  if (!guid) {
    const r = await fetch(`${BUNNY}/library/${lib}/videos/fetch`, { method: 'POST', headers: { AccessKey: key, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ url: directUrl(lesson.video_url), title: `${courseTitle || 'Course'} — ${lesson.title} ${tag}`.slice(0, 200) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) return { error: 'fetch failed: ' + (d.message || r.status) };
    for (let i = 0; i < 6 && !guid; i++) { await new Promise((ok) => setTimeout(ok, 1500)); guid = await findByTag(lib, key, tag); }
  }
  if (guid) await sb.from('proposal_lessons').update({ bunny_video_id: guid, uploaded: true }).eq('id', lesson.id);
  return { video_id: guid, queued: !guid };
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
    if (body.action === 'import' || body.action === 'import_all') {
      // owner (draft) or staff: move linked videos (Google Drive / Dropbox / direct links) into Bunny
      const { data: isStaff } = await asUser(req).rpc('is_staff');
      const q = body.action === 'import'
        ? sb.from('proposal_lessons').select('id,title,video_url,bunny_video_id,proposal_id,course_proposals!inner(user_id,status,title)').eq('id', String(body.lesson_id ?? ''))
        : sb.from('proposal_lessons').select('id,title,video_url,bunny_video_id,proposal_id,course_proposals!inner(user_id,status,title)').eq('proposal_id', String(body.proposal_id ?? ''));
      const { data: rows } = await q;
      const out: Record<string, unknown> = {};
      for (const l of (rows ?? []) as any[]) {
        const p = l.course_proposals;
        if (!isStaff && (p.user_id !== user.id || p.status !== 'draft')) { out[l.id] = { error: 'forbidden' }; continue; }
        if (!l.video_url) { out[l.id] = { error: 'no link' }; continue; }
        if (l.bunny_video_id) { out[l.id] = { video_id: l.bunny_video_id }; continue; }
        out[l.id] = await importFromUrl(sb, lib, key, l, p.title);
      }
      return json({ results: out });
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
