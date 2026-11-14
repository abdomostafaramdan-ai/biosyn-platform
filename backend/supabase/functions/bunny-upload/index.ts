import { admin, asUser, currentUser } from './_shared/db.ts';
import { bunnyEmbedUrl, cors, json, sha256Hex } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';
import { STREAM, accountKey, defaultLib, ensureReferrers, libKey, listLibraries, listVideos, uploadsReady } from './_shared/bunny.ts';

// Bunny Stream bridge. The browser never sees a Bunny key.
//   { action: 'status' }                               -> { ready }
//   { action: 'create', lesson_id }                    -> instructor: TUS slot for a lesson of their draft proposal
//   { action: 'create_admin', title }                  -> admin: TUS slot for a lecture
//   { action: 'import', lesson_id } / 'import_all'     -> Bunny downloads a lesson's Drive/Dropbox link
//   { action: 'preview', lesson_id | video_id, library_id? } -> staff: player URL
//   { action: 'libraries' }                            -> admin: all Stream libraries (needs account key)
//   { action: 'library_videos', library_id }           -> admin: videos in one library

async function createVideo(lib: string, title: string) {
  const r = await fetch(`${STREAM}/library/${lib}/videos`, { method: 'POST', headers: { AccessKey: await libKey(lib), 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ title: title.slice(0, 200) }) });
  if (!r.ok) throw new Error('bunny create failed: ' + r.status);
  return String((await r.json()).guid);
}
async function tusAuth(lib: string, guid: string) {
  const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
  return { library_id: lib, video_id: guid, expire, signature: await sha256Hex(lib + (await libKey(lib)) + expire + guid), endpoint: `${STREAM}/tusupload` };
}

