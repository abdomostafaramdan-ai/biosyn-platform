// Admin: lifetime view counts per course from Bunny Stream.
// For every Bunny library used by our lectures it reads each video's lifetime `views` and `totalWatchTime`,
// plus the library's daily statistics since the library was created. Keys never leave the server.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const STREAM = 'https://video.bunnycdn.com', CORE = 'https://api.bunny.net';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const URL_ = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ok = await fetch(`${URL_}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: ANON, Authorization: req.headers.get('Authorization') || '', 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => false);
  const db = (path: string) => fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }).then((r) => r.json());
  // Non-admins (the daily cron) may only trigger a refresh of the public snapshot, at most every 6 hours, and get nothing back.
  let cronOnly = false;
  if (ok !== true) {
    const snap = (await db('site_content?key=eq.bunny_stats&select=data'))?.[0]?.data;
    if (snap?.updated_at && Date.now() - Date.parse(snap.updated_at) < 6 * 3600e3) return json({ ok: true, skipped: true });
    cronOnly = true;
  }
  const secrets = new Map<string, string>((await db('integration_secrets?select=key,value')).map((r: any) => [r.key, r.value]));
  const sec = (k: string) => Deno.env.get(k) || secrets.get(k) || '';
  const isAcc = (k: string) => /^[0-9a-f-]{70,}$/i.test(k.trim());
  const acc = sec('BUNNY_ACCOUNT_KEY') || (isAcc(sec('BUNNY_API_KEY')) ? sec('BUNNY_API_KEY') : '');
  if (!acc) return json({ error: 'bunny account key missing' }, 400);

  // lectures → course map
  const rows: any[] = await db('lecture_videos?select=bunny_video_id,bunny_library_id,lectures(id,title,position,course_id,courses(id,title,slug,status))');
  const byVideo = new Map<string, any>(); const libs = new Set<string>();
  for (const r of rows) { if (r.bunny_library_id) libs.add(String(r.bunny_library_id)); byVideo.set(r.bunny_video_id, r.lectures); }

  const libInfo: Record<string, any> = {}, videos: any[] = [];
  for (const lib of libs) {
    const li = await fetch(`${CORE}/videolibrary/${lib}`, { headers: { AccessKey: acc, accept: 'application/json' } });
    if (!li.ok) { libInfo[lib] = { error: li.status }; continue; }
    const L = await li.json(); const key = String(L.ApiKey ?? '');
    libInfo[lib] = { name: L.Name, created: L.DateCreated, videos: L.VideoCount };
    for (let page = 1; page < 50; page++) {
      const r = await fetch(`${STREAM}/library/${lib}/videos?page=${page}&itemsPerPage=100&orderBy=date`, { headers: { AccessKey: key, accept: 'application/json' } });
      if (!r.ok) break; const d = await r.json();
      for (const v of d.items ?? []) videos.push({ lib, guid: v.guid, title: v.title, views: Number(v.views || 0), watch_s: Number(v.totalWatchTime || 0), length: Number(v.length || 0), created: v.dateUploaded });
      if ((d.items ?? []).length < 100) break;
    }
    const from = String(L.DateCreated || '2024-01-01').slice(0, 10), to = new Date().toISOString().slice(0, 10);
    const st = await fetch(`${STREAM}/library/${lib}/statistics?dateFrom=${from}T00:00:00Z&dateTo=${to}T23:59:59Z&hourly=false`, { headers: { AccessKey: key, accept: 'application/json' } });
    if (st.ok) { const s = await st.json(); const sum = (o: any) => Object.values(o || {}).reduce((a: number, b: any) => a + Number(b || 0), 0);
      libInfo[lib].stats = { views: sum(s.viewsChart), watch_s: sum(s.watchTimeChart), from, countries: s.countryViewCounts || {} }; }
  }
  // Lifetime watch time per library. Bunny's statistics endpoint keeps a limited history, so its views can be lower than
  // the videos' lifetime view counters; scale its watch time by that ratio (per-video totalWatchTime wins when Bunny fills it).
  let watchTotal = 0;
  for (const lib of Object.keys(libInfo)) {
    const vs = videos.filter((v) => v.lib === lib), vViews = vs.reduce((a, v) => a + v.views, 0), vWatch = vs.reduce((a, v) => a + v.watch_s, 0);
    const st = libInfo[lib].stats; let w = vWatch;
    if (!w && st && st.watch_s) w = st.watch_s * (st.views > 0 ? Math.max(1, vViews / st.views) : 1);
    libInfo[lib].views = vViews; libInfo[lib].watch_est_s = Math.round(w); watchTotal += w;
  }
  const totalViews = videos.reduce((a, v) => a + v.views, 0);
  if (watchTotal > 0) await fetch(`${URL_}/rest/v1/site_content?on_conflict=key`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'bunny_stats', updated_at: new Date().toISOString(), data: { minutes: Math.round(watchTotal / 60), views: totalViews, updated_at: new Date().toISOString() } }) });
  if (cronOnly) return json({ ok: true });
  const courses: Record<string, any> = {};
  for (const v of videos) {
    const l = byVideo.get(v.guid); const c = l && l.courses;
    const k = c ? c.id : `lib:${v.lib}`;
    const o = courses[k] ||= { course: c ? c.title : `(${libInfo[v.lib]?.name || v.lib} — غير مربوط بدورة)`, slug: c?.slug, status: c?.status, views: 0, watch_s: 0, videos: 0, top: [] as any[] };
    o.views += v.views; o.watch_s += v.watch_s; o.lib = v.lib; o.videos++; o.top.push({ title: l ? l.title : v.title, views: v.views });
  }
  for (const o of Object.values(courses)) { o.top.sort((a: any, b: any) => b.views - a.views); o.top = o.top.slice(0, 3); }
  return json({ courses: Object.values(courses).sort((a: any, b: any) => b.views - a.views), libraries: libInfo, total_views: totalViews, watch_minutes: Math.round(watchTotal / 60) });
});
