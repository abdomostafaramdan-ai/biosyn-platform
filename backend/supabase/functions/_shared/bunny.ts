import { sec } from './secrets.ts';

// Bunny Stream helpers that work across several video libraries.
// Library API keys come from BUNNY_API_KEY (default library) or are looked up with the account key (BUNNY_ACCOUNT_KEY).
export const STREAM = 'https://video.bunnycdn.com';
const CORE = 'https://api.bunny.net';
const keys = new Map<string, string>();

export const defaultLib = () => sec('BUNNY_LIBRARY_ID');
export const accountKey = () => sec('BUNNY_ACCOUNT_KEY');
export const uploadsReady = () => !!(defaultLib() && (sec('BUNNY_API_KEY') || accountKey()));

export async function libKey(lib: string) {
  if (!lib) throw new Error('no library');
  if (lib === defaultLib() && sec('BUNNY_API_KEY')) return sec('BUNNY_API_KEY');
  if (keys.has(lib)) return keys.get(lib)!;
  const ak = accountKey();
  if (!ak) throw new Error('uploads not configured');
  const r = await fetch(`${CORE}/videolibrary/${encodeURIComponent(lib)}`, { headers: { AccessKey: ak, accept: 'application/json' } });
  if (!r.ok) throw new Error('bunny library lookup failed: ' + r.status);
  const d = await r.json();
  const k = String(d.ApiKey ?? d.ApiAccessKey ?? '');
  if (!k) throw new Error('bunny library has no api key');
  keys.set(lib, k);
  return k;
}

export async function listLibraries() {
  const ak = accountKey();
  if (!ak) throw new Error('account key required');
  const out: Array<{ id: string; name: string; videos: number }> = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${CORE}/videolibrary?page=${page}&perPage=100`, { headers: { AccessKey: ak, accept: 'application/json' } });
    if (!r.ok) throw new Error('bunny libraries failed: ' + r.status);
    const d = await r.json();
    const items = Array.isArray(d) ? d : (d.Items ?? []);
    for (const l of items) out.push({ id: String(l.Id), name: String(l.Name ?? ''), videos: Number(l.VideoCount ?? 0) });
    if (Array.isArray(d) || !d.HasMoreItems) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listVideos(lib: string) {
  const k = await libKey(lib);
  const out: Array<{ guid: string; title: string; length: number; status: number; date: string }> = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${STREAM}/library/${lib}/videos?page=${page}&itemsPerPage=100&orderBy=date`, { headers: { AccessKey: k, accept: 'application/json' } });
    if (!r.ok) throw new Error('bunny videos failed: ' + r.status);
    const d = await r.json();
    for (const v of d.items ?? []) out.push({ guid: String(v.guid), title: String(v.title ?? ''), length: Number(v.length ?? 0), status: Number(v.status ?? 0), date: String(v.dateUploaded ?? '') });
    if ((d.items ?? []).length < 100) break;
  }
  return out;
}
