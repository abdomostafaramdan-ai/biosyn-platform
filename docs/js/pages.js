/* Page logic: login, course, watch (dashboards are in dash.js). */
(() => {
  'use strict';
  const P = window.BiosynPages = window.BiosynPages || {};
  const { toast } = window.ui;
  const dur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60), r = s % 60; return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0'); };
  const hoursText = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} ساعة${m % 60 ? ' و' + (m % 60) + ' دقيقة' : ''}` : `${m} دقيقة`; };
  const nextUrl = () => { const n = new URLSearchParams(location.search).get('next') || ''; return /^[a-z-]+\.html(\?[\w=&%.-]*)?$/i.test(n) ? n : 'account.html'; };
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  // ---------- login ----------
  P.login = () => {
    if (sb.user) { location.replace(nextUrl()); return; }
    const $ = window.$;
    const show = (up) => {
      $('#f-in').hidden = up; $('#f-up').hidden = !up;
      $('#tab-in').setAttribute('aria-selected', String(!up)); $('#tab-up').setAttribute('aria-selected', String(up));
      $('#auth-h').textContent = up ? 'إنشاء حساب Biosyn' : 'تسجيل الدخول';
      $('#auth-eb').textContent = up ? 'إنشاء حساب جديد' : 'أهلاً بعودتك';
      $('#auth-sub').textContent = up ? 'أدخل بياناتك لبدء رحلتك التعليمية.' : 'سجّل دخولك للوصول إلى مساحتك التعليمية.';
    };
    $('#tab-in').onclick = () => show(false); $('#tab-up').onclick = () => show(true);
    if (new URLSearchParams(location.search).get('mode') === 'signup') show(true);
    const say = (id, t, k) => { const m = $(id); m.textContent = t; m.className = 'bx-formmsg' + (k ? ' ' + k : ''); };
    const authErr = (e) => /invalid login/i.test(e.message) ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : /already registered/i.test(e.message) ? 'هذا البريد مسجّل بالفعل، سجّل الدخول.' : /email not confirmed/i.test(e.message) ? 'أكّد بريدك الإلكتروني أولًا من الرسالة التي وصلتك.' : /rate limit/i.test(e.message) ? 'محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة.' : window.arErr(e);

    $('#f-in').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const b = $('button[type=submit]', ev.target); b.disabled = true; say('#m-in', 'جارٍ تسجيل الدخول…');
      try { await sb.auth.signIn($('#l-e').value.trim(), $('#l-p').value); location.href = nextUrl(); }
      catch (e) { say('#m-in', authErr(e), 'err'); b.disabled = false; }
    });
    $('#f-up').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const b = $('button[type=submit]', ev.target);
      const n = $('#r-n').value.trim(), e = $('#r-e').value.trim(), p = $('#r-p').value;
      if (!n) return say('#m-up', 'اكتب اسمك الكامل.', 'err');
      if (!/^\S+@\S+\.\S+$/.test(e)) return say('#m-up', 'اكتب بريدًا إلكترونيًا صحيحًا.', 'err');
      if (p.length < 8) return say('#m-up', 'كلمة المرور يجب ألا تقل عن 8 أحرف.', 'err');
      if (!$('#r-c').checked) return say('#m-up', 'يرجى الموافقة على الشروط للمتابعة.', 'err');
      b.disabled = true; say('#m-up', 'جارٍ إنشاء الحساب…');
      try {
        let ref = null; try { ref = localStorage.getItem('biosyn.ref'); } catch {}
        const r = await sb.auth.signUp(e, p, n, ref ? { ref } : null);
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

  P.course = async () => {
    const root = $('#course-root'), slug = new URLSearchParams(location.search).get('c');
    if (!slug) { location.replace('courses.html'); return; }
    let c;
    try { c = await sb.one('courses', { select: '*,lectures(id,position,title,duration_seconds,is_preview)', slug: 'eq.' + slug }); } catch (e) { root.innerHTML = `<div class="bx-empty-big" style="margin:80px 16px"><b>تعذّر تحميل الدورة</b>${esc(arErr(e))}</div>`; return; }
    if (!c) { root.innerHTML = '<div class="bx-empty-big" style="margin:80px auto;max-width:560px"><b>هذه الدورة غير متاحة</b>قد تكون غير منشورة بعد. <a class="bx-link" href="courses.html">تصفح الدورات</a></div>'; return; }
    if (c.kind === 'interactive') {
      document.title = c.title + ' | Biosyn Egypt';
      const ins = await sb.get('public_instructors', { select: '*', id: 'eq.' + (c.instructor_id || '00000000-0000-0000-0000-000000000000') }).catch(() => []);
      const iname = ins[0] && ins[0].full_name;
      const fc = window.facOf ? window.facOf(c) : null, I = window.BX_ICO || {};
      root.innerHTML = `<section class="bs-course-hero"><span class="bs-wm" aria-hidden="true"></span><div class="bs-course-hero-in"><div>
        <nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="interactive.html">دورات تفاعلية</a><span>/</span><span class="bs-latin">${esc(c.title)}</span></nav>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="bs-badge bs-badge-info">دورة تفاعلية</span>${fc ? `<span class="bs-badge bs-badge-member">${esc(fc.name)}</span>` : ''}${c.specialty ? `<span class="bs-badge bs-badge-member">${esc(c.specialty)}</span>` : ''}</div>
        <h1 dir="auto">${esc(c.title)}</h1>${c.summary ? `<p class="bs-lead">${esc(c.summary)}</p>` : ''}
        ${iname ? `<div class="bs-teacher"><div class="bs-inst-photo"><span>${esc(iname.charAt(0))}</span></div><div><small>المحاضر</small><b class="bs-latin">${esc(iname)}</b></div></div>` : ''}
        </div><div class="bs-spacer"></div></div></section>
        <div class="bs-course-main"><div>${c.description ? `<section class="bs-block-sec" style="margin-top:48px"><h2>عن الدورة</h2>${c.description.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : '<div style="height:48px"></div>'}
        <section class="bs-block-sec"><h2>سياسة الاسترداد</h2><p>يمكن استرداد رسوم الدورة التفاعلية خلال 7 أيام من تاريخ الدفع.</p></section></div>
        <aside class="bs-enroll"><div class="bs-cover bx-icover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span>${fc ? `<span class="bx-pcard-ic"><svg viewBox="0 0 24 24">${fc.icon}</svg></span><span class="bx-pcard-fac">${esc(fc.name)}</span>` : `<span class="bs-cover-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</span>`}</div>
        <div class="bs-enroll-body"><div class="bs-enroll-access"><b>${EGP(c.price_egp)} ج.م</b></div>
        <ul class="bx-pcard-facts bx-ifacts">${c.starts_at ? `<li>${I.cal}<span>يبدأ ${esc(window.fmtDay(c.starts_at))}</span></li>` : ''}${c.seats ? `<li>${I.seat}<span>${c.seats} مقعد</span></li>` : ''}${LEVEL[c.level] ? `<li>${I.lvl}<span>${LEVEL[c.level]}</span></li>` : ''}<li>${I.live}<span>مباشر أونلاين</span></li></ul>
        <button type="button" class="bs-btn bs-btn-primary bs-btn-lg bs-block" id="reg">سجّل الآن</button>
        <p class="bx-hint">دورة تفاعلية بجلسات مباشرة، منفصلة عن باقات الاشتراك.</p></div></aside></div>`;
      $('#reg').onclick = () => window.checkout({ course_id: c.id, title: c.title, price: c.price_egp });
      return;
    }
    document.title = c.title + ' | Biosyn Egypt';
    window.track && track('view_content', { item: c.title, id: c.id });
    window.setMeta && setMeta(c.title + ' | Biosyn Egypt', (c.summary || c.description || 'دورة مسجلة على منصة Biosyn Egypt').slice(0, 160));
    const lects = (c.lectures || []).sort((a, b) => a.position - b.position);
    const total = lects.reduce((s, l) => s + (l.duration_seconds || 0), 0);
    const [insts, plans, subscribed] = await Promise.all([sb.get('public_instructors', { select: '*', id: 'eq.' + (c.instructor_id || '00000000-0000-0000-0000-000000000000') }).catch(() => []), sb.get('plans', { select: '*', active: 'eq.true', order: 'duration_months' }).catch(() => []), hasSubscription()]);
    const inst = insts[0] && insts[0].full_name;
    const from = plans[0];
    const first = lects[0];
    const cta = subscribed
      ? `<a class="bs-btn bs-btn-primary bs-btn-lg bs-block" href="watch.html?c=${esc(c.slug)}">${lects.length ? 'ابدأ المشاهدة' : 'المحاضرات قريبًا'}</a>`
      : `<a class="bs-btn bs-btn-primary bs-btn-lg bs-block" href="#plans" id="cta-sub">اشترك لمشاهدة الدورة</a>`;
    root.innerHTML = `<section class="bs-course-hero"><span class="bs-wm" aria-hidden="true"></span><div class="bs-course-hero-in"><div>
      <nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="courses.html">دورات مسجلة</a><span>/</span><span class="bs-latin">${esc(c.title)}</span></nav>
      <div style="display:flex;gap:8px"><span class="bs-badge bs-badge-neutral">${LEVEL[c.level] || 'مبتدئ'}</span><span class="bs-badge bs-badge-info">دورة مسجلة</span></div>
      <h1>${esc(c.title)}</h1>
      ${c.summary ? `<p class="bs-lead">${esc(c.summary)}</p>` : ''}
      <div class="bs-stats"><span><b>${lects.length}</b> محاضرة</span>${total ? `<span><b>${esc(hoursText(total))}</b></span>` : ''}<span>بالعربية</span></div>
      ${inst ? `<div class="bs-teacher"><div class="bs-inst-photo"><span>${esc(inst.charAt(0))}</span></div><div><small>المحاضر</small><b class="bs-latin">${esc(inst)}</b></div></div>` : ''}
      </div><div class="bs-spacer"></div></div></section>
    <div class="bs-course-main"><div>
      ${c.description ? `<section class="bs-block-sec" style="margin-top:48px"><h2>عن الدورة</h2>${c.description.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
      <section class="bs-block-sec" style="${c.description ? '' : 'margin-top:48px'}"><h2>محتوى الدورة</h2>
        ${lects.length ? `<div class="bs-curr"><div class="bs-curr-head"><b>محتوى الدورة</b><span>${lects.length} محاضرة${total ? ' · ' + esc(hoursText(total)) : ''}</span></div><ol class="bs-curr-list">${lects.map((l, i) => `<li class="bs-curr-item"><span class="bs-curr-num bs-latin">${String(i + 1).padStart(2, '0')}</span><span class="bs-play" aria-hidden="true">${subscribed || l.is_preview ? ICON_PLAY : ICON_LOCK}</span><span class="bs-curr-title bs-latin">${subscribed || l.is_preview ? `<a href="watch.html?c=${esc(c.slug)}&l=${l.id}" style="color:inherit;text-decoration:none">${esc(l.title)}</a>` : esc(l.title)}${!subscribed && l.is_preview ? ' <span class="bs-badge bs-badge-new" style="margin-inline-start:6px">معاينة مجانية</span>' : ''}</span><span class="bs-curr-dur bs-latin">${l.duration_seconds ? dur(l.duration_seconds) : ''}</span></li>`).join('')}</ol></div>` : '<div class="bx-empty-big"><b>المحاضرات قيد الإضافة</b>سنعلن عند نشر الدورة كاملة.</div>'}
      </section></div>
      <aside class="bs-enroll"><div class="bs-cover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span><span class="bs-cover-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</span></div>
        <div class="bs-enroll-body"><div class="bs-enroll-access"><span>${subscribed ? 'اشتراكك ساري' : 'متاحة مع الاشتراك'}</span>${!subscribed && from ? `<b>تبدأ من ${EGP(from.price_egp)} ج.م / ${from.duration_months === 1 ? 'شهريًا' : from.duration_months + ' أشهر'}</b>` : ''}</div>
        ${cta}
        <ul class="bs-checks bs-checks-sm"><li>${ICON_CHECK}<span>${lects.length} محاضرة مسجلة${total ? ' (حوالي ' + esc(hoursText(total)) + ')' : ''}</span></li><li>${ICON_CHECK}<span>شهادة إتمام عند إنهاء الكورس</span></li><li>${ICON_CHECK}<span>مستوى ${LEVEL[c.level] || 'مبتدئ'} · بالعربية</span></li></ul></div></aside></div>
    ${subscribed ? '' : `<section class="bs-section" id="plans"><div class="bs-section-head"><div><h2>متاحة مع باقات العضوية</h2><p>باشتراك واحد، ادرس كل الكورسات المسجلة على المنصة</p></div></div><div class="bs-plans">${plans.map(() => '<template-slot></template-slot>').join('')}</div></section>`}`;
    // plan cards: reuse the design markup, filled by app.js's hydratePlans() (called again here)
    const tpl = $('#plan-card');
    $$('template-slot', root).forEach((s) => s.replaceWith(tpl.content.cloneNode(true)));
    window.hydratePlansNow && window.hydratePlansNow();
    const cs = $('#cta-sub'); if (cs) cs.addEventListener('click', (e) => { e.preventDefault(); $('#plans').scrollIntoView({ behavior: 'smooth' }); });
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
    document.title = c.title + ' | Biosyn Egypt';

    let prog = {};
    const loadProg = async () => {
      try { (await sb.get('lecture_progress', { select: 'lecture_id,max_pct,completed', lecture_id: 'in.(' + lects.map((l) => l.id).join(',') + ')' })).forEach((r) => (prog[r.lecture_id] = r)); } catch {}
    };
    await loadProg();
    const sub = await hasSubscription();
    const pool = sub ? lects : lects.filter((l) => l.is_preview).length ? lects.filter((l) => l.is_preview) : lects;
    let cur = lects.find((l) => l.id === q.get('l')) || pool.find((l) => !(prog[l.id] && prog[l.id].completed)) || pool[0];
    const done = () => lects.filter((l) => prog[l.id] && prog[l.id].completed).length;
    const pct = () => Math.round((done() / lects.length) * 100);

    function draw() {
      const i = lects.indexOf(cur);
      root.innerHTML = `<div class="bx-player"><main class="bx-stage">
        <div class="bx-video" role="group" aria-label="مشغل الفيديو" style="padding:0;overflow:hidden"><div id="vid" style="position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-muted)">جارٍ تجهيز الفيديو…</div></div>
        <div class="bx-lesson-head"><div><span class="bx-eyebrow">المحاضرة ${i + 1} من ${lects.length}</span><h2>${esc(cur.title)}</h2></div>
          <div class="bx-lesson-nav">${i > 0 ? '<button type="button" class="bs-btn bs-btn-secondary" id="prev">السابقة</button>' : ''}<button type="button" class="bs-btn bs-btn-primary" id="next">${i < lects.length - 1 ? 'أكملت المحاضرة · التالية' : 'أكملت المحاضرة'}</button></div></div>
        <section class="bx-panel" id="files" style="margin-top:24px" hidden><div class="bx-panel-head"><h3>ملفات المحاضرة</h3></div><div id="filelist"></div></section>
        <section class="bx-panel" style="margin-top:24px"><div class="bx-panel-head"><h3>عن الدورة</h3></div><p style="margin:0">${esc(c.summary || c.title)}</p></section>
      </main>
      <aside class="bx-currside" aria-label="محتوى الدورة"><header><h2>${esc(c.title)}</h2>
        <div class="bx-progress" role="progressbar" aria-valuenow="${pct()}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدمك"><i style="width:${pct()}%"></i></div>
        <span class="bx-hint">أنهيت ${done()} من ${lects.length} محاضرة · الشهادة تُفتح عند إتمام الدورة</span></header>
        <div class="bx-module">${lects.map((l) => { const d = prog[l.id] && prog[l.id].completed; return `<a class="bx-lesson" href="watch.html?c=${esc(c.slug)}&l=${l.id}" data-l="${l.id}" aria-current="${l === cur}"><span class="bx-lesson-ic ${d ? 'done' : l === cur ? 'now' : ''}">${d ? ICON_CHECK : !sub && !l.is_preview ? ICON_LOCK : ICON_PLAY}</span><div><b>${esc(l.title)}</b>${l.is_preview && !sub ? '<small class="bx-hint" style="display:block">معاينة مجانية</small>' : ''}</div><span class="bx-lesson-dur">${l.duration_seconds ? dur(l.duration_seconds) : ''}</span></a>`; }).join('')}</div></aside></div>`;
      $$('.bx-lesson', root).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); cur = lects.find((l) => l.id === a.dataset.l); history.replaceState(null, '', `watch.html?c=${encodeURIComponent(c.slug)}&l=${cur.id}`); draw(); }));
      const go = (j) => { cur = lects[j]; history.replaceState(null, '', `watch.html?c=${encodeURIComponent(c.slug)}&l=${cur.id}`); draw(); window.scrollTo(0, 0); };
      const pv = $('#prev'); if (pv) pv.onclick = () => go(i - 1);
      $('#next').onclick = async () => { await report(100, true); if (i < lects.length - 1) go(i + 1); else draw(); };
      loadVideo();
    }

    let lastSent = 0, lastPct = 0, certShown = false;
    async function report(p, force) {
      const now = Date.now();
      if (!force && now - lastSent < 15000 && !(p >= 50 && lastPct < 50) && !(p >= 95 && lastPct < 95)) return;
      lastSent = now; lastPct = Math.max(lastPct, p);
      try {
        await sb.rpc('record_progress', { p_lecture: cur.id, p_pct: Math.min(100, Math.round(p * 100) / 100) });
        const r = (prog[cur.id] = prog[cur.id] || { lecture_id: cur.id, max_pct: 0, completed: false });
        r.max_pct = Math.max(r.max_pct, p); if (p >= 95) r.completed = true;
        const a = $(`.bx-lesson[data-l="${cur.id}"] .bx-lesson-ic`, root); if (a && r.completed) { a.className = 'bx-lesson-ic done'; a.innerHTML = ICON_CHECK; }
        const bar = $('.bx-progress i', root); if (bar) bar.style.width = pct() + '%';
        if (done() === lects.length && !certShown) { certShown = true; toast('مبروك! أنهيت الدورة وحصلت على شهادة الإتمام. تجدها في حسابك.'); }
      } catch (e) { if (force) toast(arErr(e), 'err'); }
    }

    async function loadFiles() {
      const sec = $('#files'); if (!sec) return;
      let fs = []; try { fs = await sb.get('lecture_files', { select: 'id,name,path,size_bytes', lecture_id: 'eq.' + cur.id, order: 'created_at' }); } catch {}
      if (!fs.length) { sec.hidden = true; return; }
      sec.hidden = false;
      $('#filelist', sec).innerHTML = fs.map((f) => `<div class="bx-spread" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>📄 ${esc(f.name)} <small class="bx-hint">${f.size_bytes ? (f.size_bytes / 1048576).toFixed(1) + ' MB' : ''}</small></span><button class="bx-linkbtn" data-f="${esc(f.path)}" data-n="${esc(f.name)}">تنزيل</button></div>`).join('');
      $$('[data-f]', sec).forEach((b) => (b.onclick = async () => { try { location.href = await sb.storage.signedUrl('lecture-files', b.dataset.f, 300, b.dataset.n); } catch (e) { ui.toast(arErr(e), 'err'); } }));
    }
    async function loadVideo() {
      loadFiles();
      lastPct = (prog[cur.id] && prog[cur.id].max_pct) || 0; lastSent = 0;
      const box = $('#vid'); if (!box) return;
      try {
        const r = await sb.fn('get-playback', { lecture_id: cur.id, device_id: deviceId(), device_label: deviceLabel() });
        box.style.display = 'block'; box.innerHTML = `<iframe id="bunny" src="${esc(r.url)}" style="width:100%;height:100%;border:0" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(cur.title)}"></iframe>`;
        const f = $('#bunny'); const post = (o) => f.contentWindow && f.contentWindow.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', ...o }), '*');
        f.addEventListener('load', () => post({ method: 'addEventListener', value: 'ready' }));
        window.onmessage = (e) => {
          if (e.source !== f.contentWindow) return; let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
          if (!d || d.context !== 'player.js') return;
          if (d.event === 'ready') ['timeupdate', 'ended'].forEach((ev) => post({ method: 'addEventListener', value: ev }));
          else if (d.event === 'timeupdate' && d.value && d.value.duration) report((d.value.seconds / d.value.duration) * 100);
          else if (d.event === 'ended') report(100, true);
        };
      } catch (e) {
        const m = (e.data && e.data.error) || e.message;
        box.innerHTML = m === 'subscription required'
          ? '<div style="text-align:center;padding:16px"><b style="display:block;color:var(--ink);font:600 18px/28px var(--font-display)">هذه الدورة متاحة للمشتركين</b>اشترك في إحدى الباقات لمشاهدة المحاضرات.<br><a class="bs-btn bs-btn-primary" style="margin-top:12px" href="pricing.html">عرض الباقات</a></div>'
          : m === 'device limit' ? '<div style="text-align:center;padding:16px"><b style="display:block;color:var(--ink);font:600 18px/28px var(--font-display)">وصلت للحد الأقصى من الأجهزة</b>حسابك مستخدم على جهازين بالفعل. أزل جهازًا قديمًا من <a class="bx-link" href="account.html#settings">حسابي ← الإعدادات</a> ثم حاول مجددًا.</div>'
          : m === 'video not available yet' ? 'هذا الفيديو لم يُرفع بعد.' : esc(arErr(e));
      }
    }
    draw();
  };

  // ---------- certificate verification ----------
  P.verify = async () => {
    const f = $('#vf'), inp = $('#vc'), out = $('#vr');
    const run = async () => {
      const code = inp.value.trim(); if (!code) return;
      out.innerHTML = '<div class="bx-loading">جارٍ التحقق…</div>';
      try {
        const r = await sb.rpc('verify_certificate', { p_code: code });
        out.innerHTML = r && r.name
          ? `<div class="bx-banner" style="display:block;border-color:var(--success)"><b style="color:var(--success)">✓ شهادة صحيحة</b><p style="margin:8px 0 0">صادرة لـ <b>${esc(r.name)}</b> عن إتمام دورة <b class="bs-latin">${esc(r.course)}</b> بتاريخ ${new Date(r.issued_at).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })}.</p><small class="bx-hint">رقم الشهادة: <span class="bs-latin">${esc(r.code)}</span></small></div>`
          : '<div class="bx-banner" style="display:block;border-color:var(--danger)"><b style="color:var(--danger)">لم نجد شهادة بهذا الرقم</b><p style="margin:8px 0 0">تأكد من كتابة الرقم كما هو مطبوع على الشهادة.</p></div>';
      } catch (e) { out.innerHTML = `<div class="bx-formmsg err">${esc(arErr(e))}</div>`; }
    };
    f.onsubmit = (e) => { e.preventDefault(); history.replaceState(null, '', 'verify.html?c=' + encodeURIComponent(inp.value.trim())); run(); };
    const c = new URLSearchParams(location.search).get('c'); if (c) { inp.value = c; run(); }
  };

  // ---------- blog ----------
  const md = (t) => {
    const out = []; let list = null;
    String(t || '').split(/\n/).forEach((line) => {
      const l = line.trim();
      if (/^[-•] /.test(l)) { if (!list) { list = []; out.push(list); } list.push(l.slice(2)); return; }
      list = null;
      if (!l) out.push(''); else if (l.startsWith('## ')) out.push({ h: l.slice(3) }); else out.push({ p: l });
    });
    let html = '', para = [];
    const flush = () => { if (para.length) { html += `<p>${para.map(esc).join('<br>')}</p>`; para = []; } };
    out.forEach((b) => { if (Array.isArray(b)) { flush(); html += `<ul>${b.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; } else if (b === '') flush(); else if (b.h) { flush(); html += `<h2>${esc(b.h)}</h2>`; } else para.push(b.p); });
    flush(); return html;
  };
  const fdate = (d) => (d ? new Date(d).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  P.blog = async () => {
    const box = $('#posts');
    try {
      const posts = await sb.get('posts', { select: 'slug,title,excerpt,tag,published_at', published: 'eq.true', order: 'published_at.desc', limit: 50 });
      box.innerHTML = posts.length ? posts.map((x) => `<a class="bx-post" href="article.html?p=${encodeURIComponent(x.slug)}"><small class="bx-hint">${esc(x.tag || 'مقال')} · ${fdate(x.published_at)}</small><h2>${esc(x.title)}</h2>${x.excerpt ? `<p>${esc(x.excerpt)}</p>` : ''}</a>`).join('') : '<div class="bx-empty-big"><b>لا توجد مقالات بعد</b>تابعنا قريبًا.</div>';
    } catch (e) { box.innerHTML = `<div class="bx-empty-big"><b>تعذّر التحميل</b>${esc(arErr(e))}</div>`; }
  };
  P.article = async () => {
    const box = $('#art'), slug = new URLSearchParams(location.search).get('p');
    if (!slug) { location.replace('blog.html'); return; }
    let x; try { x = await sb.one('posts', { select: '*', slug: 'eq.' + slug, published: 'eq.true' }); } catch (e) { box.innerHTML = `<div class="bx-empty-big"><b>تعذّر التحميل</b>${esc(arErr(e))}</div>`; return; }
    if (!x) { box.innerHTML = '<div class="bx-empty-big"><b>المقال غير موجود</b><a class="bx-link" href="blog.html">كل المقالات</a></div>'; return; }
    window.setMeta && setMeta(x.title + ' | Biosyn Egypt', (x.excerpt || x.body || '').slice(0, 160));
    box.innerHTML = `<nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="blog.html">المدونة</a></nav><small class="bx-hint">${esc(x.tag || 'مقال')} · ${fdate(x.published_at)}</small><h1>${esc(x.title)}</h1>${x.excerpt ? `<p class="bs-lead" style="color:var(--ink-muted)">${esc(x.excerpt)}</p>` : ''}<div class="bx-prose" style="margin-top:32px">${md(x.body)}</div><div class="bx-banner" style="display:block;margin-top:40px"><b>تعلّم أكثر مع Biosyn</b><p style="margin:6px 0 0">دورات مسجلة في العلوم الحيوية والطبية باشتراك واحد. <a class="bx-link" href="courses.html">تصفح الدورات</a></p></div>`;
  };
  window.renderPostBody = md;
})();
