import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json } from './_shared/lib.ts';
import { loadSecrets } from './_shared/secrets.ts';
import { enabledGateways } from './_shared/gateways.ts';
import { countryOf, gatewaysForCurrency, regionFor } from './_shared/geo.ts';

// Public. -> { country, currency, symbol, factor, decimals, gateways }  (EGP for Egypt / unknown)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  await loadSecrets(sb);
  const country = await countryOf(req);
  const r = await regionFor(sb, country);
  const cur = r ? r.currency : 'EGP';
  return json({
    country: country || null, currency: cur, symbol: r ? r.symbol : 'ج.م', factor: r ? r.factor : 1, decimals: r ? r.decimals : 2,
    name: r ? r.name : 'مصر', gateways: gatewaysForCurrency(enabledGateways(), cur), manual: !r,
  });
});
