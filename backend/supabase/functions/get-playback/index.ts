import { admin, currentUser } from './_shared/db.ts';
import { bunnyEmbedUrl, cors, json } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

// POST { lecture_id } -> { url }  (signed Bunny embed URL, valid 4 hours)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { lecture_id, device_id, device_label } = await req.json().catch(() => ({}));
  if (!lecture_id) return json({ error: 'lecture_id required' }, 400);

  const sb = admin();
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
  await loadSecrets(sb);
  const def = sec('BUNNY_LIBRARY_ID'), key = sec('BUNNY_TOKEN_KEY');
  const lib = (v && v.bunny_library_id) || def;
  if (!v || !lib) return json({ error: 'video not available yet' }, 404);
  // the default library is signed with its token key; other libraries (one per course) play through Bunny's
  // own protection (MediaCage DRM + allowed domains) since their token keys aren't stored here
  return json({ url: key && lib === def ? await bunnyEmbedUrl(lib, v.bunny_video_id, key) : `https://iframe.mediadelivery.net/embed/${lib}/${v.bunny_video_id}` });
});
