import { admin, currentUser, afterPaid } from './_shared/db.ts';
import { cors, json, grossUp, type Gateway } from './_shared/lib.ts';
import { createCheckout, enabledGateways, feeRates } from './_shared/gateways.ts';

// POST { gateway, plan_code } | { gateway, course_id }, plus { return_url }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await currentUser(req);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const b = await req.json();
    const gw = b.gateway as Gateway;
    if (!enabledGateways().includes(gw)) return json({ error: 'gateway not available' }, 400);

    const sb = admin();
    // SITE_URL secret, or the site_url saved in the admin settings
    let site = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    if (!site) { const { data: st } = await sb.from('app_settings').select('value').eq('key', 'site_url').maybeSingle(); site = String(st?.value ?? '').replace(/\/$/, ''); }
    const ret = String(b.return_url ?? site);
    if (!site || !ret.startsWith(site)) return json({ error: 'bad return_url' }, 400);

    let purpose: 'subscription' | 'interactive_course', planId: string | null = null, courseId: string | null = null, price = 0, title = '';
    if (b.plan_code) {
      const { data: plan } = await sb.from('plans').select('id,name,price_egp').eq('code', b.plan_code).eq('active', true).single();
      if (!plan) return json({ error: 'plan not found' }, 404);
      purpose = 'subscription'; planId = plan.id; price = Number(plan.price_egp); title = `Biosyn: ${plan.name}`;
    } else if (b.course_id) {
      const { data: c } = await sb.from('courses').select('id,title,price_egp').eq('id', b.course_id).single();
      if (!c) return json({ error: 'course not found' }, 404);
      purpose = 'interactive_course'; courseId = c.id; price = Number(c.price_egp); title = `Biosyn: ${c.title}`;
    } else return json({ error: 'plan_code or course_id required' }, 400);

    const rates = feeRates(gw);
    const { data: p, error } = await sb.rpc('create_pending_payment', {
      p_user: user.id, p_gateway: gw, p_purpose: purpose, p_plan: planId, p_course: courseId,
      p_fee: grossUp(price, rates.pct, rates.fixed).fee,
      p_coupon: typeof b.coupon === 'string' && b.coupon.trim() ? b.coupon.trim() : null,
    });
    if (error) return json({ error: error.message }, 400);

    // a 100% coupon: nothing to charge, grant access directly
    if (Number(p.amount_egp) === 0) {
      const { error: fe } = await sb.rpc('fulfil_payment', { p_payment: p.id, p_gateway_ref: 'free:' + p.id });
      if (fe) return json({ error: fe.message }, 400);
      await afterPaid(sb, p.id);
      return json({ url: `${ret}?payment=success&id=${p.id}`, payment_id: p.id, price: 0, fee: 0, total: 0, free: true });
    }
    // the DB price is authoritative: recompute the fee if it changed between lookup and insert
    const g = grossUp(Number(p.amount_egp), rates.pct, rates.fixed);
    if (g.fee !== Number(p.fee_egp)) await sb.from('payments').update({ fee_egp: g.fee }).eq('id', p.id);

    const { data: prof } = await sb.from('profiles').select('full_name,phone').eq('id', user.id).single();
    try {
      const res = await createCheckout(gw, {
        paymentId: p.id, total: g.total, title,
        customer: { name: prof?.full_name || 'Student', email: user.email ?? '', phone: prof?.phone ?? '' },
        successUrl: `${ret}?payment=success&id=${p.id}`, cancelUrl: `${ret}?payment=cancelled&id=${p.id}`,
        webhookBase: `${Deno.env.get('SUPABASE_URL')}/functions/v1`,
      });
      if (res.gatewayRef) await sb.from('payments').update({ gateway_ref: res.gatewayRef }).eq('id', p.id);
      return json({ url: res.url, payment_id: p.id, price: Number(p.amount_egp), list_price: Number(p.list_price_egp ?? p.amount_egp), discount: Number(p.discount_egp ?? 0), fee: g.fee, total: g.total });
    } catch (e) {
      await sb.rpc('fail_payment', { p_payment: p.id });
      return json({ error: 'could not start payment', detail: String(e) }, 502);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
