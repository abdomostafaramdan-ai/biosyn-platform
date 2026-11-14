// Minimal Supabase client (Auth + REST + RPC + Edge Functions) with no dependencies.
(function () {
  const C = window.BIOSYN, KEY = 'biosyn.session';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    set(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} },
  };
  let session = store.get();
  const listeners = [];
  const emit = () => listeners.forEach((f) => f(session));

  function setSession(r) {
    session = r && r.access_token
      ? { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600), user: r.user }
      : null;
    store.set(session); emit();
  }

  // Leaked-password check (HaveIBeenPwned k-anonymity: only the first 5 chars of the SHA-1 leave the browser).
  // Fails open if the service is unreachable, so sign-up never breaks because of it.
  async function assertNotPwned(password) {
    try {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
      const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { signal: ctl.signal, headers: { 'Add-Padding': 'true' } });
      clearTimeout(t);
      if (!r.ok) return;
      const hit = (await r.text()).split('\n').some((l) => { const [suf, n] = l.trim().split(':'); return suf === h.slice(5) && Number(n) > 0; });
      if (hit) throw Object.assign(new Error('كلمة المرور هذه ظهرت في تسريبات بيانات معروفة. اختر كلمة مرور أخرى أقوى.'), { pwned: true });
    } catch (e) { if (e && e.pwned) throw e; }
  }
  async function raw(path, { method = 'GET', body, headers = {}, auth = true, prefer } = {}) {
    const h = { apikey: C.SUPABASE_KEY, ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (prefer) h.Prefer = prefer;
    if (auth) {
      await ensureFresh();
      h.Authorization = 'Bearer ' + (session ? session.access_token : C.SUPABASE_KEY);
    }
    const r = await fetch(C.SUPABASE_URL + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) {
      const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || 'request failed');
      err.status = r.status; err.data = data; throw err;
    }
    return data;
  }

  let refreshing = null;
  async function ensureFresh() {
    if (!session || session.expires_at - 60 > Date.now() / 1000) return;
    if (!refreshing) {
      refreshing = raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false })
        .then(setSession).catch(() => setSession(null)).finally(() => { refreshing = null; });
    }
    await refreshing;
  }

  const qs = (o) => Object.entries(o || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  window.sb = {
    onChange(f) { listeners.push(f); },
    get session() { return session; },
    get user() { return session && session.user; },
    auth: {
      async signUp(email, password, fullName, extra) {
        await assertNotPwned(password);
        const r = await raw('/auth/v1/signup', { method: 'POST', body: { email, password, data: { full_name: fullName, ...(extra || {}) } }, auth: false });
        if (r.access_token) setSession(r);
        return r; // no access_token => the project requires email confirmation
      },
      async signIn(email, password) {
        setSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }));
      },
      // the reset link lands on login.html, which then asks for the new password
      resend: (email) => raw('/auth/v1/resend', { method: 'POST', body: { type: 'signup', email }, auth: false }),
      async recover(email) { await raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(new URL('login.html?mode=reset', location.href).href), { method: 'POST', body: { email }, auth: false }); },
      async updatePassword(password) { await assertNotPwned(password); return raw('/auth/v1/user', { method: 'PUT', body: { password } }); },
      lastType: null,
      async signOut() { try { await raw('/auth/v1/logout', { method: 'POST' }); } catch {} setSession(null); },
      // handle the #access_token=... redirect after email confirmation / recovery
      consumeHash() {
        if (!location.hash.includes('access_token=')) return false;
        const p = new URLSearchParams(location.hash.slice(1));
        this.lastType = p.get('type');
        try { if (this.lastType === 'recovery') sessionStorage.setItem('biosyn.recovery', '1'); } catch {}
        setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') });
        this.ready = raw('/auth/v1/user').then((u) => { session.user = u; store.set(session); emit(); }).catch(() => {});
        history.replaceState(null, '', location.pathname + location.search);
        return true;
      },
      ready: Promise.resolve(),
      // a session restored without its user (e.g. page left right after an email link): load the user first
      loadUser() { if (session && !session.user) this.ready = raw('/auth/v1/user').then((u) => { if (session) { session.user = u; store.set(session); emit(); } }).catch(() => {}); return this.ready; },
      // OAuth (Google): Supabase sends the user back to redirectTo with #access_token=...
      oauthUrl(provider, redirectTo) { return `${C.SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`; },
      async providers() { try { const s = await raw('/auth/v1/settings', { auth: false }); return (s && s.external) || {}; } catch { return {}; } },
    },
    // PostgREST: sb.get('courses', { select: '*', status: 'eq.published', order: 'title' })
    get: (table, params) => raw(`/rest/v1/${table}?${qs(params)}`),
    one: async (table, params) => (await raw(`/rest/v1/${table}?${qs({ ...params, limit: 1 })}`))[0] || null,
    insert: (table, row) => raw(`/rest/v1/${table}`, { method: 'POST', body: row, prefer: 'return=representation' }),
    insertQuiet: (table, row, auth = true) => raw(`/rest/v1/${table}`, { method: 'POST', body: row, auth }),
    update: (table, match, row) => raw(`/rest/v1/${table}?${qs(match)}`, { method: 'PATCH', body: row, prefer: 'return=representation' }),
    remove: (table, match) => raw(`/rest/v1/${table}?${qs(match)}`, { method: 'DELETE' }),
    storage: {
      async upload(bucket, path, file) {
        await ensureFresh();
        const r = await fetch(`${C.SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: C.SUPABASE_KEY, Authorization: 'Bearer ' + (session ? session.access_token : C.SUPABASE_KEY), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
        if (!r.ok) { let d = null; try { d = await r.json(); } catch {} const e = new Error((d && (d.message || d.error)) || 'upload failed'); e.status = r.status; throw e; }
        return path;
      },
      async signedUrl(bucket, path, expiresIn = 600, download) {
        const d = await raw(`/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: { expiresIn } });
        return C.SUPABASE_URL + '/storage/v1' + d.signedURL + (download ? '&download=' + encodeURIComponent(download) : '');
      },
      remove: (bucket, path) => raw(`/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }),
    },
    rpc: (name, args) => raw(`/rest/v1/rpc/${name}`, { method: 'POST', body: args || {} }),
    fn: (name, body) => raw(`/functions/v1/${name}`, { method: 'POST', body: body || {} }),
  };
})();

/* Maintenance mode — site_content.maintenance = { on, msg }. Visitors see a full-screen notice;
   admin/support see the site with a small banner. Login and admin pages always stay open. */
(() => {
  const K = 'biosyn.maint', root = document.documentElement;
  const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  if (/^(login|admin|unsubscribe)$/.test(page) || !window.sb) return;
  const st = document.createElement('style');
  st.textContent = 'html.bx-mpre body{visibility:hidden}.bx-maint{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b1220;color:#e8eef9;font-family:inherit;text-align:center}.bx-maint-in{max-width:520px}.bx-maint img{height:44px;margin-bottom:22px}.bx-maint h1{font-size:28px;margin:0 0 12px;color:#fff}.bx-maint p{font-size:17px;line-height:1.9;margin:0 0 8px;color:#b9c6dc;white-space:pre-line}.bx-maint a{color:#7fb3ff;font-size:14px}.bx-maint-ic{font-size:46px;margin-bottom:10px}.bx-maint-bar{position:fixed;bottom:12px;inset-inline-start:12px;z-index:2147483000;background:#b45309;color:#fff;padding:8px 14px;border-radius:10px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3)}.bx-maint-bar a{color:#fff;text-decoration:underline}';
  document.head.appendChild(st);
  try { if (localStorage.getItem(K) === '1') root.classList.add('bx-mpre'); } catch {}
  const show = (msg) => {
    const d = document.createElement('div'); d.className = 'bx-maint'; d.setAttribute('role', 'alert');
    d.innerHTML = '<div class="bx-maint-in"><img src="img/biosyn-logo.png" alt="Biosyn Eg"><div class="bx-maint-ic" aria-hidden="true">🛠️</div><h1>المنصة تحت الصيانة</h1><p></p><a href="login.html">دخول فريق العمل</a></div>';
    d.querySelector('p').textContent = msg || 'نعمل حاليًا على تحسينات وإضافات جديدة، وسنعود خلال وقت قصير. شكرًا لصبرك.';
    document.body.appendChild(d); document.body.style.overflow = 'hidden';
    document.querySelectorAll('video,audio').forEach((v) => { try { v.pause(); } catch {} });
    document.querySelectorAll('iframe').forEach((f) => { f.src = 'about:blank'; });
  };
  (async () => {
    let d = null;
    try { const r = await sb.get('site_content', { select: 'data', key: 'eq.maintenance' }); d = r && r[0] && r[0].data; } catch {}
    let on = !!(d && d.on);
    try { localStorage.setItem(K, on ? '1' : '0'); } catch {}
    if (on) {
      try { await (sb.auth && sb.auth.ready); } catch {}
      if (sb.user) {
        try {
          const p = await sb.get('profiles', { select: 'role', id: 'eq.' + sb.user.id });
          if (p && p[0] && /^(admin|support)$/.test(p[0].role)) {
            on = false;
            const b = document.createElement('div'); b.className = 'bx-maint-bar';
            b.innerHTML = 'وضع الصيانة مفعّل — الزوار لا يرون الموقع. <a href="admin.html#settings">إيقافه</a>';
            document.body.appendChild(b);
          }
        } catch {}
      }
      if (on) show(d.msg);
    }
    root.classList.remove('bx-mpre');
  })();
})();

/* Promo popup — site_content.promo_popup = { on, title, subtitle, discount, expires, cta, cta_url, delay_sec, reshow_sec, egypt_only, max_shows }.
   Shows for Egyptians only (when egypt_only is true), non-subscribed visitors, after delay_sec seconds.
   Reappears reshow_sec seconds after the user closes it, up to max_shows times total (default 2).
   Admin/support never see it. */
(() => {
  const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  if (/^(login|admin|unsubscribe)$/.test(page) || !window.sb) return;
  let overlay, timer, reshowTimer;
  const PK = 'biosyn.promo_shown';
  const getShown = () => { try { return Number(localStorage.getItem(PK)) || 0; } catch { return 0; } };
  const incShown = () => { try { localStorage.setItem(PK, String(getShown() + 1)); } catch {} };
  let maxShows = 2;
  const open = () => { if (!overlay || getShown() >= maxShows) return; overlay.classList.add('is-open'); incShown(); };
  const close = () => {
    if (overlay) overlay.classList.remove('is-open');
    if (reshowTimer) clearTimeout(reshowTimer);
    if (getShown() < maxShows) reshowTimer = setTimeout(open, (window._promoReshowSec || 60) * 1000);
  };
  (async () => {
    let d; try { const r = await sb.get('site_content', { select: 'data', key: 'eq.promo_popup' }); d = r && r[0] && r[0].data; } catch {} if (!d || !d.on) return;
    // Egypt-only check
    if (d.egypt_only) {
      const R = window.REGION ? await window.REGION : null;
      if (R && R.currency && R.currency !== 'EGP') return;
    }
    // skip for subscribed users
    try {
      await (sb.auth && sb.auth.ready);
      if (sb.user) {
        const p = await sb.get('profiles', { select: 'role', id: 'eq.' + sb.user.id });
        if (p && p[0] && /^(admin|support)$/.test(p[0].role)) return;
        try { const st = await sb.rpc('my_plan_state'); if (st && st.plan_code) return; } catch {}
      }
    } catch {}
    window._promoReshowSec = d.reshow_sec || 60;
    maxShows = Math.max(1, Number(d.max_shows) || 2);
    if (getShown() >= maxShows) return;
    // build DOM
    overlay = document.createElement('div');
    overlay.className = 'bx-promo-overlay';
    const codeHtml = d.promo_code ? `<div class="bx-promo-code"><span>كود الخصم:</span> <b>${esc(d.promo_code)}</b></div>` : '';
    overlay.innerHTML = `<div class="bx-promo"><div class="bx-promo-glow"></div><button class="bx-promo-x" aria-label="إغلاق">✕</button><div class="bx-promo-body"><img class="bx-promo-logo" src="img/biosyn-logo.png" alt="Biosyn Eg"><div class="bx-promo-tag">${esc(d.title || 'WHITE FRIDAY')}</div><div class="bx-promo-sub">${esc(d.subtitle || '')}</div><div class="bx-promo-disc">${esc(d.discount || '')}</div>${codeHtml}<div class="bx-promo-exp">${esc(d.expires || '')}</div><a class="bx-promo-cta" href="${esc(d.cta_url || '/pricing')}">${esc(d.cta || 'اشترك دلوقتي')}</a></div></div>`;
    document.body.appendChild(overlay);
    // close on X, on overlay click, and on CTA click
    overlay.querySelector('.bx-promo-x').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.bx-promo-cta').addEventListener('click', () => {
      if (d.promo_code) try { sessionStorage.setItem('biosyn.promo', d.promo_code); } catch {}
      close();
    });
    // show after delay
    timer = setTimeout(open, (d.delay_sec || 10) * 1000);
    function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  })();
})();
