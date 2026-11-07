/* Page logic: login, course, watch (dashboards are in dash.js). */
(() => {
  'use strict';
  const P = window.BiosynPages = window.BiosynPages || {};
  const { toast } = window.ui;
  const dur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60), r = s % 60; return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0'); };
  const hoursText = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} ساعة${m % 60 ? ' و' + (m % 60) + ' دقيقة' : ''}` : `${m} دقيقة`; };
  const nextUrl = () => { const n = new URLSearchParams(location.search).get('next') || ''; return /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?(#[a-z-]+)?$/i.test(n) ? n : 'account.html'; };
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  // ---------- login ----------
  // phone: country select + national number -> +<dial><number>
  const ccOptions = (iso) => (window.COUNTRIES || []).map(([c, n, d]) => `<option value="${c}" data-d="${d}" ${c === iso ? 'selected' : ''}>+${d} ${n}</option>`).join('');
  function normPhone(iso, raw) {
    const row = (window.COUNTRIES || []).find((x) => x[0] === iso); if (!row) return null;
    const dial = row[2]; let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('00' + dial)) d = d.slice(2 + dial.length); else if (d.startsWith(dial) && d.length > dial.length + 7) d = d.slice(dial.length);
    d = d.replace(/^0+/, '');
    if (iso === 'EG' ? !/^1[0125]\d{8}$/.test(d) : !/^\d{6,12}$/.test(d)) return null;
    return '+' + dial + d;
  }
  window.normPhone = normPhone; window.ccOptions = ccOptions;

  P.login = async () => {
    const $ = window.$;
    const R = await Promise.race([window.REGION, new Promise((r) => setTimeout(() => r({}), 2500))]).catch(() => ({}));
    const iso0 = (window.COUNTRIES || []).some((x) => x[0] === R.country) ? R.country : 'EG';
    $('#r-cc').innerHTML = ccOptions(iso0); $('#c-cc').innerHTML = ccOptions(iso0);
    const phoneErr = (iso) => iso === 'EG' ? 'اكتب رقم هاتف محمول مصريًا صحيحًا (11 رقمًا يبدأ بـ 01).' : 'اكتب رقم هاتف محمول صحيحًا.';
    // signed in (email or just back from Google): make sure we have a phone, then continue
    if (sb.session) await sb.auth.ready;
    // back from the reset-password email: ask for the new password before anything else
    let recovering = false; try { recovering = sessionStorage.getItem('biosyn.recovery') === '1'; } catch {}
    if (sb.user && recovering) {
      ['#f-in', '#f-up', '#f-ph', '.bx-seg', '#oauth'].forEach((q) => { const el = $(q); if (el) el.hidden = true; });
      $('#auth-h').textContent = 'اختر كلمة مرور جديدة'; $('#auth-eb').textContent = 'إعادة تعيين كلمة المرور'; $('#auth-sub').textContent = 'اكتب كلمة المرور الجديدة لحسابك ' + (sb.user.email || '') + '.';
      const f = $('#f-pw'); f.hidden = false; $('#n-p').focus();
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const m = $('#m-pw'), a = $('#n-p').value, b2 = $('#n-p2').value;
        if (a.length < 8) { m.className = 'bx-formmsg err'; m.textContent = 'كلمة المرور يجب ألا تقل عن 8 أحرف.'; return; }
        if (a !== b2) { m.className = 'bx-formmsg err'; m.textContent = 'كلمتا المرور غير متطابقتين.'; return; }
        const b = $('button[type=submit]', f); b.disabled = true; m.className = 'bx-formmsg'; m.textContent = 'جارٍ الحفظ…';
        try {
          await sb.auth.updatePassword(a);
          try { sessionStorage.removeItem('biosyn.recovery'); } catch {}
          m.className = 'bx-formmsg ok'; m.textContent = 'تم تغيير كلمة المرور بنجاح ✓';
          setTimeout(() => location.replace(nextUrl()), 1200);
        } catch (e) {
          b.disabled = false; m.className = 'bx-formmsg err';
          m.textContent = /same|different from the old/i.test(e.message) ? 'اختر كلمة مرور مختلفة عن السابقة.' : /weak|at least/i.test(e.message) ? 'كلمة المرور ضعيفة، استخدم 8 أحرف على الأقل مع أرقام.' : window.arErr(e);
        }
      });
      return;
    }
    if (sb.user) {
      // Google sign-ups: the ?ref= invite code can't travel through OAuth, so claim it now (no-op for older accounts)
      try { const rc = localStorage.getItem('biosyn.ref'); if (rc) { await sb.rpc('claim_referral', { p_code: rc }).catch(() => null); localStorage.removeItem('biosyn.ref'); } } catch {}
      try { if (sessionStorage.getItem('biosyn.oauth')) { sessionStorage.removeItem('biosyn.oauth'); window.track && track('login', { method: 'google' }); } } catch {}
      let prof = null; try { prof = await sb.one('profiles', { select: 'phone', id: 'eq.' + sb.user.id }); } catch {}
      if (prof && prof.phone) { location.replace(nextUrl()); return; }
      ['#f-in', '#f-up', '.bx-seg', '#oauth'].forEach((q) => { const el = $(q); if (el) el.hidden = true; });
      $('#auth-h').textContent = 'أكمل بياناتك'; $('#auth-eb').textContent = 'أهلًا بك في Biosyn'; $('#auth-sub').textContent = '';
      const f = $('#f-ph'); f.hidden = false;
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const m = $('#m-ph'), iso = $('#c-cc').value, ph = normPhone(iso, $('#c-ph').value);
        if (!ph) { m.className = 'bx-formmsg err'; m.textContent = phoneErr(iso); return; }
        const b = $('button[type=submit]', f); b.disabled = true;
        try { await sb.update('profiles', { id: 'eq.' + sb.user.id }, { phone: ph, country: iso }); location.replace(nextUrl()); }
        catch (e) { b.disabled = false; m.className = 'bx-formmsg err'; m.textContent = window.arErr(e); }
      });
      return;
    }
    // Google sign-in: only shown once the provider is enabled in Supabase
    sb.auth.providers().then((p) => {
      if (!p.google) return;
      $('#oauth').hidden = false;
      $('#g-btn').onclick = () => {
        const n = new URLSearchParams(location.search).get('next');
        const back = location.origin + location.pathname + (n ? '?next=' + encodeURIComponent(n) : '');
        try { sessionStorage.setItem('biosyn.oauth', '1'); } catch {}
        location.href = sb.auth.oauthUrl('google', back);
      };
    });
    const show = (up) => {
      $('#f-in').hidden = up; $('#f-up').hidden = !up;
      $('#tab-in').setAttribute('aria-selected', String(!up)); $('#tab-up').setAttribute('aria-selected', String(up));
      $('#auth-h').textContent = up ? 'إنشاء حساب Biosyn' : 'تسجيل الدخول';
      $('#auth-eb').textContent = up ? 'إنشاء حساب جديد' : 'أهلاً بعودتك';
      $('#auth-sub').textContent = up ? 'أدخل بياناتك لبدء رحلتك التعليمية.' : 'سجّل دخولك للوصول إلى مساحتك التعليمية.';
    };
    $('#tab-in').onclick = () => show(false); $('#tab-up').onclick = () => show(true);
    if (new URLSearchParams(location.search).get('mode') === 'signup') show(true);
    { const pe = (new URLSearchParams(location.search).get('email') || '').trim(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pe)) { $('#r-e').value = pe; $('#l-e').value = pe; } }
    const say = (id, t, k) => { const m = $(id); m.textContent = t; m.className = 'bx-formmsg' + (k ? ' ' + k : ''); };
    const authErr = (e) => /invalid login/i.test(e.message) ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : /already registered/i.test(e.message) ? 'هذا البريد مسجّل بالفعل، سجّل الدخول.' : /email not confirmed/i.test(e.message) ? 'أكّد بريدك الإلكتروني أولًا من الرسالة التي وصلتك.' : /rate limit/i.test(e.message) ? 'محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة.' : window.arErr(e);

    $('#f-in').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const b = $('button[type=submit]', ev.target); b.disabled = true; say('#m-in', 'جارٍ تسجيل الدخول…');
      try { await sb.auth.signIn($('#l-e').value.trim(), $('#l-p').value); window.track && track('login', { method: 'email' }); location.href = nextUrl(); }
      catch (e) { say('#m-in', authErr(e), 'err'); b.disabled = false; }
    });
    $('#f-up').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const b = $('button[type=submit]', ev.target);
      const n = $('#r-n').value.trim(), e = $('#r-e').value.trim(), p = $('#r-p').value, iso = $('#r-cc').value, ph = normPhone(iso, $('#r-ph').value);
      if (!n) return say('#m-up', 'اكتب اسمك الكامل.', 'err');
      if (!/^\S+@\S+\.\S+$/.test(e)) return say('#m-up', 'اكتب بريدًا إلكترونيًا صحيحًا.', 'err');
      if (!ph) return say('#m-up', phoneErr(iso), 'err');
      if (p.length < 8) return say('#m-up', 'كلمة المرور يجب ألا تقل عن 8 أحرف.', 'err');
      if (!$('#r-c').checked) return say('#m-up', 'يرجى الموافقة على الشروط للمتابعة.', 'err');
      b.disabled = true; say('#m-up', 'جارٍ إنشاء الحساب…');
      try {
        let ref = null; try { ref = localStorage.getItem('biosyn.ref'); } catch {}
        const r = await sb.auth.signUp(e, p, n, { phone: ph, country: iso, ...(ref ? { ref } : {}) });
        window.track && track('sign_up');
        if (r.access_token) location.href = nextUrl();
        else { say('#m-up', 'أرسلنا لك رسالة تأكيد على بريدك الإلكتروني. افتحها لتفعيل حسابك ثم سجّل الدخول.', 'ok'); b.disabled = false; }
      } catch (err) { say('#m-up', authErr(err), 'err'); b.disabled = false; }
    });
    $('#forgot').addEventListener('click', async (ev) => {
      ev.preventDefault(); const e = $('#l-e').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(e)) return say('#m-in', 'اكتب بريدك الإلكتروني أولًا ثم اضغط «نسيت كلمة المرور».', 'err');
      try { await sb.auth.recover(e); say('#m-in', 'إذا كان البريد مسجّلًا ستصلك رسالة لاستعادة كلمة المرور.', 'ok'); } catch (err) { say('#m-in', authErr(err), 'err'); }
    });
  };

  // ---------- course ----------
  async function hasSubscription() {
    if (!sb.user) return false;
    try { const r = await sb.get('subscriptions', { select: 'id', ends_at: 'gt.' + new Date().toISOString(), starts_at: 'lte.' + new Date().toISOString(), limit: 1 }); return r.length > 0; } catch { return false; }
  }
  window.hasSubscription = hasSubscription;

  // course instructor: the site profile (name + bio) if set, else the instructor account name
  async function courseInst(c) {
    const ids = (c.featured_instructor_ids && c.featured_instructor_ids.length) ? c.featured_instructor_ids : c.featured_instructor_id ? [c.featured_instructor_id] : [];
    if (ids.length) {
      const f = await sb.get('featured_instructors', { select: 'id,name,title,photo_url,photo_alt,slug,bio', id: 'in.(' + ids.join(',') + ')' }).catch(() => []);
      const out = ids.map((id) => f.find((x) => x.id === id)).filter(Boolean); if (out.length) return out;
    }
    if (c.instructor_id) {
      const f = await sb.get('featured_instructors', { select: 'name,title,photo_url', profile_id: 'eq.' + c.instructor_id }).catch(() => []); if (f[0]) return [f[0]];
      const p = await sb.get('public_instructors', { select: '*', id: 'eq.' + c.instructor_id }).catch(() => []); if (p[0]) return [{ name: p[0].full_name }];
    }
    return [];
  }
  const teacherChip = (list) => (list && list.length ? `<div class="bx-teachers">${list.map((t) => `<div class="bs-teacher"><div class="bs-inst-photo">${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="">` : `<span>${esc((window.instInitials ? window.instInitials(t.name) : t.name.charAt(0)) || '')}</span>`}</div><div><small>${list.length > 1 ? 'محاضر' : 'المحاضر'}</small><b>${esc(t.name)}</b></div></div>`).join('')}</div>` : '');
  // instructor profile pages (teacher-<slug>.html) are built for instructors with a real bio or a full title
  const teacherHref = (t) => (t.slug && ((t.title || '').length >= 30 || (t.bio || '').length >= 60) ? `teacher-${encodeURIComponent(t.slug)}.html` : '');
  window.teacherHref = teacherHref;
  const aboutInst = (list) => { const l = (list || []).filter((t) => t.title || t.bio); return l.length ? `<section class="bs-block-sec bx-aboutinst"><h2>${l.length > 1 ? 'عن المحاضرين' : 'عن المحاضر'}</h2><div style="display:grid;gap:12px">${l.map((t) => { const h = teacherHref(t); return `<div class="bs-inst-wide"><div class="bs-inst-photo">${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="${esc(t.photo_alt || t.name)}" loading="lazy">` : `<span>${esc(window.instInitials ? window.instInitials(t.name) : '')}</span>`}</div><div><h3>${h ? `<a class="bx-link" href="${h}">${esc(t.name)}</a>` : esc(t.name)}</h3>${t.title ? `<p>${esc(t.title)}</p>` : ''}${t.bio ? `<p class="bx-muted">${esc(t.bio.length > 260 ? t.bio.slice(0, 257) + '…' : t.bio)}</p>` : ''}${h ? `<a class="bx-link" href="${h}">الملف الكامل والدورات ←</a>` : ''}</div></div>`; }).join('')}</div></section>` : ''; };
  // «لمن هذه الدورة؟» from the primary faculty + admin-chosen faculties (course_faculties) with fit levels
  const FIT = { direct: 'مناسبة مباشرة', prereq: 'مناسبة بعد معرفة مسبقة', related: 'مناسبة للتخصصات القريبة' };
  const learnHtml = (c) => { const l = String(c.outcomes || '').split('\n').map((x) => x.trim()).filter(Boolean); return l.length ? `<section class="bs-block-sec"><h2>ماذا ستتعلم في هذه الدورة؟</h2><div class="bs-learn"><ul class="bs-checks">${l.map((x) => `<li>${ICON_CHECK}<span>${esc(x)}</span></li>`).join('')}</ul></div></section>` : ''; };
  const fitsHtml = (c) => {
    const FAC = window.FACULTIES || [], by = Object.fromEntries(FAC.map((f) => [f.id, f])), rows = [], seen = new Set();
    const add = (fid, sp, fit) => { const f = by[fid], k = fid + '|' + (sp || ''); if (f && !seen.has(k)) { seen.add(k); rows.push({ f, sp: sp && sp !== 'كل التخصصات' ? sp : '', fit: fit || 'direct' }); } };
    add(c.faculty, c.specialty, 'direct'); (c.course_faculties || []).forEach((r) => add(r.faculty, r.specialty, r.fit));
    if (!rows.length) return '';
    return `<section class="bs-block-sec bx-fits"><h2>لمن هذه الدورة؟</h2>${['direct', 'prereq', 'related'].filter((k) => rows.some((r) => r.fit === k)).map((k) => `<p><b>${FIT[k]}:</b> ${rows.filter((r) => r.fit === k).map((r) => `<a class="bx-link" href="courses.html?f=${encodeURIComponent(r.f.id)}">${esc(r.f.name)}</a>${r.sp ? ` (${esc(r.sp)})` : ''}`).join('، ')}</p>`).join('')}</section>`;
  };
  P.course = async () => {
    const root = $('#course-root'), slug = document.body.dataset.slug || new URLSearchParams(location.search).get('c');
    if (!slug) { location.replace('courses.html'); return; }
    try { window.REGION_NOW = await window.REGION; } catch {}
    let c;
    const pre = !!document.body.dataset.slug;   // pre-rendered SEO page: keep its content if live data can't load
    try { c = await sb.one('courses', { select: '*,lectures(id,position,title,duration_seconds,is_preview),course_faculties(faculty,specialty,fit)', slug: 'eq.' + slug }); } catch (e) { if (pre) return; root.innerHTML = `<div class="bx-empty-big" style="margin:80px 16px"><b>تعذّر تحميل الدورة</b>${esc(arErr(e))}</div>`; return; }
    if (!c) { const x = $('#seo-extra'); if (x) x.remove(); root.innerHTML = '<div class="bx-empty-big" style="margin:80px auto;max-width:560px"><b>هذه الدورة غير متاحة</b>قد تكون غير منشورة بعد. <a class="bx-link" href="courses.html">تصفح الدورات</a></div>'; return; }
    const nL = Number(await sb.rpc('course_learners', { p_course: c.id }).catch(() => 0)) || 0;
    // Arabic number agreement: 1 طالب واحد / 2 طالبان / 3-10 طلاب / 11+ طالبًا
    const learnersTxt = (plural, one, two) => nL > 0 ? `<span class="bx-learners">👥 ${nL === 1 ? `طالب واحد ${one}` : nL === 2 ? `طالبان ${two}` : `<b>${EGP(nL)}</b> ${nL % 100 >= 3 && nL % 100 <= 10 ? 'طلاب' : 'طالبًا'} ${plural}`}</span>` : `<span class="bx-learners">👥 كن من أوائل المشتركين</span>`;
    if (c.kind === 'interactive') {
      if (!pre) { document.title = c.title + ' | Biosyn Eg'; window.setMeta && setMeta(c.title + ' | Biosyn Eg', (c.summary || c.description || '').slice(0, 160)); }
      const T = await courseInst(c);
      const fc = window.facOf ? window.facOf(c) : null, I = window.BX_ICO || {};
      root.innerHTML = `<section class="bs-course-hero"><span class="bs-wm" aria-hidden="true"></span><div class="bs-course-hero-in"><div>
        <nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="interactive.html">دورات تفاعلية</a><span>/</span><span class="bs-latin">${esc(c.title)}</span></nav>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="bs-badge bs-badge-info">دورة تفاعلية</span>${fc ? `<span class="bs-badge bs-badge-member">${esc(fc.name)}</span>` : ''}${c.specialty ? `<span class="bs-badge bs-badge-member">${esc(c.specialty)}</span>` : ''}</div>
        <h1 dir="auto">${esc(c.title)}</h1>${c.summary ? `<p class="bs-lead">${esc(c.summary)}</p>` : ''}
        <div class="bs-stats">${learnersTxt('اشتركوا في الدورة', 'اشترك في الدورة', 'اشتركا في الدورة')}</div>
        ${teacherChip(T)}
        </div><div class="bs-spacer"></div></div></section>
        <div class="bs-course-main"><div>${c.description ? `<section class="bs-block-sec" style="margin-top:48px"><h2>عن الدورة</h2>${c.description.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : '<div style="height:48px"></div>'}
        ${learnHtml(c)}${fitsHtml(c)}${aboutInst(T)}<section class="bs-block-sec"><h2>سياسة الاسترداد</h2><p>يمكن استرداد رسوم الدورة التفاعلية خلال 7 أيام من تاريخ الدفع.</p></section></div>
        <aside class="bs-enroll"><div class="bs-cover bx-icover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span>${fc ? `<span class="bx-pcard-ic"><svg viewBox="0 0 24 24">${fc.icon}</svg></span><span class="bx-pcard-fac">${esc(fc.name)}</span>` : `<span class="bs-cover-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</span>`}</div>
        <div class="bs-enroll-body"><div class="bs-enroll-access"><b>${priceTxt(c.price_egp, window.REGION_NOW, c.intl_price)}</b></div>
        <ul class="bx-pcard-facts bx-ifacts">${c.starts_at ? `<li>${I.cal}<span>يبدأ ${esc(window.fmtDay(c.starts_at))}</span></li>` : ''}${c.seats ? `<li>${I.seat}<span>${c.seats} مقعد</span></li>` : ''}${LEVEL[c.level] ? `<li>${I.lvl}<span>${LEVEL[c.level]}</span></li>` : ''}<li>${I.live}<span>مباشر أونلاين</span></li></ul>
        <button type="button" class="bs-btn bs-btn-primary bs-btn-lg bs-block" id="reg">سجّل الآن</button>
        <p class="bx-hint">دورة تفاعلية بجلسات مباشرة، منفصلة عن باقات الاشتراك.</p></div></aside></div>`;
      $('#reg').onclick = () => attendeeThen(() => window.checkout({ course_id: c.id, title: c.title, price: c.price_egp, intl: c.intl_price }));
      return;
    }
    if (!pre) document.title = c.title + ' | Biosyn Eg';
    window.track && track('view_content', { item: c.title, id: c.id });
    !pre && window.setMeta && setMeta(c.title + ' | Biosyn Eg', (c.summary || c.description || 'دورة مسجلة على منصة Biosyn Eg').slice(0, 160));
    const lects = (c.lectures || []).sort((a, b) => a.position - b.position);
    const total = lects.reduce((s, l) => s + (l.duration_seconds || 0), 0);
    const [T, plans, subscribed] = await Promise.all([courseInst(c), sb.get('plans', { select: '*', active: 'eq.true', order: 'duration_months' }).catch(() => []), hasSubscription()]);
    const inst = T.map((t) => t.name).join('، ');
    const from = plans[0];
    const first = lects[0];
    const cta = subscribed
      ? `<a class="bs-btn bs-btn-primary bs-btn-lg bs-block" href="watch.html?c=${esc(c.slug)}">${lects.length ? 'ابدأ المشاهدة' : 'المحاضرات قريبًا'}</a><button type="button" class="bs-btn bs-btn-secondary bs-block bx-askbtn" data-ask="${c.id}">💬 اسأل المحاضر</button>`
      : `<a class="bs-btn bs-btn-primary bs-btn-lg bs-block" href="#plans" id="cta-sub">اشترك لمشاهدة الدورة</a>`;
    root.innerHTML = `<section class="bs-course-hero"><span class="bs-wm" aria-hidden="true"></span><div class="bs-course-hero-in"><div>
      <nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="courses.html">دورات مسجلة</a><span>/</span><span class="bs-latin">${esc(c.title)}</span></nav>
      <div style="display:flex;gap:8px"><span class="bs-badge bs-badge-neutral">${LEVEL[c.level] || 'مبتدئ'}</span><span class="bs-badge bs-badge-info">دورة مسجلة</span></div>
      <h1>${esc(c.title)}</h1>
      ${c.summary ? `<p class="bs-lead">${esc(c.summary)}</p>` : ''}
      <div class="bs-stats"><span><b>${lects.length}</b> محاضرة</span>${total ? `<span><b>${esc(hoursText(total))}</b></span>` : ''}<span>بالعربية</span>${learnersTxt('شاهدوا الدورة', 'شاهد الدورة', 'شاهدا الدورة')}</div>
      ${teacherChip(T)}
      </div><div class="bs-spacer"></div></div></section>
    <div class="bs-course-main"><div>
      ${c.description ? `<section class="bs-block-sec" style="margin-top:48px"><h2>عن الدورة</h2>${c.description.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
      ${learnHtml(c)}${fitsHtml(c)}
      <section class="bs-block-sec" style="${c.description ? '' : 'margin-top:48px'}"><h2>محتوى الدورة</h2>
        ${lects.length ? `<div class="bs-curr"><div class="bs-curr-head"><b>محتوى الدورة</b><span>${lects.length} محاضرة${total ? ' · ' + esc(hoursText(total)) : ''}</span></div><ol class="bs-curr-list">${lects.map((l, i) => `<li class="bs-curr-item"><span class="bs-curr-num bs-latin">${String(i + 1).padStart(2, '0')}</span><span class="bs-play" aria-hidden="true">${subscribed || l.is_preview ? ICON_PLAY : ICON_LOCK}</span><span class="bs-curr-title bs-latin">${subscribed || l.is_preview ? `<a href="watch.html?c=${esc(c.slug)}&l=${l.id}" style="color:inherit;text-decoration:none">${esc(l.title)}</a>` : esc(l.title)}${!subscribed && l.is_preview ? ' <span class="bs-badge bs-badge-new" style="margin-inline-start:6px">معاينة مجانية</span>' : ''}</span><span class="bs-curr-dur bs-latin">${l.duration_seconds ? dur(l.duration_seconds) : ''}</span></li>`).join('')}</ol></div>` : '<div class="bx-empty-big"><b>المحاضرات قيد الإضافة</b>سنعلن عند نشر الدورة كاملة.</div>'}
      </section>${aboutInst(T)}</div>
      <aside class="bs-enroll"><div class="bs-cover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span><span class="bs-cover-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</span>${c.cover_url ? `<img class="bs-cover-img" src="${esc(c.cover_url)}" alt="${esc(c.cover_alt || c.title)}" width="1280" height="720">` : ''}</div>
        <div class="bs-enroll-body"><div class="bs-enroll-access"><span>${subscribed ? 'اشتراكك ساري' : 'متاحة مع الاشتراك'}</span>${!subscribed && from ? `<b>تبدأ من ${priceTxt(from.price_egp, window.REGION_NOW, from.intl_price)} / ${from.duration_months === 1 ? 'شهريًا' : from.duration_months + ' أشهر'}</b>` : ''}</div>
        ${cta}
        <ul class="bs-checks bs-checks-sm"><li>${ICON_CHECK}<span>${lects.length} محاضرة مسجلة${total ? ' (حوالي ' + esc(hoursText(total)) + ')' : ''}</span></li><li>${ICON_CHECK}<span>شهادة إتمام عند إنهاء الدورة</span></li><li>${ICON_CHECK}<span>مستوى ${LEVEL[c.level] || 'مبتدئ'} · بالعربية</span></li></ul></div></aside></div>
    ${subscribed ? '' : `<section class="bs-section" id="plans"><div class="bs-section-head"><div><h2>متاحة مع باقات العضوية</h2><p>باشتراك واحد، ادرس كل الدورات المسجلة على المنصة</p></div></div><div class="bs-plans">${plans.map(() => '<template-slot></template-slot>').join('')}</div></section>`}`;
    // plan cards: reuse the design markup, filled by app.js's hydratePlans() (called again here)
    const tpl = $('#plan-card');
    $$('template-slot', root).forEach((s) => s.replaceWith(tpl.content.cloneNode(true)));
    window.hydratePlansNow && window.hydratePlansNow();
    const cs = $('#cta-sub'); if (cs) cs.addEventListener('click', (e) => { e.preventDefault(); $('#plans').scrollIntoView({ behavior: 'smooth' }); });
    $$('[data-ask]', root).forEach((b) => (b.onclick = () => window.Chat && Chat.askCourse(b.dataset.ask)));
  };

  // ---------- watch ----------
  P.watch = async () => {
    if (!requireLogin()) return;
    const root = $('#watch-root'), q = new URLSearchParams(location.search), slug = q.get('c');
    const fail = (t, d, link) => { root.innerHTML = `<div class="bx-empty-big" style="margin:80px auto;max-width:560px"><b>${t}</b>${d}${link || ''}</div>`; };
    if (!slug) return fail('لم يتم اختيار دورة', '', ' <a class="bx-link" href="courses.html">تصفح الدورات</a>');
    let c;
    try { c = await sb.one('courses', { select: '*,lectures(id,position,title,duration_seconds,is_preview)', slug: 'eq.' + slug }); } catch (e) { return fail('تعذّر التحميل', esc(arErr(e))); }
    if (!c) return fail('هذه الدورة غير متاحة', '');
    const lects = (c.lectures || []).sort((a, b) => a.position - b.position);
    if (!lects.length) return fail('المحاضرات قيد الإضافة', 'سنعلن عند نشرها.', ' <a class="bx-link" href="courses.html">رجوع</a>');
    document.title = c.title + ' | Biosyn Eg';

    let prog = {};
    const loadProg = async () => {
      try { (await sb.get('lecture_progress', { select: 'lecture_id,max_pct,completed', lecture_id: 'in.(' + lects.map((l) => l.id).join(',') + ')' })).forEach((r) => (prog[r.lecture_id] = r)); } catch {}
    };
    await loadProg();
    const sub = await hasSubscription();
    const pool = sub ? lects : lects.filter((l) => l.is_preview).length ? lects.filter((l) => l.is_preview) : lects;
    // lectures open in order: each one needs 50% of the previous one (free previews are always open)
    const PASS = 50;
    const seen = (l) => (prog[l.id] && Number(prog[l.id].max_pct)) || 0;
    const unlocked = (l) => { const i = lects.indexOf(l); return l.is_preview || i === 0 || seen(lects[i - 1]) >= PASS; };
    const lastOpen = () => [...pool].reverse().find((l) => unlocked(l) && !(prog[l.id] && prog[l.id].completed)) || [...pool].reverse().find(unlocked) || pool[0];
    let cur = lects.find((l) => l.id === q.get('l'));
    if (!cur || !unlocked(cur)) cur = pool.find((l) => unlocked(l) && !(prog[l.id] && prog[l.id].completed)) || lastOpen();
    const done = () => lects.filter((l) => prog[l.id] && prog[l.id].completed).length;
    const lessonIcon = (l) => { const d = prog[l.id] && prog[l.id].completed; return `<span class="bx-lesson-ic ${d ? 'done' : l === cur ? 'now' : ''}">${d ? ICON_CHECK : (!sub && !l.is_preview) || !unlocked(l) ? ICON_LOCK : ICON_PLAY}</span>`; };
    const nextLabel = (i) => i >= lects.length - 1 ? (seen(cur) >= 95 ? 'أكملت الدورة ✓' : 'آخر محاضرة') : seen(cur) >= PASS ? 'المحاضرة التالية ←' : `التالية تتفتح عند ${PASS}٪`;
    const pct = () => Math.round((done() / lects.length) * 100);

    function draw() {
      const i = lects.indexOf(cur);
      root.innerHTML = `<div class="bx-player"><main class="bx-stage">
        <div class="bx-video" role="group" aria-label="مشغل الفيديو" style="padding:0;overflow:hidden"><div id="vid" style="position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-muted)">جارٍ تجهيز الفيديو…</div></div>
        <div class="bx-lesson-head"><div><span class="bx-eyebrow">المحاضرة ${i + 1} من ${lects.length}</span><h2>${esc(cur.title)}</h2></div>
          <div class="bx-lesson-nav">${sub ? `<button type="button" class="bs-btn bs-btn-ghost" data-ask="${c.id}" title="اسأل المحاضر">💬 اسأل المحاضر</button>` : ''}${i > 0 ? '<button type="button" class="bs-btn bs-btn-secondary" id="prev">السابقة</button>' : ''}<button type="button" class="bs-btn bs-btn-primary" id="next" ${i < lects.length - 1 && seen(cur) >= PASS ? '' : 'disabled'}>${nextLabel(i)}</button></div></div>
        <div class="bx-watchbar"><div class="bx-progress" aria-hidden="true"><i id="lpbar" style="width:${Math.round(seen(cur))}%"></i><s style="inset-inline-start:${PASS}%"></s></div><span class="bx-hint" id="lptxt">${lpText()}</span></div>
        <section class="bx-panel" id="files" style="margin-top:24px" hidden><div class="bx-panel-head"><h3>ملفات المحاضرة</h3></div><div id="filelist"></div></section>
        <section class="bx-panel" style="margin-top:24px"><div class="bx-panel-head"><h3>عن الدورة</h3></div><p style="margin:0">${esc(c.summary || c.title)}</p></section>
      </main>
      <aside class="bx-currside" aria-label="محتوى الدورة"><header><h2>${esc(c.title)}</h2>
        <div class="bx-progress" role="progressbar" aria-valuenow="${pct()}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدمك"><i style="width:${pct()}%"></i></div>
        <span class="bx-hint">أنهيت ${done()} من ${lects.length} محاضرة · الشهادة تُفتح عند إتمام الدورة</span></header>
        <div class="bx-module">${lects.map((l) => `<a class="bx-lesson${unlocked(l) ? '' : ' bx-locked'}" href="watch.html?c=${esc(c.slug)}&l=${l.id}" data-l="${l.id}" aria-current="${l === cur}" ${unlocked(l) ? '' : 'aria-disabled="true"'}>${lessonIcon(l)}<div><b>${esc(l.title)}</b>${l.is_preview && !sub ? '<small class="bx-hint" style="display:block">معاينة مجانية</small>' : ''}</div><span class="bx-lesson-dur">${l.duration_seconds ? dur(l.duration_seconds) : ''}</span></a>`).join('')}</div></aside></div>`;
      $$('.bx-lesson', root).forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault(); const l = lects.find((x) => x.id === a.dataset.l);
        if (!unlocked(l)) return toast(`ستُفتح هذه المحاضرة عندما تشاهد ${PASS}٪ من المحاضرة السابقة.`);
        cur = l; history.replaceState(null, '', `watch.html?c=${encodeURIComponent(c.slug)}&l=${cur.id}`); draw();
      }));
      const go = (j) => { cur = lects[j]; history.replaceState(null, '', `watch.html?c=${encodeURIComponent(c.slug)}&l=${cur.id}`); draw(); window.scrollTo(0, 0); };
      const pv = $('#prev'); if (pv) pv.onclick = () => go(i - 1);
      $('#next').onclick = () => { if (i < lects.length - 1 && seen(cur) >= PASS) go(i + 1); };
      loadVideo();
      $$('[data-ask]', root).forEach((b) => (b.onclick = () => window.Chat && Chat.askCourse(b.dataset.ask)));
    }

    function lpText() { const v = Math.round(seen(cur)); return v >= 95 ? 'أنهيت هذه المحاضرة ✓ ويمكنك الرجوع إلى أي جزء منها' : v >= PASS ? `شاهدت ${v}٪ · فُتحت المحاضرة التالية` : `شاهدت ${v}٪ · تابع حتى ${PASS}٪ لتفتح المحاضرة التالية`; }
    // refresh the bits that depend on progress without reloading the video
    function paintProgress() {
      const i = lects.indexOf(cur);
      $$('.bx-lesson', root).forEach((a) => { const l = lects.find((x) => x.id === a.dataset.l); a.classList.toggle('bx-locked', !unlocked(l)); a.toggleAttribute('aria-disabled', !unlocked(l)); const ic = $('.bx-lesson-ic', a); if (ic) ic.outerHTML = lessonIcon(l); });
      const nx = $('#next', root); if (nx) { nx.disabled = !(i < lects.length - 1 && seen(cur) >= PASS); nx.textContent = nextLabel(i); }
      const b = $('#lpbar', root); if (b) b.style.width = Math.round(seen(cur)) + '%';
      const t = $('#lptxt', root); if (t) t.textContent = lpText();
      const bar = $('.bx-currside .bx-progress i', root); if (bar) bar.style.width = pct() + '%';
      const h = $('.bx-currside header .bx-hint', root); if (h) h.textContent = `أنهيت ${done()} من ${lects.length} محاضرة · الشهادة تُفتح عند إتمام الدورة`;
    }
    let lastSent = 0, lastPct = 0, certShown = false, busy = false;
    async function report(p, force) {
      const now = Date.now();
      if (busy || p <= lastPct + 0.05 && !force) return;
      if (!force && now - lastSent < 15000 && !(p >= PASS && lastPct < PASS) && !(p >= 95 && lastPct < 95)) return;
      busy = true; lastSent = now;
      try {
        const ok = Number(await sb.rpc('record_watch', { p_lecture: cur.id, p_pct: Math.min(100, Math.round(p * 100) / 100) }));
        lastPct = Math.max(lastPct, isNaN(ok) ? p : ok);
        const r = (prog[cur.id] = prog[cur.id] || { lecture_id: cur.id, max_pct: 0, completed: false });
        const before = seen(cur); r.max_pct = Math.max(r.max_pct, lastPct); if (lastPct >= 95) r.completed = true;
        paintProgress();
        if (before < PASS && lastPct >= PASS && lects.indexOf(cur) < lects.length - 1) toast('أحسنت! فُتحت المحاضرة التالية.');
        if (done() === lects.length && !certShown) { certShown = true; toast('مبروك! أنهيت الدورة وحصلت على شهادة الإتمام. تجدها في حسابك.'); }
      } catch (e) { if (force) toast(/locked/.test(e.message || '') ? `يجب أن تشاهد ${PASS}٪ من المحاضرة السابقة أولًا.` : arErr(e), 'err'); }
      busy = false;
    }

    async function loadFiles() {
      const sec = $('#files'); if (!sec) return;
      let fs = []; try { fs = await sb.get('lecture_files', { select: 'id,name,path,size_bytes', lecture_id: 'eq.' + cur.id, order: 'created_at' }); } catch {}
      if (!fs.length) { sec.hidden = true; return; }
      sec.hidden = false;
      $('#filelist', sec).innerHTML = fs.map((f) => `<div class="bx-spread" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>📄 ${esc(f.name)} <small class="bx-hint">${f.size_bytes ? (f.size_bytes / 1048576).toFixed(1) + ' MB' : ''}</small></span><button class="bx-linkbtn" data-f="${esc(f.path)}" data-n="${esc(f.name)}">تنزيل</button></div>`).join('');
      $$('[data-f]', sec).forEach((b) => (b.onclick = async () => { try { location.href = await sb.storage.signedUrl('lecture-files', b.dataset.f, 300, b.dataset.n); } catch (e) { ui.toast(arErr(e), 'err'); } }));
    }
    // ---------- anti-recording: moving personal watermark, own fullscreen, blackout on screenshot keys ----------
    let wmId = null;
    async function guardPlayer(stage) {
      if (!stage || stage.dataset.guarded) return; stage.dataset.guarded = '1';
      if (wmId === null) { wmId = ''; try { const pr = await sb.one('profiles', { select: 'phone', id: 'eq.' + sb.user.id }); wmId = (pr && pr.phone) || ''; } catch {} }
      const stamp = [sb.user.email, wmId, sb.user.id.slice(0, 8)].filter(Boolean).join(' · ');
      stage.insertAdjacentHTML('beforeend', `<div class="bx-wm-layer" aria-hidden="true"><span class="bx-wm-tag">${esc(stamp)}</span><span class="bx-wm-tile">${esc(stamp)}</span></div>
        <div class="bx-shield" hidden><b>التسجيل والتصوير ممنوعين</b><small>المحتوى محمي ومربوط بحسابك: ${esc(sb.user.email)}</small></div>
        <button type="button" class="bx-fsbtn" aria-label="ملء الشاشة" title="ملء الشاشة"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>`);
      const tag = $('.bx-wm-tag', stage), shield = $('.bx-shield', stage);
      const move = () => { tag.style.insetInlineStart = (5 + Math.random() * 55) + '%'; tag.style.top = (6 + Math.random() * 78) + '%'; };
      move(); const t = setInterval(() => { if (!stage.isConnected) return clearInterval(t); move(); }, 3500);
      $('.bx-fsbtn', stage).onclick = () => (document.fullscreenElement ? document.exitFullscreen() : (stage.requestFullscreen || stage.webkitRequestFullscreen || (() => {})).call(stage));
      stage.addEventListener('contextmenu', (e) => e.preventDefault());
      const blackout = (ms) => { shield.hidden = false; clearTimeout(blackout.t); blackout.t = setTimeout(() => (shield.hidden = true), ms || 2500); };
      const keys = (e) => {
        const k = (e.key || '').toLowerCase();
        if (k === 'printscreen' || (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) || (e.ctrlKey && e.shiftKey && k === 's') || (e.key === 'Meta' && e.shiftKey)) {
          blackout(3000); try { navigator.clipboard && navigator.clipboard.writeText(''); } catch {}
        }
      };
      if (!window.__bxKeys) { window.__bxKeys = true; document.addEventListener('keydown', keys, true); document.addEventListener('keyup', keys, true); }
    }

    async function loadVideo() {
      loadFiles();
      lastPct = seen(cur); lastSent = 0;
      let furthest = -1, warned = false;   // furthest second the student actually reached (no skipping ahead)
      const box = $('#vid'); if (!box) return;
      try {
        const r = await sb.fn('get-playback', { lecture_id: cur.id, device_id: deviceId(), device_label: deviceLabel() });
        // no native fullscreen on the iframe: our own fullscreen keeps the watermark on top of the video
        box.style.display = 'block'; box.innerHTML = `<iframe id="bunny" src="${esc(r.url)}" style="width:100%;height:100%;border:0" allow="accelerometer; gyroscope; autoplay; encrypted-media" title="${esc(cur.title)}"></iframe>`;
        guardPlayer(box.closest('.bx-video'));
        const f = $('#bunny'); const post = (o) => f.contentWindow && f.contentWindow.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', ...o }), '*');
        f.addEventListener('load', () => post({ method: 'addEventListener', value: 'ready' }));
        window.onmessage = (e) => {
          if (e.source !== f.contentWindow) return; let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
          if (!d || d.context !== 'player.js') return;
          if (d.event === 'ready') ['timeupdate', 'ended'].forEach((ev) => post({ method: 'addEventListener', value: ev }));
          else if (d.event === 'timeupdate' && d.value && d.value.duration) {
            const D = d.value.duration, t = d.value.seconds;
            if (furthest < 0) furthest = (seen(cur) / 100) * D;
            if (seen(cur) < 95 && t > furthest + 3) {           // jumped ahead: send them back to where they were
              post({ method: 'setCurrentTime', value: Math.max(0, furthest - 1) });
              if (!warned) { warned = true; toast('لا يمكنك تقديم الفيديو قبل مشاهدته، ويمكنك الرجوع إلى الخلف بشكل طبيعي.'); }
              return;
            }
            if (t > furthest) furthest = t;
            report((furthest / D) * 100);
          } else if (d.event === 'ended') { if (furthest < 0 || seen(cur) >= 95 || furthest >= (d.value && d.value.duration ? d.value.duration - 5 : 0)) report(100, true); }
        };
      } catch (e) {
        const m = (e.data && e.data.error) || e.message;
        box.innerHTML = m === 'subscription required'
          ? '<div style="text-align:center;padding:16px"><b style="display:block;color:var(--ink);font:600 18px/28px var(--font-display)">هذه الدورة متاحة للمشتركين</b>اشترك في إحدى الباقات لمشاهدة المحاضرات.<br><a class="bs-btn bs-btn-primary" style="margin-top:12px" href="pricing.html">عرض الباقات</a></div>'
          : m === 'device limit' ? '<div style="text-align:center;padding:16px"><b style="display:block;color:var(--ink);font:600 18px/28px var(--font-display)">وصلت للحد الأقصى من الأجهزة</b>حسابك مستخدم على جهازين بالفعل. أزل جهازًا قديمًا من <a class="bx-link" href="account.html#settings">حسابي ← الإعدادات</a> ثم حاول مجددًا.</div>'
          : m === 'video not available yet' ? 'هذا الفيديو لم يُرفع بعد.'
          : m === 'lecture locked' ? `ستُفتح هذه المحاضرة عندما تشاهد ${PASS}٪ من المحاضرة السابقة.` : esc(arErr(e));
      }
    }
    draw();
  };

  // ---------- certificate verification ----------
  // interactive courses: the attendee's details (printed name + phone) are required before booking
  async function attendeeThen(go) {
    if (!sb.user) return go();   // checkout sends guests to sign up first
    await sb.auth.ready;
    let me = null; try { me = await sb.one('profiles', { select: 'full_name,cert_name,phone,whatsapp', id: 'eq.' + sb.user.id }); } catch {}
    if (me && (me.cert_name || '').trim() && (me.phone || me.whatsapp)) return go();
    me = me || {};
    ui.modal(`<h3>بيانات الحجز</h3><p class="bx-hint" style="margin-top:0">قبل الحجز نحتاج إلى بياناتك لنرسل إليك مواعيد الجلسات، ونطبع اسمك بشكل صحيح على الشهادة التي ستصدر تلقائيًا يوم انتهاء الدورة.</p>
      <form class="bx-form2" novalidate><div class="bx-field"><label for="an">الاسم الكامل</label><input id="an" class="bx-input" maxlength="80" autocomplete="name" value="${esc(me.full_name || '')}"></div>
      <div class="bx-field"><label for="acn">الاسم على الشهادة (بالإنجليزي كما في جواز السفر)</label><input id="acn" class="bx-input" dir="ltr" maxlength="80" placeholder="Ahmed Mohamed Ali" value="${esc(me.cert_name || '')}"></div>
      <div class="row2"><div class="bx-field"><label for="ap">رقم الهاتف المحمول</label><input id="ap" class="bx-input" dir="ltr" type="tel" autocomplete="tel" value="${esc(me.phone || '')}"></div><div class="bx-field"><label for="aw">واتساب (إن كان مختلفًا)</label><input id="aw" class="bx-input" dir="ltr" type="tel" value="${esc(me.whatsapp || '')}"></div></div>
      <div class="bx-formmsg" aria-live="polite"></div><div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ والمتابعة للدفع</button><button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      $('form', m).onsubmit = async (e) => {
        e.preventDefault(); const v = (id) => $('#' + id, m).value.trim(), msg = $('.bx-formmsg', m), err = (t) => { msg.className = 'bx-formmsg err'; msg.textContent = t; };
        if (v('an').split(/\s+/).length < 2) return err('اكتب اسمك الكامل (اسمين على الأقل).');
        if (v('acn').split(/\s+/).length < 2 || /[؀-ۿ]/.test(v('acn'))) return err('اكتب الاسم كما سيظهر على الشهادة بحروف إنجليزية (اسمان على الأقل).');
        if (!/^\+?[\d\s-]{8,18}$/.test(v('ap'))) return err('اكتب رقم هاتف محمول صحيحًا.');
        try { await sb.update('profiles', { id: 'eq.' + sb.user.id }, { full_name: v('an'), cert_name: v('acn'), phone: v('ap'), whatsapp: v('aw') || null }); close(); go(); }
        catch (x) { err(arErr(x)); }
      };
    });
  }

  // ---------- about (من نحن): text from site_content.about (admin), live counters from about_stats() ----------
  window.waLink = (num) => { let d = String(num || '').replace(/\D/g, ''); if (/^01\d{9}$/.test(d)) d = '2' + d; else if (/^1\d{9}$/.test(d)) d = '20' + d; return d ? 'https://wa.me/' + d : ''; };
  P.about = async () => {
    const [row, st] = await Promise.all([sb.one('site_content', { select: 'data', key: 'eq.about' }).catch(() => null), sb.rpc('about_stats').catch(() => null)]);
    const A = (row && row.data) || {};
    const paras = (t) => String(t).split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('');
    ['lead', 'vision', 'mission', 'founder_name', 'founder_title', 'email', 'whatsapp'].forEach((k) => { const el = $(`[data-ab="${k}"]`); if (el && (A[k] || '').trim()) el.textContent = A[k].trim(); });
    ['story', 'founder_bio'].forEach((k) => { const el = $(`[data-ab="${k}"]`); if (el && (A[k] || '').trim()) el.innerHTML = paras(A[k]); });
    const sv = (A.services || []).filter((x) => x && x.title);
    if (sv.length) $('[data-ab-list="services"]').innerHTML = sv.map((x, i) => `<article class="ab-svc"><span class="ab-num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(x.title)}</h3>${x.desc ? `<p>${esc(x.desc)}</p>` : ''}</article>`).join('');
    if ((A.email || '').trim()) $('[data-ab-href="email"]').href = 'mailto:' + A.email.trim();
    if ((A.whatsapp || '').trim() && waLink(A.whatsapp)) $('[data-ab-href="whatsapp"]').href = waLink(A.whatsapp);
    if ((A.founder_photo || '').startsWith('https://')) { const img = $('[data-ab-img="founder_photo"]'); img.src = A.founder_photo; const src = img.previousElementSibling; if (src) src.remove(); }
    // counters: count up once when visible
    const fmt = (k, v) => (k === 'students' ? '+' : '') + Number(v).toLocaleString('en-US');
    const els = $$('[data-count]');
    const run = (el) => { const k = el.dataset.count, to = Number((st && st[k]) ?? el.dataset.base) || 0, t0 = performance.now(), dur = 1400;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(k, Math.round(to * e)); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); };
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: .4 }); els.forEach((el) => io.observe(el)); }
    else els.forEach(run);
  };

  P.verify = async () => {
    const f = $('#vf'), inp = $('#vc'), out = $('#vr');
    const run = async () => {
      const code = inp.value.trim(); if (!code) return;
      out.innerHTML = '<div class="bx-loading">جارٍ التحقق…</div>';
      try {
        const r = await sb.rpc('verify_certificate', { p_code: code });
        out.innerHTML = r && r.name
          ? `<div class="bx-banner" style="display:block;border-color:var(--success)"><b style="color:var(--success)">✓ شهادة صحيحة</b><p style="margin:8px 0 0">صادرة لـ <b>${esc(r.name)}</b> عن إتمام دورة <b class="bs-latin">${esc(r.course)}</b> بتاريخ ${new Date(r.issued_at).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })}.</p><small class="bx-hint">رقم الشهادة: <span class="bs-latin">${esc(r.code)}</span></small><div style="margin-top:12px"><a class="bs-btn bs-btn-secondary bs-btn-sm" href="certificate.html?c=${encodeURIComponent(r.code)}">عرض الشهادة</a></div></div>`
          : '<div class="bx-banner" style="display:block;border-color:var(--danger)"><b style="color:var(--danger)">لم نجد شهادة بهذا الرقم</b><p style="margin:8px 0 0">تأكد من كتابة الرقم كما هو مطبوع على الشهادة.</p></div>';
      } catch (e) { out.innerHTML = `<div class="bx-formmsg err">${esc(arErr(e))}</div>`; }
    };
    f.onsubmit = (e) => { e.preventDefault(); history.replaceState(null, '', 'verify.html?c=' + encodeURIComponent(inp.value.trim())); run(); };
    const c = new URLSearchParams(location.search).get('c'); if (c) { inp.value = c; run(); }
  };

  // ---------- blog ----------
  const inl = (t) => {
    let o = '', i = 0, m; const re = /\[([^\]]+)\]\((https:\/\/[^\s)]+|[\w./#?=&%-]+)\)|\*\*(.+?)\*\*/g;
    while ((m = re.exec(t))) { o += esc(t.slice(i, m.index)) + (m[1] ? `<a class="bx-link" href="${esc(m[2])}">${esc(m[1])}</a>` : `<b>${esc(m[3])}</b>`); i = re.lastIndex; }
    return o + esc(t.slice(i));
  };
  const md = (t) => {
    const out = []; let list = null;
    String(t || '').split(/\n/).forEach((line) => {
      const l = line.trim();
      if (/^[-•] /.test(l)) { if (!list) { list = []; out.push(list); } list.push(l.slice(2)); return; }
      list = null;
      if (!l) out.push(''); else if (l.startsWith('### ')) out.push({ h3: l.slice(4) }); else if (l.startsWith('## ')) out.push({ h: l.slice(3) }); else out.push({ p: l });
    });
    let html = '', para = [];
    const flush = () => { if (para.length) { html += `<p>${para.map(inl).join('<br>')}</p>`; para = []; } };
    out.forEach((b) => { if (Array.isArray(b)) { flush(); html += `<ul>${b.map((x) => `<li>${inl(x)}</li>`).join('')}</ul>`; } else if (b === '') flush(); else if (b.h3) { flush(); html += `<h3>${inl(b.h3)}</h3>`; } else if (b.h) { flush(); html += `<h2>${inl(b.h)}</h2>`; } else para.push(b.p); });
    flush(); return html;
  };
  const fdate = (d) => (d ? new Date(d).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  P.blog = async () => {
    const box = $('#posts');
    try {
      const posts = await sb.get('posts', { select: 'slug,title,excerpt,tag,published_at', published: 'eq.true', order: 'published_at.desc', limit: 50 });
      box.innerHTML = posts.length ? posts.map((x) => `<a class="bx-post" href="blog-${encodeURIComponent(x.slug)}.html"><small class="bx-hint">${esc(x.tag || 'مقال')} · ${fdate(x.published_at)}</small><h2>${esc(x.title)}</h2>${x.excerpt ? `<p>${esc(x.excerpt)}</p>` : ''}</a>`).join('') : '<div class="bx-empty-big"><b>لا توجد مقالات بعد</b>تابعنا قريبًا.</div>';
    } catch (e) { if (!box.querySelector('.bx-post')) box.innerHTML = `<div class="bx-empty-big"><b>تعذّر التحميل</b>${esc(arErr(e))}</div>`; }
  };
  P.article = async () => {
    const box = $('#art'), slug = document.body.dataset.slug || new URLSearchParams(location.search).get('p');
    if (!slug) { location.replace('blog.html'); return; }
    if (document.body.dataset.slug && !box.querySelector('.bx-loading')) return;   // pre-rendered SEO page
    let x; try { x = await sb.one('posts', { select: '*', slug: 'eq.' + slug, published: 'eq.true' }); } catch (e) { box.innerHTML = `<div class="bx-empty-big"><b>تعذّر التحميل</b>${esc(arErr(e))}</div>`; return; }
    if (!x) { box.innerHTML = '<div class="bx-empty-big"><b>المقال غير موجود</b><a class="bx-link" href="blog.html">كل المقالات</a></div>'; return; }
    window.setMeta && setMeta(x.title + ' | Biosyn Eg', (x.excerpt || x.body || '').slice(0, 160));
    box.innerHTML = `<nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="blog.html">المدونة</a></nav><small class="bx-hint">${esc(x.tag || 'مقال')} · ${fdate(x.published_at)}</small><h1>${esc(x.title)}</h1>${x.excerpt ? `<p class="bs-lead" style="color:var(--ink-muted)">${esc(x.excerpt)}</p>` : ''}<div class="bx-prose" style="margin-top:32px">${md(x.body)}</div><div class="bx-banner" style="display:block;margin-top:40px"><b>تعلّم أكثر مع Biosyn</b><p style="margin:6px 0 0">دورات مسجلة في العلوم الحيوية والطبية باشتراك واحد. <a class="bx-link" href="courses.html">تصفح الدورات</a></p></div>`;
  };
  window.renderPostBody = md;

  // ---------- custom forms (built in Admin → الفورمز) ----------
  P.form = async () => {
    const root = $('#form-root'), slug = new URLSearchParams(location.search).get('f');
    const fail = (h, t) => (root.innerHTML = `<div class="bx-empty-big"><b>${h}</b>${t}</div>`);
    if (!slug) return fail('النموذج غير موجود', 'تأكد من الرابط.');
    let f; try { f = await sb.one('forms', { select: 'slug,title,description,fields,submit_label,success_message,settings', slug: 'eq.' + slug }); } catch (e) { return fail('تعذّر تحميل النموذج', esc(arErr(e))); }
    if (!f) return fail('النموذج غير متاح', 'قد يكون مغلقًا أو الرابط غير صحيح.');
    document.title = f.title + ' | Biosyn Eg'; window.setMeta && setMeta(f.title + ' | Biosyn Eg', (f.description || '').slice(0, 160));
    const fld = (x) => {
      const id = 'ff-' + x.id, req = x.required ? ' required' : '', star = x.required ? ' *' : '', opts = (x.options || []).filter(Boolean);
      const lab = `<label for="${id}">${esc(x.label)}${star}</label>`;
      if (x.type === 'textarea') return `<div class="bx-field">${lab}<textarea id="${id}" class="bx-textarea" rows="4" data-k="${x.id}"${req}></textarea></div>`;
      if (x.type === 'select') return `<div class="bx-field">${lab}<select id="${id}" class="bx-select" data-k="${x.id}"${req}><option value="">اختر…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>`;
      if (x.type === 'radio' || x.type === 'checkbox') return `<fieldset class="bx-field bx-fchoices" data-k="${x.id}" data-type="${x.type}"${x.required ? ' data-req="1"' : ''}><legend>${esc(x.label)}${star}</legend>${opts.map((o, i) => `<label class="bx-check"><input type="${x.type}" name="${id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</fieldset>`;
      const type = { email: 'email', phone: 'tel', number: 'number', date: 'date' }[x.type] || 'text';
      return `<div class="bx-field">${lab}<input id="${id}" class="bx-input" type="${type}" data-k="${x.id}"${type === 'email' || type === 'tel' || type === 'number' ? ' dir="ltr"' : ''}${req}></div>`;
    };
    const ST = f.settings || {}, FL = f.fields || [];
    const timed = !!(ST.lock_on_leave || ST.total_minutes || FL.some((x) => x.time_limit));
    const lockKey = 'biosyn.formlock.' + f.slug;
    const head = `<nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><span>${esc(f.title)}</span></nav>
      <h1>${esc(f.title)}</h1>${f.description ? `<p class="bx-hint" style="margin:0 0 24px;white-space:pre-line">${esc(f.description)}</p>` : ''}`;
    const done = (title, text, extra) => (root.innerHTML = head.replace(/<p class="bx-hint"[\s\S]*<\/p>$/, '') + `<div class="bx-formcard" style="text-align:center;display:grid;gap:12px;justify-items:center"><span class="bx-cat-ic" style="width:56px;height:56px"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></span><h2 style="margin:0">${title}</h2>${text ? `<p class="bx-hint" style="margin:0">${text}</p>` : ''}${extra || ''}<a class="bs-btn bs-btn-secondary" href="index.html">العودة إلى الرئيسية</a></div>`);
    const readField = (form, x) => {
      if (x.type === 'radio' || x.type === 'checkbox') return $$(`[data-k="${x.id}"] input:checked`, form).map((i) => i.value).join('، ');
      const el = $(`[data-k="${x.id}"]`, form); return el ? el.value.trim() : '';
    };
    const send = (data) => sb.rpc('submit_form_graded', { p_slug: f.slug, p_data: data });
    const result = (r) => {
      if (!r || !r.graded || r.hidden) return '';
      const ok = r.passed, det = r.details || [];
      return `<div style="display:grid;gap:6px;justify-items:center"><b style="font-size:40px;line-height:1.1" dir="ltr">${r.score} / ${r.max}</b><span class="bx-st bx-st-${ok === false ? 'warn' : 'ok'}" style="font-size:15px">${r.percent}٪${ok === true ? ' · ناجح 🎉' : ok === false ? ` · لم تجتز (النجاح من ${r.pass_percent}٪)` : ''}</span></div>
        ${det.length ? `<ol style="text-align:start;display:grid;gap:8px;margin:8px 0 0;padding-inline-start:20px;width:100%">${det.map((d) => `<li><b dir="auto">${esc(d.label)}</b> ${d.ok ? '<span class="bx-st bx-st-ok">✓ صحيحة</span>' : '<span class="bx-st bx-st-warn">✗ خاطئة</span>'}<br><small class="bx-hint" dir="auto">إجابتك: ${esc(d.your || '—')}${d.answer && !d.ok ? ` · الإجابة الصحيحة: ${esc(d.answer)}` : ''}</small></li>`).join('')}</ol>` : ''}`;
    };
    const errText = (err) => /too many/.test(err.message) ? 'يوجد ضغط على النموذج، حاول بعد دقيقة.' : /form locked/.test(err.message) ? 'سبق أن بدأت هذا النموذج ولا يمكن فتحه مرة أخرى.' : /missing: (.+)/.test(err.message) ? 'من فضلك املأ: ' + err.message.match(/missing: (.+)/)[1] : 'تعذّر الإرسال، حاول مرة أخرى.';

    if (!timed) {
      root.innerHTML = `${head}
      <form class="bx-formcard bx-form2" id="cf" novalidate>${FL.map(fld).join('')}
        <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);pointer-events:none" aria-hidden="true">
        <div class="bx-formmsg" aria-live="polite"></div>
        <button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">${esc(f.submit_label || 'إرسال')}</button></form>`;
      const form = $('#cf'), msg = $('.bx-formmsg', form), btn = $('button[type=submit]', form);
      form.onsubmit = async (e) => {
        e.preventDefault(); if (form.website.value) return;
        const data = {}; let missing = null;
        for (const x of FL) {
          const v = readField(form, x);
          if (x.required && !v) { missing = missing || x.label; }
          if (v && x.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) { msg.className = 'bx-formmsg err'; msg.textContent = `البريد الإلكتروني في "${x.label}" غير صحيح.`; return; }
          data[x.id] = v;
        }
        if (missing) { msg.className = 'bx-formmsg err'; msg.textContent = `من فضلك املأ: ${missing}`; return; }
        btn.disabled = true; msg.className = 'bx-formmsg'; msg.textContent = 'جارٍ الإرسال…';
        try { const r = await send(data); window.track && track('lead', { type: 'form:' + f.slug }); done(esc(f.success_message || (r && r.graded ? 'شكرًا! هذه نتيجتك.' : 'شكرًا! وصلنا ردك وسيتواصل معك فريق Biosyn قريبًا.')), '', result(r)); }
        catch (err) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = errText(err); }
      };
      return;
    }

    // ---- timed form: intro → one question at a time → auto submit; leaving the page closes it ----
    let locked = false; try { locked = localStorage.getItem(lockKey) === '1'; } catch (e) {}
    if (locked) { root.innerHTML = head + '<div class="bx-empty-big"><b>أُغلق هذا النموذج</b>سبق أن بدأته من هذا الجهاز، ولا يمكن فتحه مرة أخرى.</div>'; return; }
    const perQ = FL.some((x) => x.time_limit), totalSec = ST.total_minutes ? ST.total_minutes * 60 : 0;
    const rules = [totalSec ? `الوقت الكلي: <b>${ST.total_minutes} دقيقة</b>، ويُرسل النموذج تلقائيًا عند انتهائه.` : '', perQ ? 'بعض الأسئلة لها وقت محدد يظهر أعلاها، وعند انتهائه تنتقل تلقائيًا للسؤال التالي.' : '', perQ ? 'تظهر الأسئلة سؤالًا تلو الآخر، ولا يمكن الرجوع إلى سؤال سابق.' : '',
      ST.lock_on_leave ? '<b>إذا غادرت الصفحة أو بدّلت التبويب أو التطبيق، يُغلق النموذج فورًا ويُرسل ما أجبت عنه حتى تلك اللحظة.</b>' : '', 'لا يمكن بدء النموذج أكثر من مرة.'].filter(Boolean);
    root.innerHTML = `${head}<div class="bx-formcard" style="display:grid;gap:14px"><h2 style="margin:0">⏱ نموذج مؤقت</h2><ul class="bx-hint" style="margin:0;padding-inline-start:20px;display:grid;gap:6px">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
      <div class="bx-formmsg" aria-live="polite"></div><button type="button" class="bs-btn bs-btn-primary bs-btn-lg" id="fstart" style="justify-self:start">ابدأ الآن</button></div>`;
    $('#fstart').onclick = async (ev) => {
      const b = ev.target; b.disabled = true;
      let att = null; try { att = await sb.rpc('form_start', { p_slug: f.slug }); } catch (err) { b.disabled = false; const m = $('.bx-formmsg', root); m.className = 'bx-formmsg err'; m.textContent = errText(err); return; }
      try { localStorage.setItem(lockKey, '1'); } catch (e) {}
      run(att && att.attempt);
    };
    function run(attempt) {
      const data = {}, timedOut = [], t0 = Date.now(); let i = 0, qTimer = null, tTimer = null, finished = false, qEnd = 0;
      const steps = perQ ? FL.map((x) => [x]) : [FL];
      root.innerHTML = `${head.replace(/<p class="bx-hint"[\s\S]*<\/p>$/, '')}<div class="bx-formcard bx-form2" id="tf">
        <div class="bx-row" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="bx-hint" id="tstep"></span><b id="ttotal" dir="ltr" style="font-variant-numeric:tabular-nums"></b></div>
        <div id="tq"></div><div style="height:6px;border-radius:6px;background:var(--surface-raised);overflow:hidden" id="tbarw" hidden><div id="tbar" style="height:100%;width:100%;background:var(--brand-lime);transition:width .25s linear"></div></div>
        <div class="bx-formmsg" aria-live="polite"></div><button type="button" class="bs-btn bs-btn-primary bs-btn-lg" id="tnext" style="justify-self:start"></button></div>`;
      const card = $('#tf'), msg = $('.bx-formmsg', card), nextB = $('#tnext');
      const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      const collect = () => steps[i].forEach((x) => { data[x.id] = readField(card, x); });
      const finish = async (left) => {
        if (finished) return; finished = true; clearInterval(qTimer); clearInterval(tTimer);
        document.removeEventListener('visibilitychange', onHide); window.removeEventListener('blur', onBlur); window.removeEventListener('pagehide', onHide);
        try { collect(); } catch (e) {}
        const payload = { ...data, __meta: { attempt, left_page: !!left, timed_out: timedOut } };
        if (left) {
          try { fetch(`${BIOSYN.SUPABASE_URL}/rest/v1/rpc/submit_form_graded`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', apikey: BIOSYN.SUPABASE_KEY, Authorization: 'Bearer ' + ((sb.session && sb.session.access_token) || BIOSYN.SUPABASE_KEY) }, body: JSON.stringify({ p_slug: f.slug, p_data: payload }) }).catch(() => {}); } catch (e) {}
          root.innerHTML = head.replace(/<p class="bx-hint"[\s\S]*<\/p>$/, '') + '<div class="bx-empty-big"><b>أُغلق النموذج</b>غادرت الصفحة أثناء الإجابة، فأُرسلت إجاباتك حتى تلك اللحظة ولا يمكن إكمال النموذج.</div>';
          return;
        }
        nextB.disabled = true; msg.className = 'bx-formmsg'; msg.textContent = 'جارٍ الإرسال…';
        try { const r = await send(payload); window.track && track('lead', { type: 'form:' + f.slug }); done(esc(f.success_message || 'شكرًا! وصلت إجاباتك.'), timedOut.length ? `انتهى وقت ${timedOut.length} من الأسئلة قبل الإجابة عنها.` : '', result(r)); }
        catch (err) { finished = false; nextB.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = errText(err); }
      };
      const onHide = (e) => { if (!ST.lock_on_leave || finished) return; if (document.visibilityState === 'hidden' || (e && e.type === 'pagehide')) finish(true); };
      const onBlur = () => { if (!ST.lock_on_leave) return; setTimeout(() => { if (!document.hasFocus() && !finished) finish(true); }, 1500); };
      if (ST.lock_on_leave) { document.addEventListener('visibilitychange', onHide); window.addEventListener('blur', onBlur); window.addEventListener('pagehide', onHide); }
      if (totalSec) {
        const tick = () => { const left = Math.max(0, totalSec - Math.floor((Date.now() - t0) / 1000)); $('#ttotal').textContent = '⏱ ' + fmt(left); if (!left) { steps.slice(i).forEach((st) => st.forEach((x) => { if (!readField(card, x)) timedOut.push(x.id); })); finish(false); } };
        tick(); tTimer = setInterval(tick, 500);
      }
      const show = () => {
        clearInterval(qTimer); msg.textContent = ''; msg.className = 'bx-formmsg';
        $('#tq').innerHTML = steps[i].map(fld).join('');
        $('#tstep').textContent = perQ ? `السؤال ${i + 1} من ${steps.length}` : '';
        nextB.textContent = i === steps.length - 1 ? (f.submit_label || 'إرسال') : 'التالي ←';
        const lim = perQ ? steps[i][0].time_limit : 0;
        $('#tbarw').hidden = !lim;
        if (lim) {
          qEnd = Date.now() + lim * 1000;
          const tick = () => { const left = Math.max(0, qEnd - Date.now()); $('#tbar').style.width = (left / (lim * 1000)) * 100 + '%'; $('#tstep').textContent = `السؤال ${i + 1} من ${steps.length} · متبقٍّ ${Math.ceil(left / 1000)} ثانية`;
            if (!left) { collect(); steps[i].forEach((x) => { if (!data[x.id]) timedOut.push(x.id); }); advance(true); } };
          tick(); qTimer = setInterval(tick, 250);
        }
        const first = $('#tq input, #tq textarea, #tq select'); if (first) first.focus();
      };
      const advance = (auto) => {
        if (!auto) {
          collect();
          const miss = steps[i].find((x) => x.required && !data[x.id]); if (miss) { msg.className = 'bx-formmsg err'; msg.textContent = `من فضلك أجب عن: ${miss.label}`; return; }
          const badMail = steps[i].find((x) => x.type === 'email' && data[x.id] && !/^\S+@\S+\.\S+$/.test(data[x.id])); if (badMail) { msg.className = 'bx-formmsg err'; msg.textContent = `البريد الإلكتروني في "${badMail.label}" غير صحيح.`; return; }
        }
        if (i >= steps.length - 1) { finish(false); return; }
        i++; show();
      };
      nextB.onclick = () => advance(false);
      show();
    }
  };
})();
