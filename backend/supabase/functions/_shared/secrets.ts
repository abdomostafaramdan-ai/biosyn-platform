// Integration keys: a Supabase secret (env) wins; otherwise the value saved from the admin panel (integration_secrets).
// Call `await loadSecrets(sb)` once at the start of a request, then read with `sec('KEY')`.
const DB = new Map<string, string>();
let loadedAt = 0;

export async function loadSecrets(sb: { from: (t: string) => any }) {
  if (Date.now() - loadedAt < 30_000) return;
  const { data } = await sb.from('integration_secrets').select('key,value');
  DB.clear();
  for (const r of (data ?? []) as Array<{ key: string; value: string }>) DB.set(r.key, r.value);
  loadedAt = Date.now();
}
export const sec = (k: string) => Deno.env.get(k) || DB.get(k) || '';
export const secSource = (k: string) => (Deno.env.get(k) ? 'env' : DB.has(k) ? 'db' : null);
