// Visitor country (ISO-2) from the request + the price region that applies to it.
// Egypt (or an unknown country) => null region => plain EGP prices.
const ISO2 = /^[A-Z]{2}$/;
export async function countryOf(req: Request): Promise<string> {
  const h = req.headers;
  for (const k of ['cf-ipcountry']  /* only the header Cloudflare sets; x-country-code / x-vercel-ip-country are client-spoofable */) {
    const v = (h.get(k) || '').toUpperCase();
    if (ISO2.test(v) && v !== 'XX') return v;
  }
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || '';
  if (!ip) return '';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://api.country.is/${encodeURIComponent(ip)}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return '';
    const c = String((await r.json()).country || '').toUpperCase();
    return ISO2.test(c) ? c : '';
  } catch { return ''; }
}

export interface Region { country: string; currency: string; symbol: string; factor: number; egp_rate: number; decimals: number; name: string }
export async function regionFor(sb: any, country: string): Promise<Region | null> {
  if (!country || country === 'EG') return null;
  const { data } = await sb.from('price_regions').select('*').in('country', [country, '*']).eq('active', true);
  const row = (data ?? []).find((r: any) => r.country === country) || (data ?? []).find((r: any) => r.country === '*');
  if (!row) return null;
  return { country, currency: row.currency, symbol: row.symbol, factor: Number(row.factor), egp_rate: Number(row.egp_rate), decimals: Number(row.decimals), name: row.name };
}
// "same number" pricing: the EGP list price × factor, rounded to a whole unit
export const localPrice = (egp: number, r: Region) => (egp <= 0 ? 0 : Math.max(1, Math.round(egp * r.factor)));

// Fawaterk takes these currency codes (it spells SAR as "SR"); Paymob Egypt is EGP only; Stripe takes all.
const FAWATERK: Record<string, string> = { USD: 'USD', EGP: 'EGP', SAR: 'SR', AED: 'AED', KWD: 'KWD', QAR: 'QAR', BHD: 'BHD' };
export const fawaterkCode = (cur: string) => FAWATERK[cur] || null;
// Abroad: card gateways only. Fawaterk always shows (cards, wallets, Fawry…); a currency it doesn't take is charged in USD.
export function gatewaysForCurrency(all: string[], cur: string) {
  if (cur === 'EGP') return all;
  return all.filter((g) => g === 'stripe' || g === 'fawaterk');
}