// share links -> direct download links (file must be shared "anyone with the link")
function directUrl(u: string) {
  const s = u.trim();
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/) || s.match(/docs\.google\.com\/[^?]*\/d\/([\w-]{10,})/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  if (/dropbox\.com\//.test(s)) return /[?&]dl=0/.test(s) ? s.replace(/([?&])dl=0/, '$1dl=1') : /[?&](dl|raw)=1/.test(s) ? s : s + (s.includes('?') ? '&' : '?') + 'dl=1';
  return s;
}
const isYouTube = (u: string) => /(?:youtube\.com|youtu\.be)\//i.test(u);
async function findByTag(lib: string, tag: string) {
  const r = await fetch(`${STREAM}/library/${lib}/videos?page=1&itemsPerPage=5&search=${encodeURIComponent(tag)}&orderBy=date`, { headers: { AccessKey: await libKey(lib), accept: 'application/json' } });
  if (!r.ok) return null;
  const it = ((await r.json()).items ?? []).find((v: any) => String(v.title ?? '').includes(tag));
  return it ? String(it.guid) : null;
}
async function importFromUrl(sb: any, lesson: any, courseTitle: string) {
  if (isYouTube(lesson.video_url)) return { error: 'youtube' };
  const lib = defaultLib(), tag = `[bp-${String(lesson.id).slice(0, 8)}]`;
  let guid = await findByTag(lib, tag);
  if (!guid) {
    const r = await fetch(`${STREAM}/library/${lib}/videos/fetch`, { method: 'POST', headers: { AccessKey: await libKey(lib), 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ url: directUrl(lesson.video_url), title: `${courseTitle || 'Course'} — ${lesson.title} ${tag}`.slice(0, 200) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) return { error: 'fetch failed: ' + (d.message || r.status) };
    for (let i = 0; i < 6 && !guid; i++) { await new Promise((ok) => setTimeout(ok, 1500)); guid = await findByTag(lib, tag); }
  }
  if (guid) await sb.from('proposal_lessons').update({ bunny_video_id: guid, bunny_library_id: lib, uploaded: true }).eq('id', lesson.id);
  return { video_id: guid, queued: !guid };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = admin();
  await loadSecrets(sb);
  if (body.action === 'status') return json({ ready: uploadsReady(), libraries: !!accountKey() });

  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const isRole = async (fn: string) => (await asUser(req).rpc(fn)).data === true;
  // per-user daily cap (chat_hit returns false once the limit is exceeded)
  const allow = async (key: string, limit: number) => (await sb.rpc('chat_hit', { p_key: key + ':' + user.id, p_limit: limit })).data !== false;

  try {
    if (body.action === 'libraries' || body.action === 'library_videos') {
      if (!(await isRole('is_admin'))) return json({ error: 'admin only' }, 403);
      if (!accountKey() && body.action === 'libraries') return json({ error: 'account key required' }, 503);
      if (body.action === 'libraries') return json({ libraries: await listLibraries(), default_library: defaultLib() });
      const lid = String(body.library_id ?? '');
      const [videos, referrers_added] = await Promise.all([listVideos(lid), ensureReferrers(lid).catch(() => [])]);
      return json({ videos, referrers_added });
    }
    if (!uploadsReady()) return json({ error: 'uploads not configured' }, 503);
    const lib = defaultLib();

    if (body.action === 'create') {
      const { data: l } = await sb.from('proposal_lessons').select('id,title,proposal_id,course_proposals!inner(user_id,status,title)').eq('id', String(body.lesson_id ?? '')).single();
      const p = (l as any)?.course_proposals;
      if (!l || !p || p.user_id !== user.id) return json({ error: 'not found' }, 404);
      if (p.status !== 'draft') return json({ error: 'already submitted' }, 409);
      const { count } = await sb.from('proposal_lessons').select('id', { count: 'exact', head: true }).eq('proposal_id', (l as any).proposal_id).not('bunny_video_id', 'is', null);
      if ((count ?? 0) > 120) return json({ error: 'too many videos' }, 429);
      if (!(await allow('bunny-create', 60))) return json({ error: 'daily upload limit reached' }, 429);
      const guid = await createVideo(lib, `${p.title || 'Proposal'} — ${(l as any).title}`);
      await sb.from('proposal_lessons').update({ bunny_video_id: guid, bunny_library_id: lib, uploaded: false }).eq('id', (l as any).id);
      return json(await tusAuth(lib, guid));
    }
    if (body.action === 'import' || body.action === 'import_all') {
      const staff = await isRole('is_staff');
      const sel = 'id,title,video_url,bunny_video_id,proposal_id,course_proposals!inner(user_id,status,title)';
      const { data: rows } = body.action === 'import'
        ? await sb.from('proposal_lessons').select(sel).eq('id', String(body.lesson_id ?? ''))
        : await sb.from('proposal_lessons').select(sel).eq('proposal_id', String(body.proposal_id ?? ''));
      const out: Record<string, unknown> = {};
      for (const l of (rows ?? []) as any[]) {
        const p = l.course_proposals;
        if (!staff && (p.user_id !== user.id || p.status !== 'draft')) { out[l.id] = { error: 'forbidden' }; continue; }
        if (!l.video_url) { out[l.id] = { error: 'no link' }; continue; }
        if (l.bunny_video_id) { out[l.id] = { video_id: l.bunny_video_id }; continue; }
        if (!staff && !(await allow('bunny-import', 60))) { out[l.id] = { error: 'daily import limit reached' }; continue; }
        out[l.id] = await importFromUrl(sb, l, p.title);
      }
      return json({ results: out });
    }
    if (body.action === 'create_admin') {
      if (!(await isRole('is_admin'))) return json({ error: 'admin only' }, 403);
      const guid = await createVideo(lib, String(body.title || 'Lecture'));
      return json(await tusAuth(lib, guid));
    }
    if (body.action === 'preview') {
      if (!(await isRole('is_staff'))) return json({ error: 'staff only' }, 403);
      let guid = String(body.video_id ?? ''), vlib = String(body.library_id ?? '') || lib;
      if (body.lesson_id) {
        const { data: l } = await sb.from('proposal_lessons').select('bunny_video_id,bunny_library_id').eq('id', String(body.lesson_id)).single();
        guid = (l as any)?.bunny_video_id ?? ''; vlib = (l as any)?.bunny_library_id || lib;
      }
      if (!guid) return json({ error: 'no video' }, 404);
      const tk = sec('BUNNY_TOKEN_KEY');
      return json({ url: tk && vlib === lib ? await bunnyEmbedUrl(vlib, guid, tk) : `https://iframe.mediadelivery.net/embed/${vlib}/${guid}` });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    const m = String((e as Error).message || e);
    return json({ error: m }, /not configured|account key/.test(m) ? 503 : 502);
  }
});
