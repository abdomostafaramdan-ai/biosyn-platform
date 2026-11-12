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
        const r = await raw('/auth/v1/signup', { method: 'POST', body: { email, password, data: { full_name: fullName, ...(extra || {}) } }, auth: false });
        if (r.access_token) setSession(r);
        return r; // no access_token => the project requires email confirmation
      },
      async signIn(email, password) {
        setSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }));
      },
      // the reset link lands on login.html, which then asks for the new password
      async recover(email) { await raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(new URL('login.html?mode=reset', location.href).href), { method: 'POST', body: { email }, auth: false }); },
      updatePassword: (password) => raw('/auth/v1/user', { method: 'PUT', body: { password } }),
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
