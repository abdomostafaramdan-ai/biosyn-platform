import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as L from '../supabase/functions/_shared/lib.ts';

// grossUp: customer pays fee; platform nets the plan price
let g = L.grossUp(200, 2.75, 3);          // e.g. 2.75% + 3 EGP
assert.ok(g.total * (1 - 0.0275) - 3 >= 200 - 0.01, 'net >= price');
assert.equal(+(g.total - 200).toFixed(2), g.fee);
assert.deepEqual(L.grossUp(800, 0, 0), { total: 800, fee: 0 });
assert.throws(() => L.grossUp(100, 100, 0));

// Stripe signature (independent HMAC)
const body = '{"id":"evt_1","type":"checkout.session.completed"}';
const t = 1_700_000_000, secret = 'whsec_test';
const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
assert.equal(await L.verifyStripe(body, `t=${t},v1=${sig}`, secret, t + 10), true);
assert.equal(await L.verifyStripe(body, `t=${t},v1=${sig}`, secret, t + 1000), false, 'stale');
assert.equal(await L.verifyStripe(body + 'x', `t=${t},v1=${sig}`, secret, t + 10), false, 'tampered');
assert.equal(await L.verifyStripe(body, null, secret, t), false);

// Paymob: concatenation order + SHA512 (independent HMAC)
const obj = { amount_cents: 20000, created_at: '2026-10-28T06:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  id: 111, integration_id: 5, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true,
  is_voided: false, order: { id: 222 }, owner: 9, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true };
const concat = '20000' + '2026-10-28T06:00:00' + 'EGP' + 'false' + 'false' + '111' + '5' + 'true' + 'false' + 'false' + 'false' + 'true' + 'false' + '222' + '9' + 'false' + '2346' + 'MasterCard' + 'card' + 'true';
assert.equal(L.paymobConcat(obj), concat);
const h = crypto.createHmac('sha512', 'pm_secret').update(concat).digest('hex');
assert.equal(await L.verifyPaymob(obj, h, 'pm_secret'), true);
assert.equal(await L.verifyPaymob({ ...obj, amount_cents: 1 }, h, 'pm_secret'), false, 'tampered amount');

// Fawaterk hash
const fb = { invoice_id: 77, invoice_key: 'abc', payment_method: 'Visa/Mastercard' };
fb.hashKey = crypto.createHmac('sha256', 'fk').update('InvoiceId=77&InvoiceKey=abc&PaymentMethod=Visa/Mastercard').digest('hex');
assert.equal(await L.verifyFawaterk(fb, 'fk'), true);
assert.equal(await L.verifyFawaterk({ ...fb, invoice_id: 78 }, 'fk'), false);

// Bunny token
const url = await L.bunnyEmbedUrl('123', 'vid-1', 'key', 3600, 1_700_000_000);
const exp = 1_700_003_600;
const tok = crypto.createHash('sha256').update('key' + 'vid-1' + exp).digest('hex');
assert.equal(url, `https://iframe.mediadelivery.net/embed/123/vid-1?token=${tok}&expires=${exp}`);
console.log('all lib tests passed');
