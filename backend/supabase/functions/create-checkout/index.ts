import { admin, currentUser, afterPaid } from './_shared/db.ts';
import { cors, json, grossUp, type Gateway } from './_shared/lib.ts';
import { createCheckout, enabledGateways, feeRates } from './_shared/gateways.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';
import { countryOf, fawaterkCode, gatewaysForCurrency, localPrice, regionFor } from './_shared/geo.ts';

// POST { gateway, plan_code } | { gateway, course_id } | { gateway, consultation: <request id> }, plus { return_url }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await currentUser(req);
    if (!user) return json({ error: 'unauthorized' }, 401);

    await loadSecrets(admin());
    const b = await req.json();
    const gw = b.gateway as Gateway;
    const sb = admin();
    // outside Egypt the price is charged in the visitor's currency (decided here, never by the browser)
    const region = await regionFor(sb, await countryOf(req));
    let cur = region ? region.currency : 'EGP';
    if (!gatewaysForCurrency(enabledGateways(), cur).includes(gw)) return json({ error: 'gateway not available' }, 400);

    // SITE_URL secret, or the site_url saved in the admin settings
    let site = sec('SITE_URL').replace(/\/$/, '');
    if (!site) { const { data: st } = await sb.from('app_settings').select('value').eq('key', 'site_url').maybeSingle(); site = String(st?.value ?? '').replace(/\/$/, ''); }
    const ret = String(b.return_url ?? site);
    if (!site || !ret.startsWith(site)) return json({ error: 'bad return_url' }, 400);

    let purpose: 'subscription' | 'interactive_course', planId: string | null = null, courseId: string | null = null, price = 0, title = '', intl: number | null = null, requestId: string | null = null;
    if (b.plan_code) {
      const { data: plan } = await sb.from('plans').select('id,name,price_egp,intl_price').eq('code', b.plan_code).eq('active', true).single();
      if (!plan) return json({ error: 'plan not found' }, 404);
      purpose = 'subscription'; planId = plan.id; price = Number(plan.price_egp); intl = plan.intl_price == null ? null : Number(plan.intl_price); title = `Biosyn: ${plan.name}`;
    } else if (b.course_id) {
      const { data: c } = await sb.from('courses').select('id,title,price_egp,intl_price').eq('id', b.course_id).single();
      if (!c) return json({ error: 'course not found' }, 404);
      purpose = 'interactive_course'; courseId = c.id; price = Number(c.price_egp); intl = c.intl_price == null ? null : Number(c.intl_price); title = `Biosyn: ${c.title}`;
    } else if (b.consultation) {
      const { data: rq } = await sb.from('requests').select('id,user_id,type').eq('id', String(b.consultation)).single();
      if (!rq || rq.user_id !== user.id || rq.type !== 'consultation') return json({ error: 'not found' }, 404);
      const { data: st } = await sb.from('app_settings').select('key,value').in('key', ['consultation_price_egp', 'consultation_intl_price']);
      const g = (k: string) => (st ?? []).find((x: any) => x.key === k)?.value;
      purpose = 'consultation' as any; requestId = rq.id; price = Number(g('consultation_price_egp') || 0); intl = g('consultation_intl_price') ? Number(g('consultation_intl_price')) : null; title = 'Biosyn: استشارة';
    } else return json({ error: 'plan_code, course_id or consultation required' }, 400);

    const rates = feeRates(gw);
    // fee on the EGP price for now; for a foreign currency it's recomputed on the local amount below
    const { data: p, error } = await sb.rpc('create_pending_payment', {
      p_user: user.id, p_gateway: gw, p_purpose: purpose, p_plan: planId, p_course: courseId,
      p_fee: grossUp(price, rates.pct, rates.fixed).fee,
      p_coupon: typeof b.coupon === 'string' && b.coupon.trim() ? b.coupon.trim() : null,
    });
    if (error) return json({ error: error.message }, 400);
    if (requestId) await sb.from('payments').update({ request_id: requestId }).eq('id', p.id);

    // a 100% coupon: nothing to charge, grant access directly
    if (Number(p.amount_egp) === 0) {
      const { error: fe } = await sb.rpc('fulfil_payment', { p_payment: p.id, p_gateway_ref: 'free:' + p.id });
      if (fe) return json({ error: fe.message }, 400);
      await afterPaid(sb, p.id);
      return json({ url: `${ret}?payment=success&id=${p.id}`, payment_id: p.id, price: 0, fee: 0, total: 0, free: true });
    }
    // the DB price is authoritative: recompute the fee if it changed between lookup and insert
    let g = grossUp(Number(p.amount_egp), rates.pct, rates.fixed), localAmt = 0;
    if (region) {
      // same-number pricing in local currency; keep the EGP equivalent in amount_egp/fee_egp for revenue share
      // fixed international price (same number in every currency) if set, else EGP × factor; coupons keep their % off
      const listEgp = Number(p.list_price_egp ?? p.amount_egp), listLocal = intl != null ? intl : localPrice(listEgp, region);
      const amt = listEgp > 0 ? Math.round(listLocal * (Number(p.amount_egp) / listEgp) * 100) / 100 : 0;
      localAmt = amt;
      let fx = region.egp_rate, amtC = amt;
      // Fawaterk doesn't take every currency (EUR, GBP…): charge the same value in USD there
      if (gw === 'fawaterk' && !fawaterkCode(cur)) {
        const { data: usd } = await sb.from('price_regions').select('egp_rate').eq('currency', 'USD').eq('active', true).limit(1).maybeSingle();
        const usdRate = Number(usd?.egp_rate || 0);
        if (!usdRate) return json({ error: 'gateway not available' }, 400);
        amtC = Math.ceil((amt * fx / usdRate) * 100) / 100; fx = usdRate; cur = 'USD'; localAmt = amtC;
      }
      const gl = grossUp(amtC, rates.pct, Math.round((rates.fixed / fx) * 100) / 100); // fixed fee is set in EGP
      g = gl;
      const { error: ue } = await sb.from('payments').update({
        currency: cur, country: region.country, fx_egp: fx, amount_local: amtC, fee_local: gl.fee,
        amount_egp: Math.round(amtC * fx * 100) / 100, fee_egp: Math.round(gl.fee * fx * 100) / 100,
      }).eq('id', p.id);
      if (ue) { await sb.rpc('fail_payment', { p_payment: p.id }); return json({ error: ue.message }, 500); }
    } else if (g.fee !== Number(p.fee_egp)) await sb.from('payments').update({ fee_egp: g.fee }).eq('id', p.id);

    const { data: prof } = await sb.from('profiles').select('full_name,phone').eq('id', user.id).single();
    try {
      const res = await createCheckout(gw, {
        paymentId: p.id, total: g.total, title, currency: cur, decimals: cur === 'USD' ? 2 : region ? region.decimals : 2,
        customer: { name: prof?.full_name || 'Student', email: user.email ?? '', phone: prof?.phone ?? '' },
        successUrl: `${ret}?payment=success&id=${p.id}`, cancelUrl: `${ret}?payment=cancelled&id=${p.id}`,
        webhookBase: `${Deno.env.get('SUPABASE_URL')}/functions/v1`,
      });
      if (res.gatewayRef) {
        await sb.from('payments').update({ gateway_ref: res.gatewayRef }).eq('id', p.id);
        // Fawaterk hands back the same open invoice on a retry: the older attempt is superseded by this one
        if (gw === 'fawaterk') await sb.from('payments').update({ status: 'failed' }).eq('gateway', 'fawaterk').eq('status', 'pending').eq('gateway_ref', res.gatewayRef).neq('id', p.id);
      }
      return json({ url: res.url, payment_id: p.id, currency: cur, price: region ? localAmt : Number(p.amount_egp), list_price: Number(p.list_price_egp ?? p.amount_egp), discount: Number(p.discount_egp ?? 0), fee: g.fee, total: g.total });
    } catch (e) {
      await sb.rpc('fail_payment', { p_payment: p.id });
      return json({ error: 'could not start payment', detail: String(e) }, 502);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
