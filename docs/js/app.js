/* Biosyn Egypt: site behaviour. Pages are static HTML; this file wires them to Supabase. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EGP = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const here = () => location.pathname.split('/').pop() || 'index.html';
  const LEVEL = { beginner: 'مبتدئ', beginner_intermediate: 'مبتدئ ومتوسط', intermediate: 'متوسط', intermediate_advanced: 'متوسط ومتقدم', advanced: 'متقدم', all_levels: 'كل المستويات' };
  // which basic levels each course level covers (for the level filter)
  const LEVEL_SPAN = { beginner: ['beginner'], beginner_intermediate: ['beginner', 'intermediate'], intermediate: ['intermediate'], intermediate_advanced: ['intermediate', 'advanced'], advanced: ['advanced'], all_levels: ['beginner', 'intermediate', 'advanced'] };
  window.LEVEL_SPAN = LEVEL_SPAN;
  const ALL_SPECS = 'كل التخصصات'; window.ALL_SPECS = ALL_SPECS;
  const ERR = {
    'gateway not available': 'بوابة الدفع هذه غير مفعّلة بعد، جرّب بوابة أخرى.',
    'already enrolled': 'أنت مسجّل في هذه الدورة بالفعل.',
    'course is full': 'اكتمل عدد المقاعد في هذه الدورة.',
    'plan not available': 'هذه الباقة غير متاحة حاليًا.',
    'course not available': 'هذه الدورة غير متاح حاليًا.',
  };
  const arErr = (e) => ERR[e && e.message] || (e && e.message) || 'حدث خطأ غير متوقع، حاول مرة أخرى.';
  window.$ = $; window.$$ = $$; window.esc = esc; window.EGP = EGP; window.LEVEL = LEVEL; window.arErr = arErr;

  // ---------- regional pricing: outside Egypt prices show in the visitor's currency (same number × factor) ----------
  const EG_REGION = { country: 'EG', currency: 'EGP', symbol: 'ج.م', factor: 1, decimals: 2, gateways: null, manual: true };
  const REGION = (async () => {
    try { const c = JSON.parse(sessionStorage.getItem('biosyn.region') || 'null'); if (c && c.currency && Date.now() - (c.at || 0) < 30 * 60e3) return c; } catch {}
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(BIOSYN.SUPABASE_URL + '/functions/v1/geo', { method: 'POST', signal: ctl.signal, headers: { apikey: BIOSYN.SUPABASE_KEY, Authorization: 'Bearer ' + BIOSYN.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' });
      clearTimeout(t);
      const d = r.ok ? await r.json() : null;
      const out = d && d.currency ? { ...EG_REGION, ...d, at: Date.now() } : EG_REGION;
      try { sessionStorage.setItem('biosyn.region', JSON.stringify(out)); } catch {}
      return out;
    } catch { return EG_REGION; }
  })();
  window.REGION = REGION; window.REGION_NOW = EG_REGION; REGION.then((r) => (window.REGION_NOW = r));
  // price in the visitor's currency for an EGP list price (whole units, same rule as the server)
  const localOf = (egp, R) => (!R || R.currency === 'EGP' ? Number(egp) : Number(egp) <= 0 ? 0 : Math.max(1, Math.round(Number(egp) * Number(R.factor || 1))));
  const curOf = (R) => (R && R.currency !== 'EGP' ? R.symbol : 'ج.م');
  // outside Egypt a fixed international price (same number in every currency) wins when set
  const itemPrice = (egp, intl, R) => (R && R.currency !== 'EGP' && intl != null && intl !== '' ? Number(intl) : localOf(egp, R));
  const priceTxt = (egp, R, intl) => `${EGP(itemPrice(egp, intl, R))} ${curOf(R)}`;
  window.itemPrice = itemPrice;
  window.localOf = localOf; window.curOf = curOf; window.priceTxt = priceTxt;
  // amounts already charged (payments rows): local currency if paid outside Egypt
  window.paidTxt = (p, field) => { const loc = p.currency && p.currency !== 'EGP'; const v = loc ? (field === 'fee' ? p.fee_local : field === 'total' ? Number(p.amount_local) + Number(p.fee_local) : p.amount_local) : (field === 'fee' ? p.fee_egp : field === 'total' ? Number(p.amount_egp) + Number(p.fee_egp) : p.amount_egp); return `${EGP(v || 0)} ${loc ? p.currency : 'ج.م'}`; };


  // ---------- tracking (Meta Pixel / GA4). Inactive until the IDs are set in config.js ----------
  // public, non-secret settings (gateways enabled, manual payment numbers, tracking IDs) from the database
  window.SITE_SETTINGS = (async () => { try { return (await sb.rpc('public_settings')) || {}; } catch { return {}; } })();
  const T0 = (window.BIOSYN && BIOSYN.TRACKING) || {};
  window.SITE_SETTINGS.then((s) => {
    const pixel = T0.META_PIXEL_ID || s.meta_pixel, ga = T0.GA4_ID || s.ga4;
    if (pixel && !window.fbq) {
      !function (f, b, e, v, n, t, x) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; x = b.getElementsByTagName(e)[0]; x.parentNode.insertBefore(t, x); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', pixel); fbq('track', 'PageView');
    }
    if (ga && !window.gtag) {
      const sc = document.createElement('script'); sc.async = true; sc.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga); document.head.appendChild(sc);
      window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); }; gtag('js', new Date());
      // content groups make GA reports readable by page type (course pages, faculty pages, checkout, dashboard…)
      const pg = document.body.dataset.page || '', fn = location.pathname.split('/').pop();
      const group = /^course-/.test(fn) || pg === 'course' ? 'course' : /^topic-/.test(fn) ? 'faculty' : /^teacher-/.test(fn) ? 'instructor' : pg || 'other';
      gtag('config', ga, Object.assign({ content_group: group }, sb.user ? { user_id: sb.user.id } : {}));
      // visits sent by AI assistants / answer engines (GEO): one event so they can be compared in GA
      const ref = document.referrer || '', utm = new URLSearchParams(location.search).get('utm_source') || '';
      const ai = (ref + ' ' + utm).match(/chatgpt|openai|perplexity|claude\.ai|anthropic|gemini\.google|bard\.google|copilot\.microsoft|bing\.com\/chat|you\.com|phind|deepseek|meta\.ai|grok|x\.ai/i);
      if (ai) gtag('event', 'ai_referral', { ai_source: ai[0].toLowerCase(), landing: fn || 'index.html' });
    }
  });
  window.track = function (name, d) {
    d = d || {};
    try {
      if (window.fbq) {
        if (name === 'view_content') fbq('track', 'ViewContent', { content_name: d.item, content_ids: [d.id], content_type: 'product' });
        else if (name === 'begin_checkout') fbq('track', 'InitiateCheckout', { value: d.value, currency: 'EGP', content_name: d.item });
        else if (name === 'purchase') fbq('track', 'Purchase', { value: d.value, currency: 'EGP' }, { eventID: d.id }); // same id as the server-side event => de-duplicated
        else if (name === 'sign_up') fbq('track', 'CompleteRegistration');
        else if (name === 'lead') fbq('track', 'Lead', { content_name: d.type });
      }
      if (window.gtag) {
        if (name === 'view_content') gtag('event', 'view_item', { items: [{ item_id: d.id, item_name: d.item }] });
        else if (name === 'begin_checkout') gtag('event', 'begin_checkout', { value: d.value, currency: 'EGP' });
        else if (name === 'purchase') gtag('event', 'purchase', { transaction_id: d.id, value: d.value, currency: 'EGP' });
        else if (name === 'sign_up') gtag('event', 'sign_up');
        else if (name === 'lead') gtag('event', 'generate_lead', { lead_type: d.type });
        else if (name === 'search') gtag('event', 'search', { search_term: d.search_term });
        else if (name === 'login') gtag('event', 'login', { method: d.method || 'email' });
        else gtag('event', name, d);
      }
    } catch (e) { /* tracking must never break the page */ }
  };


  // ---------- device id (account-sharing limit), referral capture, SEO helper ----------
  window.deviceId = () => {
    try { let d = localStorage.getItem('biosyn.device'); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('biosyn.device', d); } return d; }
    catch { return 'nostorage-' + navigator.userAgent.length + screen.width; }
  };
  window.deviceLabel = () => { const u = navigator.userAgent; const os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'جهاز'; const br = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : ''; return (br ? br + ' · ' : '') + os; };
  try { const r = new URLSearchParams(location.search).get('ref'); if (r && /^[A-Za-z0-9]{4,16}$/.test(r)) localStorage.setItem('biosyn.ref', r.toUpperCase()); } catch {}
  window.setMeta = (title, desc, image) => {
    if (title) document.title = title;
    const put = (attr, key, val) => { if (!val) return; let el = document.head.querySelector(`meta[${attr}="${key}"]`); if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); } el.setAttribute('content', val); };
    put('name', 'description', desc); put('property', 'og:title', title); put('property', 'og:description', desc); put('property', 'og:image', image);
    // course.html?c=slug and course-slug.html are the same page: point search engines at the pre-rendered one
    const q = new URLSearchParams(location.search), slug = document.body.dataset.slug || (document.body.dataset.page === 'course' && q.get('c'));
    const canon = slug ? `https://biosyneg.com/course-${encodeURIComponent(slug)}.html` : location.href.split('#')[0];
    put('property', 'og:url', canon);
    let ln = document.head.querySelector('link[rel=canonical]'); if (!ln) { ln = document.createElement('link'); ln.rel = 'canonical'; document.head.appendChild(ln); } ln.href = canon;
  };

  // ---------- AI support chat (enable with BIOSYN.SUPPORT_CHAT = true after setting ANTHROPIC_API_KEY) ----------
  async function mountSupport() {
    if (/admin|instructor|watch/.test(document.body.dataset.page || '')) return;
    const st = await window.SITE_SETTINGS;
    if (!BIOSYN.SUPPORT_CHAT && !st.support_chat) return;
    const w = document.createElement('div'); w.className = 'bx-chat';
    w.innerHTML = `<button type="button" class="bx-chat-fab" aria-expanded="false" aria-label="المساعدة">؟ مساعدة</button><section class="bx-chat-panel" hidden aria-label="مساعد Biosyn"><header><b>مساعد Biosyn</b><button type="button" data-cx aria-label="إغلاق">×</button></header><div class="bx-chat-log" aria-live="polite"><div class="bx-chat-m a">أهلاً! اسألني عن الباقات، الدفع، الشهادات أو الدورات. لأي مشكلة في حسابك راسلنا على contact@biosynegypt.com</div></div><form><input class="bx-input" maxlength="1000" placeholder="اكتب سؤالك…" aria-label="سؤالك"><button class="bs-btn bs-btn-primary bs-btn-sm" type="submit">إرسال</button></form></section>`;
    document.body.appendChild(w);
    const fab = $('.bx-chat-fab', w), panel = $('.bx-chat-panel', w), log = $('.bx-chat-log', w), form = $('form', w), inp = $('input', form);
    const hist = [];
    const toggle = (o) => { panel.hidden = !o; fab.setAttribute('aria-expanded', String(o)); if (o) inp.focus(); };
    fab.onclick = () => toggle(panel.hidden); $('[data-cx]', w).onclick = () => toggle(false);
    const add = (cls, t) => { const d = document.createElement('div'); d.className = 'bx-chat-m ' + cls; d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
    form.onsubmit = async (e) => {
      e.preventDefault(); const q = inp.value.trim(); if (!q) return; inp.value = '';
      add('u', q); hist.push({ role: 'user', content: q }); const wait = add('a', '…');
      try { const r = await sb.fn('support-chat', { messages: hist.slice(-10) }); wait.textContent = r.reply; hist.push({ role: 'assistant', content: r.reply }); }
      catch { wait.textContent = 'المساعد غير متاح الآن. راسلنا على contact@biosynegypt.com'; hist.pop(); }
    };
  }


  // ---------- theme + language switches ----------
  window.mountToggles = function () {
    const en = document.documentElement.getAttribute('data-lang') === 'en';
    const shellOnly = /(admin|instructor)\.html/.test(location.pathname);
    $$('[data-toggles]').forEach((box) => {
      if (box.dataset.ready) return; box.dataset.ready = '1';
      box.innerHTML = '' +
        (shellOnly ? '' : `<button type="button" class="bx-tg" data-no-i18n data-lang-toggle lang="${en ? 'ar' : 'en'}" aria-label="${en ? 'العربية' : 'English'}" title="${en ? 'العربية' : 'English'}">${en ? 'ع' : 'EN'}</button>`);
      const lb = $('[data-lang-toggle]', box);
      if (lb) lb.onclick = () => {
        try { localStorage.setItem('biosyn.lang', en ? 'ar' : 'en'); } catch {}
        const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.href;
      };
    });
  };

  // ---------- UI helpers ----------
  function toast(msg, kind) {
    let box = $('.bx-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'bx-toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'bx-toast' + (kind === 'err' ? ' err' : ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }
  function modal(html, onMount) {
    const back = document.createElement('div'); back.className = 'bx-modal-back';
    back.innerHTML = `<div class="bx-modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => back.remove();
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
    document.body.appendChild(back);
    if (onMount) onMount($('.bx-modal', back), close);
    return close;
  }
  window.ui = { toast, modal };

  // ---------- session / profile ----------
  let meP = null;
  window.getMe = () => {
    if (!sb.user) return Promise.resolve(null);
    if (!meP) meP = sb.one('profiles', { select: '*', id: 'eq.' + sb.user.id }).catch(() => null);
    return meP;
  };
  sb.onChange(() => { meP = null; });
  window.requireLogin = () => {
    if (sb.user) return true;
    location.href = 'login.html?next=' + encodeURIComponent(here() + location.search);
    return false;
  };

  // ---------- header, footer, drawer ----------
  function mountLayout() {
    const h = $('#site-header'), f = $('#site-footer');
    if (h) h.outerHTML = LAYOUT.header;
    if (f) f.outerHTML = LAYOUT.footer;
    const hd = $('.bs-header');
    if (hd && LAYOUT.promo && !$('.bs-promo') && !/(admin|instructor)\.html/.test(location.pathname)) hd.insertAdjacentHTML('beforebegin', LAYOUT.promo);
    const cur = here();
    $$('.bs-nav a').forEach((a) => { if (a.getAttribute('href') === cur) a.setAttribute('aria-current', 'page'); });
    // search box -> course list
    const form = $('.bx-hsearch');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); const q = $('input', form).value.trim(); if (q) track('search', { search_term: q }); location.href = 'courses.html' + (q ? '?q=' + encodeURIComponent(q) : ''); });
    // drawer for narrow screens
    const hdr = $('.bs-header');
    if (hdr && !$('.bx-drawer')) {
      const d = document.createElement('nav'); d.className = 'bx-drawer'; d.setAttribute('aria-label', 'القائمة');
      d.innerHTML = $$('.bs-nav a', hdr).map((a) => `<a href="${a.getAttribute('href')}"${a.hasAttribute('aria-current') ? ' aria-current="page"' : ''}>${esc(a.textContent.trim())}</a>`).join('') +
        (sb.user ? '' : '<a href="login.html">تسجيل الدخول</a>');
      hdr.appendChild(d);
      const btn = $('.bx-hmenu', hdr);
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.addEventListener('click', () => { const o = document.body.classList.toggle('nav-open'); btn.setAttribute('aria-expanded', String(o)); }); }
    }
  }

  async function mountUserMenu() {
    const tools = $('.bs-header-tools');
    if (!tools || !sb.user) return;
    const me = await getMe();
    const name = (me && me.full_name) || sb.user.email || 'حسابي';
    const role = me && me.role;
    $$('.bx-hlogin, a.bs-btn', tools).forEach((n) => n.remove());
    const um = document.createElement('div'); um.className = 'bx-um';
    um.innerHTML = `<button type="button" aria-haspopup="true" aria-expanded="false"><span class="bx-um-av">${esc(name.trim().charAt(0).toUpperCase())}</span>${esc(name.split(' ')[0])}</button>
      <div class="bx-um-pop" role="menu"><a href="account.html">حسابي</a>
      ${role === 'instructor' ? '<a href="instructor.html">لوحة المحاضر</a>' : ''}
      ${role === 'admin' || role === 'support' ? '<a href="admin.html">لوحة الإدارة</a>' : ''}
      ${role === 'admin' ? '<a href="instructor.html">لوحة المحاضر</a>' : ''}
      <hr><button type="button" data-out>تسجيل الخروج</button></div>`;
    tools.appendChild(um);
    const b = $('button', um);
    b.addEventListener('click', (e) => { e.stopPropagation(); const o = um.dataset.open !== 'true'; um.dataset.open = o; b.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('click', () => { um.dataset.open = 'false'; });
    $('[data-out]', um).addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'index.html'; });
    const dr = $('.bx-drawer a[href="login.html"]'); if (dr) dr.remove();
  }

  // ---------- plans + checkout ----------
  const GW = { paymob: 'Paymob', stripe: 'Stripe', fawaterk: 'فواتيرك (Fawaterk)' };
  const PAYPAL_CUR = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF'];
  let FX = null; // currency -> EGP per unit (public table), for PayPal amounts in USD
  const fxTable = async () => { if (!FX) { FX = {}; try { (await sb.get('price_regions', { select: 'currency,egp_rate' })).forEach((r) => (FX[r.currency] = Number(r.egp_rate))); } catch {} } return FX; };
  async function checkout(target) {
    if (!requireLogin()) return;
    const R = await REGION, loc = R.currency !== 'EGP';
    modal(`<h3>إتمام الدفع</h3>
      <p><b>${esc(target.title)}</b> · ${priceTxt(target.price, R, target.intl)}</p>
      <div role="radiogroup" aria-label="بوابة الدفع" style="display:grid;gap:10px"><div class="bx-loading" data-gwload>جارٍ تحميل طرق الدفع…</div></div>
      <div data-manual hidden class="bx-banner" style="display:block;margin-top:10px"></div>
      <div class="bx-coupon" style="margin:14px 0 4px" ${target.consultation ? 'hidden' : ''}><label class="bx-hint" for="cpn" style="display:block;margin-bottom:6px">هل لديك كود خصم؟</label><div style="display:flex;gap:8px"><input id="cpn" class="bx-input" dir="ltr" autocomplete="off" placeholder="WELCOME20" style="flex:1"><button type="button" class="bs-btn bs-btn-secondary" data-cpn>تطبيق</button></div><div class="bx-formmsg" data-cpnmsg aria-live="polite"></div></div>
      <p class="bx-hint">تُضاف رسوم بوابة الدفع على المبلغ، وتظهر لك قيمتها النهائية في صفحة الدفع.${loc ? ` الأسعار ظاهرة بعملة ${esc(R.name || 'بلدك')} (${esc(R.currency)}).` : ''} ${target.note || ''} بالمتابعة فأنت توافق على <a class="bx-link" href="terms.html" target="_blank">الشروط</a> و<a class="bx-link" href="refund.html" target="_blank">سياسة الاسترداد</a>.</p>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-primary" data-go>متابعة للدفع</button><button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      let coupon = '', finalPrice = target.price, pinfo = null, ppAmt = null;
      const mbox = $('[data-manual]', m), rg = $('[role=radiogroup]', m);
      const drawManual = () => {
        const v = ($('input[name=gw]:checked', m) || {}).value || '';
        if (!v.startsWith('manual:')) { mbox.hidden = true; $('[data-go]', m).textContent = 'متابعة للدفع'; return; }
        if (v === 'manual:paypal') {
          // PayPal takes the visitor's currency when it can, otherwise the same value in USD
          const L0 = itemPrice(target.price, target.intl, R), L = Number(target.price) > 0 ? Math.round(L0 * (finalPrice / Number(target.price)) * 100) / 100 : 0;
          let cur = R.currency, amt = L;
          if (!PAYPAL_CUR.includes(cur)) { const f = FX || {}; amt = f[cur] && f.USD ? Math.ceil((L * f[cur] / f.USD) * 100) / 100 : L; cur = 'USD'; }
          ppAmt = { cur, amt };
          const link = `https://paypal.me/${encodeURIComponent(pinfo.paypal)}/${amt}${cur}`;
          mbox.hidden = false; $('[data-go]', m).textContent = 'دفعت على PayPal';
          mbox.innerHTML = `<b>ادفع ${EGP(amt)} ${cur} على PayPal</b>${cur !== R.currency ? `<small> (تعادل ${EGP(L)} ${esc(R.symbol)})</small>` : ''}<br><a class="bs-btn bs-btn-secondary bs-btn-sm" style="margin:8px 0" href="${esc(link)}" target="_blank" rel="noopener">افتح PayPal وادفع ←</a><br><small>بعد الدفع اكتب رقم العملية (Transaction ID) أو بريد PayPal الذي دفعت منه. يتم التفعيل تلقائيًا فور تأكيد الفريق وصول المبلغ (عادةً خلال ساعات).</small><input id="mref" class="bx-input" dir="ltr" maxlength="120" placeholder="Transaction ID / PayPal email" style="margin-top:8px;width:100%">`;
          return;
        }
        const isI = v === 'manual:instapay', to = isI ? pinfo.instapay : pinfo.vodafone_cash;
        mbox.hidden = false; $('[data-go]', m).textContent = 'أرسلت التحويل';
        mbox.innerHTML = `<b>حوّل ${EGP(finalPrice)} ج.م ${isI ? 'عبر إنستاباي إلى' : 'على محفظة فودافون كاش رقم'}:</b> <span class="bs-latin" dir="ltr" style="font-weight:700">${esc(to)}</span><br><small>بعد التحويل اكتب رقم العملية أو الرقم الذي حوّلت منه، وارفع لقطة شاشة للتحويل. يُفعَّل اشتراكك بعد مراجعة الفريق (عادةً خلال ساعات العمل).</small><input id="mref" class="bx-input" dir="ltr" maxlength="120" placeholder="${isI ? 'رقم العملية' : '01xxxxxxxxx'}" style="margin-top:8px;width:100%">
          <label class="bx-proof" for="mproof"><input id="mproof" type="file" accept="image/*,application/pdf" required><span class="bx-proof-box" data-proofname><b>📎 ارفع سكرين التحويل</b><small>إجباري · صورة أو PDF حتى 6 ميجابايت</small></span></label>`;
        const fi = $('#mproof', m);
        fi.onchange = () => {
          const f = fi.files[0], lab = $('[data-proofname]', m);
          if (!f) { lab.innerHTML = '<b>📎 ارفع سكرين التحويل</b><small>إجباري · صورة أو PDF حتى 6 ميجابايت</small>'; lab.parentElement.classList.remove('ok'); return; }
          lab.innerHTML = `<b>✓ ${esc(f.name.length > 34 ? f.name.slice(0, 31) + '…' : f.name)}</b><small>${(f.size / 1048576).toFixed(1)} ميجابايت · اضغط للتغيير</small>`; lab.parentElement.classList.add('ok');
        };
      };
      Promise.all([window.SITE_SETTINGS, loc ? fxTable() : null]).then(([pi]) => {
        pinfo = pi || {};
        let online = (Array.isArray(pinfo.gateways) && pinfo.gateways.length ? pinfo.gateways : (BIOSYN.GATEWAYS_FALLBACK || [])).filter((g) => GW[g]);
        if (loc) online = online.filter((g) => (R.gateways || ['stripe']).includes(g));   // foreign currency: card gateways only
        const opts = online.map((g) => [g, GW[g], g === 'fawaterk' ? (loc ? 'بطاقة بنكية (فيزا / ماستركارد) ومحافظ وطرق دفع أخرى' : 'بطاقة، محافظ إلكترونية، فوري، أمان') : loc ? `دفع بالبطاقة بـ${R.currency}` : 'دفع إلكتروني آمن · بطاقة أو محفظة']);
        if (loc && pinfo.paypal) opts.push(['manual:paypal', 'PayPal', 'ادفع من حسابك على PayPal']);
        if (!loc && pinfo.instapay) opts.push(['manual:instapay', 'إنستاباي', 'تحويل يدوي · بدون رسوم']);
        if (!loc && pinfo.vodafone_cash) opts.push(['manual:vodafone_cash', 'فودافون كاش', 'تحويل يدوي · بدون رسوم']);
        // Fawaterk's own method logos (copied to our public bucket); Fawry / Aman / wallets are Egypt-only
        const LOGO = (f) => `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-assets/pay/${f}.png`;
        const fwLogos = (loc ? [['visa-mastercard', 'Visa / Mastercard']] : [['visa-mastercard', 'Visa / Mastercard'], ['wallets', 'المحافظ الإلكترونية'], ['fawry', 'فوري'], ['aman', 'أمان']])
          .map(([f, a]) => `<img src="${LOGO(f)}" alt="${a}" title="${a}" loading="lazy" onerror="this.remove()">`).join('');
        rg.innerHTML = opts.length ? opts.map(([k, n, s], i) => `<label class="bx-opt"><input type="radio" name="gw" value="${k}" ${i === 0 ? 'checked' : ''}><b>${n}</b><small>${s}</small>${k === 'fawaterk' ? `<span class="bx-paylogos" aria-hidden="true">${fwLogos}</span>` : ''}</label>`).join('')
          : `<div class="bx-formmsg err">${loc ? `الدفع من بلدك غير متاح بعد. تواصل معنا على contact@biosynegypt.com وسنفعّل اشتراكك يدويًا.` : 'الدفع غير متاح حاليًا. تواصل معنا على contact@biosynegypt.com'}</div>`;
        $('[data-go]', m).disabled = !opts.length;
        $$('input[name=gw]', m).forEach((r) => (r.onchange = drawManual));
        drawManual();
      });
      const cm = $('[data-cpnmsg]', m), priceEl = $('p b', m).parentElement;
      let saved = ''; try { saved = localStorage.getItem('biosyn.code') || ''; } catch {}
      if (saved) setTimeout(() => { $('#cpn', m).value = saved; $('[data-cpn]', m).click(); }, 0);
      $('[data-cpn]', m).onclick = async (ev) => {
        const cbtn = ev.currentTarget, code = $('#cpn', m).value.trim(); coupon = ''; cm.className = 'bx-formmsg';
        if (!code) { cm.textContent = ''; priceEl.innerHTML = `<b>${esc(target.title)}</b> · ${priceTxt(target.price, R, target.intl)}`; return; }
        cbtn.disabled = true;
        try {
          const q = await sb.rpc('validate_coupon', { p_code: code, p_plan_code: target.plan_code || null, p_course: target.course_id || null });
          coupon = code; finalPrice = Number(q.final); drawManual && drawManual(); cm.className = 'bx-formmsg ok';
          const L = itemPrice(target.price, target.intl, R), F = Number(q.list) > 0 ? Math.round(L * (Number(q.final) / Number(q.list)) * 100) / 100 : 0;
          cm.textContent = `تم تطبيق الكود: خصم ${EGP(Math.round((L - F) * 100) / 100)} ${curOf(R)}` + (Number(q.final) === 0 ? ' (مجاني بالكامل)' : '');
          priceEl.innerHTML = `<b>${esc(target.title)}</b> · <s class="bx-muted">${EGP(L)}</s> <b>${EGP(F)} ${curOf(R)}</b>`;
          track('add_coupon', { code });
        } catch (e) { finalPrice = target.price; drawManual(); cm.className = 'bx-formmsg err'; cm.textContent = arErr(e); priceEl.innerHTML = `<b>${esc(target.title)}</b> · ${priceTxt(target.price, R, target.intl)}`; }
        cbtn.disabled = false;
      };
      $('[data-go]', m).onclick = async (ev) => {
        const msg = $('.bx-formmsg:not([data-cpnmsg])', m), btn = ev.currentTarget; btn.disabled = true; msg.className = 'bx-formmsg'; msg.textContent = 'جارٍ تجهيز صفحة الدفع…';
        const gwv = ($('input[name=gw]:checked', m) || {}).value || '';
        if (!gwv) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = 'اختر طريقة الدفع.'; return; }
        if (gwv.startsWith('manual:')) {
          const ref = ($('#mref', m) || {}).value || '';
          if (!ref.trim()) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = 'اكتب رقم العملية أو الرقم الذي حوّلت منه.'; return; }
          const needProof = gwv !== 'manual:paypal', file = needProof && ($('#mproof', m) || {}).files ? $('#mproof', m).files[0] : null;
          if (needProof && !file) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = 'ارفع صورة (سكرين) التحويل الأول.'; return; }
          if (file && (file.size > 6 * 1048576 || !/^(image\/|application\/pdf)/.test(file.type || ''))) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = 'يجب أن يكون الملف صورة أو PDF وحجمه أقل من 6 ميجابايت.'; return; }
          try {
            const pp = gwv === 'manual:paypal' && ppAmt;
            let proof = null;
            if (file) {
              msg.textContent = 'جارٍ رفع صورة التحويل…';
              const ext = ((file.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || (file.type.split('/')[1] || 'jpg')).toLowerCase();
              proof = await sb.storage.upload('payment-proofs', `${sb.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, file);
            }
            const r = await sb.rpc('create_manual_payment_v3', { p_method: gwv.slice(7), p_ref: ref.trim(), p_proof: proof, p_plan_code: target.plan_code || null, p_course: target.course_id || null, p_coupon: coupon || null, p_request: target.consultation || null, p_currency: pp ? ppAmt.cur : 'EGP', p_amount_local: pp ? ppAmt.amt : null });
            track('begin_checkout', { value: finalPrice, item: target.title, id: target.plan_code || target.course_id });
            msg.className = 'bx-formmsg ok';
            msg.textContent = r.status === 'paid' ? 'تم التفعيل!' : target.consultation ? 'استلمنا طلبك. سنراجع التحويل ونتواصل معك لتحديد موعد الاستشارة.' : 'استلمنا طلبك. سنراجع التحويل ونفعّل اشتراكك، وسيصلك بريد بالتأكيد.';
            setTimeout(() => (location.href = 'account.html#payments'), 2500);
          } catch (e) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = arErr(e); }
          return;
        }
        try {
          const body = { gateway: gwv, return_url: new URL('account.html', location.href).href };
          if (target.plan_code) body.plan_code = target.plan_code; else if (target.consultation) body.consultation = target.consultation; else body.course_id = target.course_id;
          if (coupon) body.coupon = coupon;
          track('begin_checkout', { value: target.price, item: target.title, id: target.plan_code || target.course_id });
          const r = await sb.fn('create-checkout', body);
          location.href = r.url;
        } catch (e) {
          btn.disabled = false; msg.className = 'bx-formmsg err';
          msg.textContent = e.status === 401 ? 'انتهت جلستك، سجّل الدخول من جديد.' : arErr(e.data && e.data.error ? { message: e.data.error } : e);
        }
      };
    });
  }
  window.checkout = checkout;

  const periodAr = (m) => (m === 1 ? 'مدة شهر واحد' : m === 12 ? 'صلاحية 12 شهرًا' : m < 11 ? `صلاحية ${m} أشهر` : `صلاحية ${m} شهرًا`);
  async function hydratePlans() {
    const cards = $$('.bs-plan');
    if (!cards.length) return;
    let plans; try { plans = await sb.get('plans', { select: '*', active: 'eq.true', order: 'duration_months' }); } catch { return; }
    const R = await REGION;
    cards.forEach((card, i) => {
      const p = plans[i];
      if (!p) { card.remove(); return; }
      $('.bs-plan-name', card).textContent = p.name;
      const abroad = R.currency !== 'EGP';
      $('.bs-plan-price b', card).textContent = EGP(itemPrice(p.price_egp, p.intl_price, R));
      const cu = $('.bs-plan-price span', card); if (cu) cu.textContent = curOf(R);
      const old = abroad ? 0 : Number(p.old_price_egp);   // the "was" price is an Egypt-only promotion
      $('.bs-plan-period', card).textContent = (old > p.price_egp ? `السعر السابق ${EGP(old)} · ` : '') + periodAr(p.duration_months);
      const badge = $('.bs-badge', card);
      if (badge) { if (old > p.price_egp) badge.textContent = `وفر ${Math.round((1 - p.price_egp / old) * 100)}٪`; else badge.remove(); }
      const cta = $('.bs-plan-cta', card);
      card.dataset.plan = p.code; card.dataset.months = p.duration_months;
      if (cta) cta.addEventListener('click', () => checkout({ plan_code: p.code, title: p.name, price: p.price_egp, intl: p.intl_price, note: (card.dataset.upnote || '') + 'الاشتراك لا يتجدد تلقائيًا ولا يمكن استرداده.' }));
    });
    planState(cards);
  }

  // signed-in subscriber: mark the current plan, offer upgrades to longer plans, renewals only in the last 7 days
  // (the server enforces the same rule in create_pending_payment)
  async function planState(cards) {
    if (!window.sb || !sb.user) return;
    let st; try { st = await sb.rpc('my_plan_state'); } catch { return; }
    if (!st || !st.plan_code) return;
    const end = new Date(st.ends_at).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
    const left = st.days_left === 1 ? 'يوم واحد' : st.days_left === 2 ? 'يومين' : st.days_left <= 10 ? `${st.days_left} أيام` : `${st.days_left} يوم`;
    const wrap = cards[0] && cards[0].closest('.bs-plans');
    if (wrap && !document.querySelector('.bx-planstate')) {
      wrap.insertAdjacentHTML('beforebegin', `<div class="bx-planstate" role="status"><span>أنت مشترك في <b>${esc(st.plan_name)}</b> حتى ${esc(end)} · المتبقي ${left}</span>${st.renew_open ? '<span class="bx-hint">يمكنك التجديد الآن، وستبدأ المدة الجديدة بعد انتهاء المدة الحالية.</span>' : '<span class="bx-hint">يمكنك الترقية إلى باقة أطول في أي وقت، ولن تضيع الأيام المتبقية.</span>'}</div>`);
    }
    cards.forEach((card) => {
      const cta = $('.bs-plan-cta', card); if (!cta || !card.dataset.plan) return;
      const months = Number(card.dataset.months), same = card.dataset.plan === st.plan_code;
      const note = (t) => { let n = $('.bx-plan-note', card); if (!n) { n = document.createElement('small'); n.className = 'bx-plan-note'; cta.after(n); } n.textContent = t; };
      if (same) {
        card.classList.add('is-current');
        const b = $('.bs-badge', card) || $('.bs-plan-top', card).appendChild(Object.assign(document.createElement('span'), { className: 'bs-badge' }));
        b.textContent = 'باقتك الحالية'; b.className = 'bs-badge bs-badge-new';
      }
      if (st.renew_open) { cta.textContent = same ? 'جدّد الباقة' : months > st.duration ? 'جدّد بباقة أطول ↑' : 'جدّد بهذه الباقة'; card.dataset.upnote = `تبدأ المدة الجديدة بعد انتهاء اشتراكك الحالي (${end}). `; return; }
      if (months > st.duration) {
        cta.textContent = 'رقِّ إلى هذه الباقة ↑'; cta.classList.replace('bs-btn-secondary', 'bs-btn-primary');
        card.dataset.upnote = `تُضاف الترقية بعد اشتراكك الحالي (${end})، فلن تخسر أي يوم. `;
        note('الأيام المتبقية من باقتك محسوبة');
        return;
      }
      cta.setAttribute('aria-disabled', 'true'); cta.disabled = true;
      cta.textContent = same ? `مشترك حتى ${end}` : 'باقتك الحالية أطول';
      note(same ? 'يُتاح التجديد في آخر 7 أيام' : 'متاحة للتجديد في آخر 7 أيام');
    });
  }

  window.hydratePlansNow = hydratePlans;

  // ---------- catalogue ----------
  window.courseCard = (c, inst, nLect, href) => `<a class="bs-course" href="${href || 'course-' + encodeURIComponent(c.slug) + '.html'}"><div class="bs-cover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span><span class="bs-cover-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</span>${c.cover_url ? `<img class="bs-cover-img" src="${esc(c.cover_url)}" alt="" loading="lazy">` : ''}</div><div class="bs-course-body"><span class="bs-course-kind">${c.kind === 'interactive' ? 'دورة تفاعلية' : 'دورة مسجلة'}</span><h3 class="bs-course-title">${esc(c.title)}</h3><div class="bs-course-meta">${nLect != null ? `<span>${nLect} محاضرة</span>` : ''}${c.kind === 'recorded' ? `<span>${LEVEL[c.level] || ''}</span>` : `<span>${EGP(c.price_egp)} ج.م</span>`}${inst ? `<span>${esc(inst)}</span>` : ''}</div></div></a>`;

  async function loadCatalog(kind) {
    const [courses, insts, feat] = await Promise.all([
      sb.get('courses', { select: '*,lectures(id)', kind: 'eq.' + kind, status: 'eq.published', order: 'created_at.desc' }),
      sb.get('public_instructors', { select: '*' }).catch(() => []),
      sb.get('featured_instructors', { select: 'id,name' }).catch(() => []),
    ]);
    const names = Object.fromEntries(insts.map((i) => [i.id, i.full_name]));
    const fnames = Object.fromEntries(feat.map((i) => [i.id, i.name]));
    return courses.map((c) => ({ ...c, n: (c.lectures || []).length, inst: (c.featured_instructor_ids || []).map((id) => fnames[id]).filter(Boolean).join('، ') || fnames[c.featured_instructor_id] || names[c.instructor_id] || '' }));
  }
  window.loadCatalog = loadCatalog;

  async function pageCourses() {
    const grid = $('.bs-grid'); if (!grid) return;
    grid.innerHTML = '<div class="bx-loading" style="grid-column:1/-1">جارٍ تحميل الدورات…</div>';
    let all = [];
    try { all = await loadCatalog('recorded'); } catch (e) { grid.innerHTML = `<div class="bx-empty-big" style="grid-column:1/-1"><b>تعذّر تحميل الدورات</b>${esc(arErr(e))}</div>`; return; }
    const q = $('#q'), sel = $('#inst'), sort = $('.bx-catalog-live select, .bx-sortsel');
    const chips = $('.bx-chips'), facSel = $('#fac'), specSel = $('#spec');
    const FAC = window.FACULTIES || [];
    const u0 = new URL(location.href);
    let fac = FAC.some((f) => f.id === u0.searchParams.get('f')) ? u0.searchParams.get('f') : '';
    let spec = u0.searchParams.get('s') || '';
    all.forEach((c) => (c.fac = window.facultyOf ? window.facultyOf(c) : ''));
    function fillSpecs() {
      if (!specSel) return;
      const f = FAC.find((x) => x.id === fac);
      const extra = [...new Set(all.filter((c) => (!fac || c.fac === fac) && c.specialty).map((c) => c.specialty))];
      const list = [...new Set([...(f ? f.specs : FAC.flatMap((x) => x.specs)), ...extra])].filter((x) => x !== ALL_SPECS);
      if (spec && !list.includes(spec)) spec = '';
      specSel.innerHTML = '<option value="">كل التخصصات</option>' + list.map((s) => `<option ${s === spec ? 'selected' : ''}>${esc(s)}</option>`).join('');
    }
    function syncFac() {
      if (chips) $$('.bx-chip', chips).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === fac)));
      if (facSel) facSel.value = fac;
      fillSpecs();
      const nu = new URL(location.href); fac ? nu.searchParams.set('f', fac) : nu.searchParams.delete('f'); spec ? nu.searchParams.set('s', spec) : nu.searchParams.delete('s');
      history.replaceState(null, '', nu);
    }
    if (chips) {
      chips.innerHTML = [{ id: '', name: 'كل الكليات' }, ...FAC].map((f) => `<button class="bx-chip" aria-pressed="false" data-f="${f.id}">${esc(f.name)}</button>`).join('');
      chips.addEventListener('click', (e) => { const b = e.target.closest('.bx-chip'); if (!b) return; fac = b.dataset.f; spec = ''; syncFac(); draw(); });
    }
    if (facSel) {
      facSel.innerHTML = '<option value="">كل الكليات</option>' + FAC.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
      facSel.addEventListener('change', () => { fac = facSel.value; spec = ''; syncFac(); draw(); });
    }
    if (specSel) specSel.addEventListener('change', () => { spec = specSel.value; syncFac(); draw(); });
    if (sel) sel.innerHTML = '<option value="">كل المحاضرين</option>' + [...new Set(all.map((c) => c.inst).filter(Boolean))].map((n) => `<option>${esc(n)}</option>`).join('');
    const lv = $$('.bx-side-group:first-child input[type=checkbox]');
    lv.forEach((c) => (c.checked = false));
    const url = new URL(location.href); if (q && url.searchParams.get('q')) q.value = url.searchParams.get('q');
    function draw() {
      const t = (q ? q.value : '').trim().toLowerCase();
      const levels = lv.map((c, i) => (c.checked ? ['beginner', 'intermediate', 'advanced'][i] : null)).filter(Boolean);
      let list = all.filter((c) => (!t || (c.title + ' ' + c.inst).toLowerCase().includes(t)) && (!fac || c.fac === fac || c.fac === 'all') && (!spec || c.specialty === spec || c.specialty === ALL_SPECS) && (!levels.length || (LEVEL_SPAN[c.level] || [c.level]).some((l) => levels.includes(l))) && (!sel || !sel.value || c.inst === sel.value));
      const s = sort ? sort.selectedIndex : 0;
      if (s === 3) list.sort((a, b) => a.title.localeCompare(b.title)); else if (s === 2) list.reverse();
      grid.innerHTML = list.length ? list.map((c) => courseCard(c, c.inst, c.n)).join('') : `<div class="bx-empty-big" style="grid-column:1/-1"><b>${all.length ? 'لا توجد نتائج مطابقة' : 'لا توجد دورات منشورة بعد'}</b>${all.length ? 'جرّب تغيير البحث أو الفلاتر.' : 'سنضيف الدورات هنا فور نشرها.'}</div>`;
      const cnt = $('.bx-count'); if (cnt) cnt.textContent = `${list.length} دورة`;
    }
    [q, sel, sort, ...lv].forEach((el) => el && el.addEventListener('input', draw));
    const go = $('.bx-pagehead .bs-btn-primary'); if (go) go.addEventListener('click', draw);
    const clear = $$('.bx-side .bs-btn-ghost')[0]; if (clear) clear.addEventListener('click', () => { lv.forEach((c) => (c.checked = false)); fac = ''; spec = ''; syncFac(); if (sel) sel.value = ''; if (q) q.value = ''; draw(); });
    syncFac();
    draw();
  }

  // interactive programme card (also used on the course page facts)
  const facOf = (c) => { const id = window.facultyOf ? window.facultyOf(c) : c.faculty; return id === 'all' ? window.FAC_ALL : (window.FACULTIES || []).find((f) => f.id === id); };
  const fmtDay = (d) => { try { return new Date(d).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  window.facOf = facOf; window.fmtDay = fmtDay;
  const ICO = {
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    seat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    lvl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V14M10 20V9M16 20V4"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    live: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
  };
  window.BX_ICO = ICO;
  function programCard(c) {
    const f = facOf(c), href = `course-${encodeURIComponent(c.slug)}.html`;
    const facts = [
      c.starts_at ? `<li>${ICO.cal}<span>يبدأ ${esc(fmtDay(c.starts_at))}</span></li>` : '',
      c.seats ? `<li>${ICO.seat}<span>${c.seats} مقعد</span></li>` : '',
      LEVEL[c.level] ? `<li>${ICO.lvl}<span>${LEVEL[c.level]}</span></li>` : '',
      `<li>${ICO.user}<span>${esc(c.inst || 'فريق Biosyn')}</span></li>`,
    ].join('');
    return `<article class="bx-pcard">
      <a class="bx-pcard-cover" href="${href}" tabindex="-1" aria-hidden="true"><span class="bs-wm bs-wm-brand"></span>
        <span class="bx-pcard-live">${ICO.live}مباشر أونلاين</span>
        <span class="bx-pcard-ic">${f ? `<svg viewBox="0 0 24 24">${f.icon}</svg>` : ICO.live}</span>
        ${f ? `<span class="bx-pcard-fac">${esc(f.name)}</span>` : ''}</a>
      <div class="bx-pcard-body">
        ${c.specialty ? `<span class="bx-pcard-tag">${esc(c.specialty)}</span>` : ''}
        <h3><a href="${href}" dir="auto">${esc(c.title)}</a></h3>
        ${c.summary ? `<p class="bx-pcard-sum">${esc(c.summary)}</p>` : ''}
        <ul class="bx-pcard-facts">${facts}</ul>
      </div>
      <div class="bx-pcard-foot"><div class="bx-pcard-price"><b>${EGP(itemPrice(c.price_egp, c.intl_price, window.REGION_NOW))}</b><small>${curOf(window.REGION_NOW)}</small></div><a href="${href}" class="bs-btn bs-btn-primary">التفاصيل والتسجيل</a></div>
    </article>`;
  }
  async function pageInteractive() {
    const box = $('.bx-programs'); if (!box) return;
    let all = []; try { [all] = await Promise.all([loadCatalog('interactive'), REGION]); } catch { all = []; }
    const cnt = $('#ic-count'); if (cnt) cnt.textContent = all.length ? `${all.length} ${all.length === 1 ? 'برنامج' : 'برامج'}` : '';
    if (all.length) { box.innerHTML = all.map(programCard).join(''); box.classList.toggle('bx-pgrid-one', all.length === 1); }
    else box.innerHTML = '<div class="bx-empty-big" style="grid-column:1/-1"><b>لا توجد دورات تفاعلية مفتوحة للتسجيل حاليًا</b>سنعلن عن الدفعة القادمة قريبًا. <a class="bx-link" href="consultations.html">تواصل معنا</a></div>';
  }


  async function pageHome() {
    // platform numbers: live from the database (public_stats); zeros are shown as-is until launch
    (async () => {
      const band = $('#stats'); if (!band) return;
      let st = {}; try { st = (await sb.rpc('public_stats')) || {}; } catch (e) { /* keep zeros */ }
      const shown = $$('[data-k]', band);
      shown.forEach((el) => (el.dataset.count = Number(st[el.dataset.k]) || 0));
      const fmt = (n) => Math.round(n).toLocaleString('en-US');
      if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { shown.forEach((el) => (el.textContent = fmt(+el.dataset.count))); return; }
      const io = new IntersectionObserver((ents) => ents.forEach((en) => {
        if (!en.isIntersecting) return; io.unobserve(en.target);
        const el = en.target, to = +el.dataset.count, t0 = performance.now(), d = 1400;
        const step = (t) => { const k = Math.min(1, (t - t0) / d); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }), { threshold: 0.4 });
      shown.forEach((el) => io.observe(el));
    })();
    const grid = $('.bs-grid'); if (!grid) return;
    let all = []; try { all = await loadCatalog('recorded'); } catch { return; }
    const draw = (list) => { grid.innerHTML = list.length ? list.slice(0, 6).map((c) => courseCard(c, c.inst, c.n)).join('') : '<div class="bx-empty-big" style="grid-column:1/-1"><b>الدورات قريبًا</b>سنضيفها هنا فور نشرها.</div>'; };
    draw(all);
    const tabs = $$('.bs-tabs [role=tab]');
    tabs.forEach((t, i) => t.addEventListener('click', () => { tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t))); draw(i === 2 ? [...all].reverse() : all); }));
  }

  // ---------- request forms (instructor / institution / consultation) ----------
  const PERSONAL_DOMAINS = new Set('gmail.com googlemail.com yahoo.com yahoo.co.uk ymail.com rocketmail.com hotmail.com hotmail.co.uk outlook.com outlook.sa live.com msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me yandex.com yandex.ru mail.ru gmx.com gmx.de zoho.com zohomail.com tutanota.com tuta.io mail.com inbox.com hushmail.com qq.com 163.com 126.com yahoo.fr hotmail.fr live.fr windowslive.com'.split(' '));
  const PERSONAL_MAIL = { test: (e) => PERSONAL_DOMAINS.has(String(e).split('@').pop().trim().toLowerCase()) };
  function wireRequestForm(form, type, ids) {
    if (!form) return;
    const btn = $('button.bs-btn-primary', form); if (!btn) return;
    const msg = document.createElement('div'); msg.className = 'bx-formmsg'; msg.setAttribute('aria-live', 'polite'); btn.parentElement.after(msg);
    btn.addEventListener('click', async () => {
      const f = {};
      $$('input,select,textarea', form).forEach((el) => {
        if (el.type === 'checkbox') return;
        const lab = el.id && $(`label[for="${el.id}"]`, form);
        const key = (lab ? lab.textContent : el.getAttribute('aria-label') || el.id || '').trim();
        if (key) f[key] = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value.trim();
      });
      const get = (id) => ($('#' + id, form) ? $('#' + id, form).value.trim() : '');
      const name = get(ids.name), email = get(ids.email), phone = ids.phone ? get(ids.phone) : '';
      const consent = $('input[type=checkbox]', form);
      msg.className = 'bx-formmsg err';
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = 'اكتب الاسم وبريدًا إلكترونيًا صحيحًا.'; return; }
      const blank = $$('select', form).find((el) => !el.value && /\*/.test((el.id && $(`label[for="${el.id}"]`, form) || {}).textContent || ''));
      if (blank) { msg.textContent = 'اختر ' + $(`label[for="${blank.id}"]`, form).textContent.replace('*', '').trim() + '.'; blank.focus(); return; }
      if (consent && !consent.checked) { msg.textContent = 'يرجى الموافقة على الشروط للمتابعة.'; return; }
      if (type === 'institution' && PERSONAL_MAIL.test(email)) { msg.textContent = 'من فضلك استخدم البريد الإلكتروني للجهة (مثل name@university.edu.eg)، وليس بريدًا شخصيًا مثل Gmail أو Yahoo.'; return; }
      btn.disabled = true; msg.className = 'bx-formmsg'; msg.textContent = 'جارٍ الإرسال…';
      try {
        window.track && track('lead', { type });
        await sb.insertQuiet('requests', { type, name, email, phone: phone || null, payload: f, user_id: sb.user ? sb.user.id : null }, !!sb.user);
        msg.className = 'bx-formmsg ok'; msg.textContent = /^instructor/.test(type) ? 'وصل طلبك. سنراجعه ونتواصل معك على بريدك الإلكتروني. تقديم الطلب لا يعني القبول.' : 'وصل طلبك، وسيتواصل معك فريق Biosyn قريبًا.';
        form.reset();
      } catch (e) { msg.className = 'bx-formmsg err'; msg.textContent = /institution email/.test(e.message || '') ? 'من فضلك استخدم البريد الإلكتروني للجهة، وليس بريدًا شخصيًا.' : arErr(e); }
      btn.disabled = false;
    });
  }

  function pageTeach() {
    const forms = $$('form.bx-form');
    wireRequestForm(forms.find((f) => $('#r-n', f)), 'instructor_recorded', { name: 'r-n', email: 'r-e' });
    wireRequestForm(forms.find((f) => $('#i-n', f)), 'instructor_interactive', { name: 'i-n', email: 'i-e' });
    wireRequestForm(forms.find((f) => $('#h-n', f)), 'instructor_recording_help', { name: 'h-n', email: 'h-e', phone: 'h-p' });
    // earnings calculator (illustrative)
    const inc = $('#c-inc'), tv = $('#c-tv'), cv = $('#c-cv'); if (!inc) return;
    const fmt = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    const tiles = $$('.bx-calc-tile'); const warn = $('.bx-calc-warn');
    const draw = () => {
      const I = +inc.value || 0, T = +tv.value || 0, C = +cv.value || 0;
      const per = T > 0 ? I / T : 0, val = per * C;
      const set = (i, big, small) => { const t = tiles[i]; if (!t) return; $('b', t).innerHTML = `${big} <small>ج.م</small>`; if (small !== undefined && t.querySelectorAll(':scope > small').length) t.querySelector(':scope > small').textContent = small; };
      set(0, fmt(per, 2)); set(1, fmt(val, 2), `${fmt(C)} مشاهدة × ${fmt(per, 2)} ج.م`); set(2, fmt(val * 0.3, 2)); set(3, fmt(val * 0.7, 2));
      if (warn) warn.style.display = T > 0 && C > T ? '' : 'none';
    };
    [inc, tv, cv].forEach((e) => e.addEventListener('input', draw)); draw();
  }

  function pageInstitutions() { wireRequestForm($('form.bx-formcard'), 'institution', { name: 'o-c', email: 'o-e', phone: 'o-p' }); }
  // paid consultation: fixed price (EGP in Egypt, intl price in the visitor's currency abroad), request first then checkout
  async function pageConsultations() {
    const form = $('form.bx-formcard'); if (!form) return;
    const [S, R] = await Promise.all([window.SITE_SETTINGS.catch(() => ({})), REGION]);
    const price = Number((S && S.consultation_price) || 1500), intl = S && S.consultation_intl != null ? Number(S.consultation_intl) : null;
    const cp = $('[data-cp]', form); if (cp) cp.textContent = priceTxt(price, R, intl);
    const btn = $('button.bs-btn-primary', form);
    const msg = document.createElement('div'); msg.className = 'bx-formmsg'; msg.setAttribute('aria-live', 'polite'); btn.parentElement.after(msg);
    const fields = () => { const f = {}; $$('input,select,textarea', form).forEach((el) => { const lab = el.id && $(`label[for="${el.id}"]`, form); if (lab) f[lab.textContent.replace('*', '').trim()] = el.tagName === 'SELECT' ? (el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '') : el.value.trim(); }); return f; };
    const KEY = 'biosyn.cons';
    // back from login/signup: restore what they typed
    try { const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && sb.user) { Object.entries(saved).forEach(([id, v]) => { const el = $('#' + id, form); if (el) el.value = v; }); msg.className = 'bx-formmsg ok'; msg.textContent = 'استعدنا بياناتك. اضغط «احجز وادفع» للمتابعة.'; } } catch {}
    if (sb.user && !$('#c-e', form).value) $('#c-e', form).value = sb.user.email || '';
    btn.addEventListener('click', async () => {
      const g = (id) => $('#' + id, form).value.trim();
      msg.className = 'bx-formmsg err';
      if ($('#c-s', form).selectedIndex < 1) { msg.textContent = 'اختر نوع الاستشارة.'; return; }
      if (!g('c-n') || !/^\S+@\S+\.\S+$/.test(g('c-e'))) { msg.textContent = 'اكتب الاسم وبريدًا إلكترونيًا صحيحًا.'; return; }
      if (g('c-m').length < 10) { msg.textContent = 'اكتب ملخص احتياجك (10 حروف على الأقل).'; return; }
      if (!sb.user) {
        try { const keep = {}; $$('input,select,textarea', form).forEach((el) => el.id && (keep[el.id] = el.value)); sessionStorage.setItem(KEY, JSON.stringify(keep)); } catch {}
        location.href = 'login.html?mode=signup&next=consultations.html'; return;
      }
      btn.disabled = true; msg.className = 'bx-formmsg'; msg.textContent = 'جارٍ تجهيز الحجز…';
      try {
        const id = await sb.rpc('create_consultation', { p_name: g('c-n'), p_email: g('c-e'), p_phone: g('c-p') || null, p_payload: fields() });
        try { sessionStorage.removeItem(KEY); } catch {}
        window.track && track('lead', { type: 'consultation' });
        msg.className = 'bx-formmsg ok'; msg.textContent = 'تم تسجيل طلبك. أكمل الدفع لنؤكد الحجز ونحدد الموعد.';
        checkout({ consultation: id, title: 'استشارة: ' + $('#c-s', form).options[$('#c-s', form).selectedIndex].text, price, intl, note: 'بعد الدفع سيتواصل معك فريق Biosyn لتحديد موعد الاستشارة.' });
      } catch (e) { msg.className = 'bx-formmsg err'; msg.textContent = arErr(e); }
      btn.disabled = false;
    });
  }


  // ---------- instructors (featured_instructors table, managed from Admin) ----------
  const initials = (n) => String(n || '').replace(/^(د|أ\.?د|م)\.\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w.replace(/^ال(?=..)/, '').charAt(0)).join(' ');
  window.instInitials = initials;
  function instCard(i) {
    const ph = i.photo_url ? `<img src="${esc(i.photo_url)}" alt="${esc(i.name)}" loading="lazy">` : `<span>${esc(initials(i.name))}</span>`;
    return `<div class="bs-inst"><div class="bs-inst-photo">${ph}</div><h3 class="bs-inst-name">${esc(i.name)}</h3>${i.title ? `<p class="bs-inst-role">${esc(i.title)}</p>` : ''}</div>`;
  }
  async function loadInstructors() {
    return sb.get('featured_instructors', { select: 'id,name,title,photo_url,faculty,sort', visible: 'eq.true', order: 'sort.asc,created_at.asc' });
  }
  async function mountInstStrip() {
    const box = $('[data-inst-strip]'); if (!box) return;
    let list = []; try { list = await loadInstructors(); } catch (e) { return; }
    if (!list.length) { box.closest('section').hidden = true; return; }
    const cards = list.map(instCard).join('');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = `<div class="bx-mq-track"><div class="bx-mq-half">${cards}</div>${reduce ? '' : `<div class="bx-mq-half" aria-hidden="true">${cards}</div>`}</div>`;
    box.classList.toggle('bx-mq-static', reduce);
    box.style.setProperty('--mq-dur', Math.max(25, list.length * 6) + 's');
  }
  async function pageInstructors() {
    const grid = $('#inst-grid'); if (!grid) return;
    let list = [];
    try { list = await loadInstructors(); } catch (e) { grid.innerHTML = `<div class="bx-empty-big" style="grid-column:1/-1"><b>تعذّر تحميل المحاضرين</b>${esc(arErr(e))}</div>`; return; }
    const FAC = window.FACULTIES || [];
    const chips = $('#inst-chips'); let fac = '';
    const used = FAC.filter((f) => list.some((i) => i.faculty === f.id));
    if (chips && used.length > 1) {
      chips.innerHTML = [{ id: '', name: 'كل الكليات' }, ...used].map((f) => `<button class="bx-chip" aria-pressed="${!f.id}" data-f="${f.id}">${esc(f.name)}</button>`).join('');
      chips.onclick = (e) => { const b = e.target.closest('.bx-chip'); if (!b) return; fac = b.dataset.f; $$('.bx-chip', chips).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); };
    } else if (chips) chips.remove();
    const draw = () => {
      const l = list.filter((i) => !fac || i.faculty === fac);
      grid.innerHTML = l.length ? l.map(instCard).join('') : '<div class="bx-empty-big" style="grid-column:1/-1"><b>لا يوجد محاضرون بعد</b>سنضيفهم هنا قريبًا.</div>';
      const c = $('#inst-count'); if (c) c.textContent = `${l.length} محاضر`;
    };
    draw();
  }


  // ---------- direct upload to Bunny Stream (TUS) ----------
  let tusP = null;
  const loadTus = () => window.tus ? Promise.resolve() : (tusP = tusP || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js'; s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل أداة الرفع')); document.head.appendChild(s); }));
  window.bunnyUpload = async (file, auth, onProgress) => {
    await loadTus();
    return new Promise((res, rej) => new window.tus.Upload(file, {
      endpoint: auth.endpoint, retryDelays: [0, 3000, 5000, 10000, 20000, 60000], chunkSize: 50 * 1024 * 1024,
      headers: { AuthorizationSignature: auth.signature, AuthorizationExpire: String(auth.expire), VideoId: auth.video_id, LibraryId: String(auth.library_id) },
      metadata: { filetype: file.type || 'video/mp4', title: file.name },
      onError: rej, onProgress: (a, b) => onProgress && onProgress(a, b), onSuccess: () => res(auth.video_id),
    }).start());
  };
  window.videoDuration = (file) => new Promise((res) => { try { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(Math.round(v.duration) || null); }; v.onerror = () => res(null); v.src = URL.createObjectURL(file); } catch { res(null); } });

  // ---------- first-party traffic analytics (admin → «زيارات المنصة»). No IPs, no cookies: an anonymous id in localStorage ----------
  const AI_SRC = [['chatgpt', /chatgpt|openai/], ['perplexity', /perplexity/], ['claude', /claude\.ai|anthropic/], ['gemini', /gemini\.google|bard\.google/], ['copilot', /copilot|bing\.com\/chat/], ['deepseek', /deepseek/]];
  const REF_SRC = [['google', /(^|\.)google\./], ['bing', /(^|\.)bing\.com$/], ['facebook', /facebook\.com$|(^|\.)fb\.(com|me)$/], ['instagram', /instagram\.com$/], ['x', /(^|\.)(t\.co|twitter\.com|x\.com)$/],
    ['linkedin', /linkedin\.com$|lnkd\.in$/], ['youtube', /youtube\.com$|youtu\.be$/], ['tiktok', /tiktok\.com$/], ['whatsapp', /whatsapp\.(com|net)$|wa\.me$/], ['telegram', /t\.me$|telegram\.org$/], ['yahoo', /yahoo\./], ['duckduckgo', /duckduckgo\.com$/]];
  function trackVisit() {
    try {
      const ua = navigator.userAgent || '';
      if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp\/|telegrambot/i.test(ua)) return;
      if (/(admin|instructor)\.html$/.test(location.pathname)) return;
      const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      let vid = localStorage.getItem('biosyn.vid'), isNew = false;
      if (!vid) { vid = rid(); isNew = true; localStorage.setItem('biosyn.vid', vid); }
      const q = new URLSearchParams(location.search), now = Date.now();
      let ses = null; try { ses = JSON.parse(localStorage.getItem('biosyn.ses') || 'null'); } catch {}
      const refHost = (() => { try { return document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();
      const internal = !refHost || /biosyneg\.com$|biosynegypt\.com$|github\.io$|localhost$/.test(refHost);
      const utm = (q.get('utm_source') || '').toLowerCase();
      if (!ses || now - ses.t > 30 * 60e3 || (utm && utm !== ses.utm) || (!internal && refHost !== ses.ref)) {   // new session, or a new campaign/referral inside it
        const hit = (list, v) => (list.find(([, re]) => re.test(v)) || [])[0];
        const src = utm ? (hit(AI_SRC, utm) || utm.slice(0, 40)) : internal ? 'direct' : (hit(AI_SRC, refHost) || hit(REF_SRC, refHost) || refHost);
        ses = { id: rid(), src, ref: internal ? '' : refHost, utm };
      }
      ses.t = now; localStorage.setItem('biosyn.ses', JSON.stringify(ses));
      const dev = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobi))/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop';
      const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
      const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
      const path = location.pathname.replace(/\/index\.html$/, '/') + (document.body.dataset.page === 'course' && q.get('c') ? '?c=' + q.get('c') : '');
      const send = (cc) => sb.rpc('track_visit', { p: { vid, sid: ses.id, path, ref: ses.ref, src: ses.src, cc: cc || '', dev, br, os, lang: (document.documentElement.lang || 'ar').slice(0, 5), new: isNew } }).catch(() => {});
      Promise.race([REGION, new Promise((r) => setTimeout(() => r(null), 4500))]).then((R) => send(R && R.at ? R.country : ''));
    } catch {}
  }

  // ---------- boot ----------
  const pages = { instructors: pageInstructors, index: pageHome, home: pageHome, courses: pageCourses, interactive: pageInteractive, teach: pageTeach, institutions: pageInstitutions, consultations: pageConsultations };
  window.BiosynPages = window.BiosynPages || {};
  async function boot() {
    sb.auth.consumeHash();
    // a reset-password link that landed on another page: send it to the new-password form
    try { if (sessionStorage.getItem('biosyn.recovery') === '1' && !/login\.html$/.test(location.pathname) && sb.session) { await sb.auth.ready; location.replace('login.html?mode=reset'); return; } } catch {}
    sb.auth.loadUser();
    try { const c = new URLSearchParams(location.search).get('code'); if (c && /^[\w-]{3,40}$/.test(c)) localStorage.setItem('biosyn.code', c.toUpperCase()); } catch {}
    mountLayout();
    mountToggles();
    mountUserMenu();
    hydratePlans();
    mountSupport();
    mountInstStrip();
    sb.auth.ready.then(trackVisit);
    const p = document.body.dataset.page;
    const fn = pages[p] || window.BiosynPages[p];
    if (fn) { try { await fn(); } catch (e) { console.error(e); } }
  }
  // deferred scripts (pages.js, dash-*.js) run before DOMContentLoaded, so wait for it
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
