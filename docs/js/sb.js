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
      async recover(email) { await raw('/auth/v1/recover', { method: 'POST', body: { email }, auth: false }); },
      async signOut() { try { await raw('/auth/v1/logout', { method: 'POST' }); } catch {} setSession(null); },
      // handle the #access_token=... redirect after email confirmation / recovery
      consumeHash() {
        if (!location.hash.includes('access_token=')) return false;
        const p = new URLSearchParams(location.hash.slice(1));
        setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') });
        this.ready = raw('/auth/v1/user').then((u) => { session.user = u; store.set(session); emit(); }).catch(() => {});
        history.replaceState(null, '', location.pathname + location.search);
        return true;
      },
      ready: Promise.resolve(),
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
