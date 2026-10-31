// Public values only (safe in the browser). Secrets live in Supabase Edge Function secrets.
window.BIOSYN = {
  SUPABASE_URL: 'https://qdlvvwwlsofcngedoaya.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xqiQvcj_a-ZrH-E5a6ozng_Pa137wO5',
  TRACKING: { META_PIXEL_ID: '', GA4_ID: '' }, // fill in to enable Meta Pixel / Google Analytics (leave empty to disable)
  SUPPORT_CHAT: false, // set true after adding the ANTHROPIC_API_KEY secret in Supabase
  GATEWAYS_FALLBACK: [], // payment methods now come from Admin → Integrations (keys saved there)
};
