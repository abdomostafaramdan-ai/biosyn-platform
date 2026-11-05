/* "Teach with us" → recorded course wizard (4 steps).
   Data lives in course_proposals + proposal_lessons; videos go straight from the browser to Bunny Stream (TUS),
   using a short-lived signature from the bunny-upload Edge Function. Submitting files a request for the team. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = window.esc || ((s) => String(s ?? ''));
  const err = (e) => (window.arErr ? window.arErr(e) : e.message);
  const LEVELS = ['مبتدئ', 'مبتدئ ومتوسط', 'متوسط', 'متوسط ومتقدم', 'متقدم', 'كل المستويات'];
  const AUDIENCE = ['طلاب فقط', 'باحثون فقط', 'طلاب وباحثون', 'أعضاء هيئة التدريس فقط', 'مهنيون فقط', 'طلاب وباحثون وأعضاء هيئة تدريس ومهنيون'];
  const NEW_SPEC = '__new';
  const MAX_BYTES = 6 * 1024 * 1024 * 1024; // 6 GB per video
  const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB');

  let root, stepper, P = null, L = [], step = 1, ready = false, me = null;

  function setStep(n, quiet) {
    step = n;
    $$('li', stepper).forEach((li, i) => { li.toggleAttribute('aria-current', i + 1 === n); if (i + 1 === n) li.setAttribute('aria-current', 'step'); li.classList.toggle('done', i + 1 < n); });
    draw();
    if (!quiet) root.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const say = (t, k) => { const m = $('.bx-formmsg', root); if (m) { m.className = 'bx-formmsg' + (k ? ' ' + k : ''); m.textContent = t; } };
  const foot = (left, right) => `<div class="bx-formmsg" aria-live="polite"></div><div class="bx-formfoot"><span class="bx-hint">الخطوة ${step} من 4</span><div class="bx-btnrow">${left || ''}${right || ''}</div></div>`;
  const back = () => `<button type="button" class="bs-btn bs-btn-ghost bs-btn-lg" data-back>رجوع</button>`;

  // ---------- data ----------
  async function loadLatest() {
    const ps = await sb.get('course_proposals', { select: '*', user_id: 'eq.' + sb.user.id, order: 'created_at.desc', limit: 1 });
    P = ps[0] || null;
    L = P ? await sb.get('proposal_lessons', { select: '*', proposal_id: 'eq.' + P.id, order: 'position.asc,created_at.asc' }) : [];
  }
  async function saveInfo(row) {
    if (P) { const r = await sb.update('course_proposals', { id: 'eq.' + P.id }, { ...row, updated_at: new Date().toISOString() }); P = r[0] || { ...P, ...row }; }
    else { const r = await sb.insert('course_proposals', { ...row, user_id: sb.user.id }); P = r[0]; L = []; }
  }
  async function saveLessons(titles) {
    const keep = [];
    for (let i = 0; i < titles.length; i++) {
      const t = titles[i];
      if (t.id) { await sb.update('proposal_lessons', { id: 'eq.' + t.id }, { title: t.title, position: i + 1 }); keep.push(t.id); }
      else { const r = await sb.insert('proposal_lessons', { proposal_id: P.id, title: t.title, position: i + 1 }); keep.push(r[0].id); }
    }
    const gone = L.filter((x) => !keep.includes(x.id)).map((x) => x.id);
    if (gone.length) await sb.remove('proposal_lessons', { id: 'in.(' + gone.join(',') + ')' });
    L = await sb.get('proposal_lessons', { select: '*', proposal_id: 'eq.' + P.id, order: 'position.asc,created_at.asc' });
  }

  // ---------- steps ----------
  function stepInfo() {
    const v = P || { name: (me && me.full_name) || '', email: sb.user.email || '', phone: (me && (me.phone || me.whatsapp)) || '' };
    const FAC = window.FACULTIES || [];
    const known = !v.specialty || v.specialty === 'كل التخصصات' || FAC.some((f) => f.specs.includes(v.specialty));
    const specs = FAC.map((f) => `<optgroup label="${esc(f.name)}">${f.specs.map((s) => `<option ${s === v.specialty ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`).join('');
    const facOpts = FAC.map((f) => `<option value="${f.id}" ${!known && f.id === v.faculty ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    root.innerHTML = `<form class="bx-form" id="wz1" novalidate style="gap:20px">
      <h4 class="bx-stephead"><span>البيانات الأساسية<small>عرّف بنفسك وبالدورة والفئة المستهدفة منها.</small></span></h4>
      <div class="bx-form-grid">
        <div class="bx-field"><label for="w-n">اسم المحاضر *</label><input id="w-n" class="bx-input" value="${esc(v.name || '')}" placeholder="الاسم الكامل"></div>
        <div class="bx-field"><label for="w-e">البريد الإلكتروني *</label><input id="w-e" class="bx-input" type="email" dir="ltr" value="${esc(v.email || '')}"></div>
        <div class="bx-field"><label for="w-p">رقم الهاتف المحمول (واتساب)</label><input id="w-p" class="bx-input" type="tel" dir="ltr" value="${esc(v.phone || '')}" placeholder="01xxxxxxxxx"></div>
        <div class="bx-field"><label for="w-a">الفئة المستهدفة</label><select id="w-a" class="bx-select">${(v.audience && !AUDIENCE.includes(v.audience) ? [v.audience] : []).concat(AUDIENCE).map((a) => `<option ${a === v.audience ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div class="bx-field bx-wide"><label for="w-t">عنوان الدورة *</label><input id="w-t" class="bx-input" value="${esc(v.title || '')}" placeholder="اسم الدورة العلمية"></div>
        <div class="bx-field"><label for="w-s">التخصص العلمي *</label><select id="w-s" class="bx-select"><option value="">اختر التخصص</option><option value="${NEW_SPEC}" ${known ? '' : 'selected'}>＋ تخصص غير موجود؟ أضفه</option><option ${v.specialty === 'كل التخصصات' ? 'selected' : ''}>كل التخصصات</option>${specs}</select></div>
        <div class="bx-field" data-newspec ${known ? 'hidden' : ''}><label for="w-sx">اكتب التخصص *</label><input id="w-sx" class="bx-input" maxlength="80" value="${known ? '' : esc(v.specialty)}" placeholder="مثال: علم الأدوية الإكلينيكي"></div>
        <div class="bx-field" data-newspec ${known ? 'hidden' : ''}><label for="w-sf">الكلية الأقرب</label><select id="w-sf" class="bx-select"><option value="">غير متأكد</option>${facOpts}</select></div>
        <div class="bx-field"><label for="w-l">المستوى *</label><select id="w-l" class="bx-select">${LEVELS.map((l) => `<option ${l === v.level ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="bx-field bx-wide"><label for="w-d">نبذة قصيرة عن الدورة *</label><textarea id="w-d" class="bx-textarea" rows="2" maxlength="300" placeholder="جملة أو اثنتان تظهران على بطاقة الدورة (حتى 300 حرف)">${esc(v.summary || '')}</textarea></div>
        <div class="bx-field bx-wide"><label for="w-fd">الوصف الكامل للدورة *</label><textarea id="w-fd" class="bx-textarea" rows="7" placeholder="ما الذي تغطيه الدورة بالتفصيل، وماذا سيتعلم الطالب في نهايتها، والمتطلبات السابقة، والفئة المناسبة لها.">${esc(v.description || '')}</textarea></div>
      </div>${foot('', '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">حفظ ومتابعة</button>')}</form>`;
    const sSel = $('#w-s', root);
    sSel.onchange = () => { const on = sSel.value === NEW_SPEC; $$('[data-newspec]', root).forEach((d) => (d.hidden = !on)); if (on) $('#w-sx', root).focus(); };
    $('#wz1', root).onsubmit = async (e) => {
      e.preventDefault();
      const g = (id) => $('#' + id, root).value.trim();
      const custom = g('w-s') === NEW_SPEC;
      const row = { name: g('w-n'), email: g('w-e'), phone: g('w-p') || null, audience: g('w-a'), title: g('w-t'), specialty: (custom ? g('w-sx') : g('w-s')) || null, level: g('w-l'), summary: g('w-d') || null, description: g('w-fd') || null };
      const fac = (window.FACULTIES || []).find((f) => f.specs.includes(row.specialty)); row.faculty = custom ? g('w-sf') || null : row.specialty === 'كل التخصصات' ? 'all' : fac ? fac.id : null;
      if (!row.name || !/^\S+@\S+\.\S+$/.test(row.email)) return say('اكتب اسمك وبريدًا إلكترونيًا صحيحًا.', 'err');
      if (!row.title) return say('اكتب عنوان الدورة.', 'err');
      if (!row.specialty) return say(custom ? 'اكتب اسم التخصص.' : 'اختر التخصص العلمي.', 'err');
      if (!row.summary) return say('اكتب نبذة قصيرة عن الدورة.', 'err');
      if (!row.description || row.description.length < 40) return say('اكتب وصفًا كاملًا للدورة (40 حرفًا على الأقل).', 'err');
      const b = e.submitter || $('button[type=submit]', root); b.disabled = true; say('جارٍ الحفظ…');
      try { await saveInfo(row); setStep(2); } catch (x) { b.disabled = false; say(err(x), 'err'); }
    };
  }

  function stepLessons() {
    let rows = L.map((l) => ({ id: l.id, title: l.title }));
    if (!rows.length) rows = [{ title: '' }, { title: '' }];
    const paint = () => {
      $('#wzl', root).innerHTML = rows.map((r, i) => `<div class="bx-wzrow"><b class="bx-wznum">${i + 1}</b><input class="bx-input" data-i="${i}" value="${esc(r.title)}" placeholder="عنوان الدرس ${i + 1}" aria-label="عنوان الدرس ${i + 1}">
        <span class="bx-btnrow" style="gap:2px"><button type="button" class="bx-linkbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="للأعلى">↑</button><button type="button" class="bx-linkbtn" data-dn="${i}" ${i < rows.length - 1 ? '' : 'disabled'} aria-label="للأسفل">↓</button><button type="button" class="bx-linkbtn" data-rm="${i}" style="color:var(--danger-text)" aria-label="حذف">✕</button></span></div>`).join('');
      $$('[data-i]', root).forEach((inp) => (inp.oninput = () => (rows[+inp.dataset.i].title = inp.value)));
      $$('[data-up]', root).forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(); }));
      $$('[data-dn]', root).forEach((b) => (b.onclick = () => { const i = +b.dataset.dn; [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(); }));
      $$('[data-rm]', root).forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.rm, 1); if (!rows.length) rows.push({ title: '' }); paint(); }));
    };
    root.innerHTML = `<form class="bx-form" id="wz2" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>المنهج والدروس<small>اكتب دروس الدورة بالترتيب. كل درس = فيديو واحد سترفعه في الخطوة التالية.</small></span></h4>
      <div id="wzl" class="bx-wzlist"></div>
      <button type="button" class="bs-btn bs-btn-ghost" id="wzadd" style="justify-self:start">+ إضافة درس</button>
      ${foot(back(), '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">حفظ ومتابعة</button>')}</form>`;
    paint();
    $('#wzadd', root).onclick = () => { rows.push({ title: '' }); paint(); const ins = $$('[data-i]', root); ins[ins.length - 1].focus(); };
    $('[data-back]', root).onclick = () => setStep(1);
    $('#wz2', root).onsubmit = async (e) => {
      e.preventDefault();
      const clean = rows.map((r) => ({ ...r, title: r.title.trim() })).filter((r) => r.title);
      if (!clean.length) return say('اكتب درسًا واحدًا على الأقل.', 'err');
      const b = $('button[type=submit]', root); b.disabled = true; say('جارٍ الحفظ…');
      try { await saveLessons(clean); setStep(3); } catch (x) { b.disabled = false; say(err(x), 'err'); }
    };
  }

  let tusLoading = null;
  const loadTus = () => window.tus ? Promise.resolve() : (tusLoading = tusLoading || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js'; s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل أداة الرفع، حاول مرة أخرى.')); document.head.appendChild(s); }));
  const uploads = {}; // lesson id -> tus upload in progress

  function lessonState(l) {
    if (uploads[l.id]) return '<span class="bx-st bx-st-info">جارٍ الرفع…</span>';
    if (l.uploaded) return `<span class="bx-st bx-st-ok">✓ تم الرفع${l.file_name ? ' · ' + esc(l.file_name) : ''}</span>`;
    if (l.video_url) return '<span class="bx-st bx-st-ok">✓ رابط</span>';
    return '<span class="bx-st bx-st-mute">لم يُرفع بعد</span>';
  }
  function stepVideos() {
    const done = () => L.every((l) => l.uploaded || l.video_url);
    root.innerHTML = `<form class="bx-form" id="wz3" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>الفيديوهات<small>${ready ? 'ارفع فيديو كل درس من جهازك (يُفضّل MP4). يستمر الرفع حتى لو انقطع الإنترنت ثم عاد، لكن أبقِ الصفحة مفتوحة حتى ينتهي.' : 'سيُتاح رفع الفيديوهات من الموقع قريبًا. حتى ذلك الحين ضع رابط Google Drive لكل فيديو (بمشاركة Anyone with the link) وسيُنقل الفيديو إلى المنصة.'}</small></span></h4>
      <div class="bx-wzlist">${L.map((l, i) => `<div class="bx-wzvid" data-l="${l.id}"><div class="bx-wzvid-top"><b class="bx-wznum">${i + 1}</b><b class="bx-wzvid-t">${esc(l.title)}</b><span data-state>${lessonState(l)}</span></div>
        ${ready ? `<div class="bx-wzvid-act"><label class="bs-btn bs-btn-ghost bs-btn-sm bx-filebtn">${l.uploaded ? 'استبدال الفيديو' : 'اختر فيديو'}<input type="file" accept="video/*" data-file hidden></label><div class="bx-prog" hidden><i></i></div><small class="bx-hint" data-pct></small></div>` : ''}
        <details class="bx-wzlink" ${!ready && !l.video_url ? 'open' : ''}><summary class="bx-hint">${ready ? 'أو ضع رابطًا بدلًا من الرفع' : 'رابط الفيديو'}</summary><div class="bx-btnrow"><input class="bx-input" dir="ltr" data-url value="${esc(l.video_url || '')}" placeholder="https://drive.google.com/…"><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-saveurl>حفظ</button></div></details></div>`).join('')}</div>
      ${foot(back(), '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">متابعة للمراجعة</button>')}</form>`;
    $('[data-back]', root).onclick = () => setStep(2);
    $$('.bx-wzvid', root).forEach((box) => {
      const l = L.find((x) => x.id === box.dataset.l);
      const st = $('[data-state]', box), fi = $('[data-file]', box), pr = $('.bx-prog', box), pct = $('[data-pct]', box);
      if (fi) fi.onchange = async () => {
        const f = fi.files[0]; if (!f) return;
        if (!/^video\//.test(f.type) && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)) return say('اختر ملف فيديو.', 'err');
        if (f.size > MAX_BYTES) return say('حجم الفيديو أكبر من 6 جيجابايت.', 'err');
        say(''); fi.disabled = true; pr.hidden = false; pct.textContent = 'جارٍ تجهيز الرفع…';
        try {
          await loadTus();
          const a = await sb.fn('bunny-upload', { action: 'create', lesson_id: l.id });
          await new Promise((res, rej) => {
            const up = new window.tus.Upload(f, {
              endpoint: a.endpoint, retryDelays: [0, 3000, 5000, 10000, 20000, 60000], chunkSize: 50 * 1024 * 1024,
              headers: { AuthorizationSignature: a.signature, AuthorizationExpire: String(a.expire), VideoId: a.video_id, LibraryId: String(a.library_id) },
              metadata: { filetype: f.type || 'video/mp4', title: l.title },
              onError: rej,
              onProgress: (sent, total) => { const p = Math.floor((sent / total) * 100); $('i', pr).style.width = p + '%'; pct.textContent = `${p}% · ${fmtSize(sent)} من ${fmtSize(total)}`; },
              onSuccess: res,
            });
            uploads[l.id] = up; st.innerHTML = lessonState(l); up.start();
          });
          delete uploads[l.id];
          await sb.update('proposal_lessons', { id: 'eq.' + l.id }, { uploaded: true, file_name: f.name.slice(0, 200), size_bytes: f.size });
          Object.assign(l, { uploaded: true, file_name: f.name, size_bytes: f.size });
          pct.textContent = 'تم الرفع ✓ (تجهّز Bunny الفيديو للمشاهدة خلال دقائق)';
        } catch (x) {
          delete uploads[l.id];
          pct.textContent = ''; pr.hidden = true;
          say(/not configured/.test(x.message || '') ? 'رفع الفيديوهات غير متاح الآن، ضع رابطًا بدلًا من الرفع.' : 'توقف الرفع: ' + (x.message || err(x)) + ' — حاول مرة أخرى.', 'err');
        }
        fi.disabled = false; st.innerHTML = lessonState(l);
      };
      $('[data-saveurl]', box).onclick = async () => {
        const v = $('[data-url]', box).value.trim();
        if (v && !/^https:\/\/\S+$/.test(v)) return say('يجب أن يبدأ الرابط بـ https://', 'err');
        if (v && /(youtube\.com|youtu\.be)\//i.test(v)) return say('لا يمكن نقل روابط YouTube إلى المنصة. ارفع الملف أو ضع رابط Google Drive.', 'err');
        try {
          await sb.update('proposal_lessons', { id: 'eq.' + l.id }, { video_url: v || null }); l.video_url = v || null; st.innerHTML = lessonState(l); say('تم حفظ الرابط.', 'ok');
          if (v && ready) {
            say('جارٍ نقل الفيديو من الرابط إلى المنصة…');
            const r = await sb.fn('bunny-upload', { action: 'import', lesson_id: l.id }); const res = (r.results || {})[l.id] || {};
            if (res.video_id) { l.uploaded = true; l.bunny_video_id = res.video_id; st.innerHTML = lessonState(l); say('تم نقل الفيديو إلى المنصة ✓', 'ok'); }
            else if (res.queued) say('أُرسل إلى المنصة وسيُنقل خلال دقائق.', 'ok');
            else say('تم حفظ الرابط، لكن النقل التلقائي لم ينجح. تأكد من أن الملف مُشارك "Anyone with the link".', 'err');
          }
        } catch (x) { say(err(x), 'err'); }
      };
    });
    $('#wz3', root).onsubmit = (e) => {
      e.preventDefault();
      if (Object.keys(uploads).length) return say('انتظر حتى ينتهي الرفع.', 'err');
      if (!done()) return say('كل درس يحتاج إلى فيديو مرفوع أو رابط.', 'err');
      setStep(4);
    };
  }

  async function stepReview() {
    const n = L.length, withVid = L.filter((l) => l.uploaded || l.video_url).length;
    root.innerHTML = '<div class="bx-loading">جارٍ تجهيز الاتفاقية…</div>';
    let K = null, signed = null;
    try {
      [K, signed] = await Promise.all([sb.rpc('render_contract', { p_kind: 'instructor_recorded', p_proposal: P.id }),
        sb.get('contracts', { select: 'id,signed_at,pdf_path', proposal_id: 'eq.' + P.id, status: 'eq.signed', limit: 1 }).then((r) => r[0] || null)]);
    } catch (x) { root.innerHTML = `<div class="bx-empty-big"><b>تعذّر تحميل الاتفاقية</b>${esc(err(x))}</div>`; return; }
    root.innerHTML = `<form class="bx-form" id="wz4" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>المراجعة والتوقيع والإرسال<small>راجع البيانات، واقرأ اتفاقية النشر ووقّع عليها، ثم أرسل. بعد الإرسال لن تتمكن من التعديل حتى يراجع الفريق طلبك.</small></span></h4>
      <dl class="bx-kv bx-wzsum"><dt>المحاضر</dt><dd>${esc(P.name)} · <span dir="ltr">${esc(P.email)}</span></dd><dt>الدورة</dt><dd>${esc(P.title)}</dd><dt>التخصص</dt><dd>${esc(P.specialty || '—')}</dd><dt>المستوى</dt><dd>${esc(P.level || '—')}</dd><dt>الدروس</dt><dd>${n} درس · ${withVid} بفيديو</dd></dl>
      <ol class="bx-wzreview">${L.map((l) => `<li>${esc(l.title)} ${l.uploaded ? '<small class="bx-hint">· فيديو مرفوع</small>' : l.video_url ? '<small class="bx-hint">· رابط</small>' : ''}</li>`).join('')}</ol>
      <h4 class="bx-stephead" style="margin-top:8px"><span>اتفاقية نشر الدورة<small>اتفاقية واحدة لكل دورة، تُحفظ منها نسخة PDF في حسابك ولدينا، ويصلك بريد إلكتروني بها.</small></span></h4>
      ${signed ? `<div class="kc-ok"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg><span>وقّعت الاتفاقية ✓ · رقم <b dir="ltr">${esc(signed.id.slice(0, 8).toUpperCase())}</b> · <a class="bx-link" href="contract.html?id=${signed.id}" target="_blank">عرض الاتفاقية</a></span></div>`
        : `<div class="kc-box" tabindex="0" aria-label="نص الاتفاقية">${window.contractDoc(K)}</div>
      <div class="kc-signform">
        <div class="bx-field"><label for="k-name">اكتب اسمك الكامل كما في البطاقة *</label><input id="k-name" class="bx-input" autocomplete="name" maxlength="80" placeholder="الاسم ثلاثي على الأقل"></div>
        <div class="bx-field"><label>توقيعك *</label><div class="kc-pad"><canvas id="k-pad" aria-label="مساحة التوقيع"></canvas><span>وقّع هنا بالفأرة أو بإصبعك</span><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" id="k-clear">مسح</button></div></div>
        <label class="bx-check"><input type="checkbox" id="k-ok"> قرأت «${esc(K.title)}» (الإصدار ${K.version}) وأوافق على جميع بنودها، وأقر بأن المحتوى من إعدادي ولي حق نشره، وبأن اسمي وتوقيعي هنا توقيع ملزم لي.</label>
      </div>`}
      ${foot(back(), `<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">${signed ? 'إرسال للمراجعة' : 'توقيع الاتفاقية وإرسال الدورة'}</button>`)}</form>`;
    const pad = signed ? null : window.signaturePad($('#k-pad', root));
    if (pad) $('#k-clear', root).onclick = () => pad.clear();
    $('[data-back]', root).onclick = () => setStep(3);
    $('#wz4', root).onsubmit = async (e) => {
      e.preventDefault();
      const b = $('button[type=submit]', root);
      if (!signed) {
        const nm = $('#k-name', root).value.trim().replace(/\s+/g, ' ');
        if (nm.split(' ').length < 3) return say('اكتب اسمك الكامل (ثلاثي على الأقل).', 'err');
        if (pad.isEmpty()) return say('ارسم توقيعك في المساحة البيضاء.', 'err');
        if (!$('#k-ok', root).checked) return say('يجب الموافقة على الاتفاقية لإتمام الإرسال.', 'err');
        b.disabled = true; say('جارٍ توقيع الاتفاقية…');
        try {
          const id = await sb.rpc('sign_contract', { p_kind: 'instructor_recorded', p_proposal: P.id, p_sha256: K.sha256, p_name: nm, p_signature: pad.toDataURL() });
          signed = { id };
          // PDF copy (best effort: the signed record is already saved even if this fails)
          say('جارٍ حفظ نسخة PDF…');
          try {
            const c = (await sb.get('contracts', { select: '*', id: 'eq.' + id }))[0];
            const blob = await Promise.race([window.contractPdf({ ...c, title: K.title }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 30000))]);
            const path = `${sb.user.id}/${id}.pdf`;
            await sb.storage.upload('contracts', path, new File([blob], id + '.pdf', { type: 'application/pdf' }));
            await sb.rpc('set_contract_pdf', { p_id: id, p_path: path });
          } catch (pe) { console.warn('contract pdf', pe); }
        } catch (x) {
          b.disabled = false;
          return say(/changed/.test(x.message) ? 'تم تحديث نص الاتفاقية. حدّث الصفحة ووقّع مرة أخرى.' : /full name/.test(x.message) ? 'اكتب اسمك الكامل.' : /signature/.test(x.message) ? 'ارسم توقيعك بشكل أوضح.' : err(x), 'err');
        }
      }
      b.disabled = true; say('جارٍ الإرسال…');
      try { await sb.rpc('submit_course_proposal', { p_id: P.id }); window.track && track('lead', { type: 'instructor_recorded' }); P.status = 'submitted'; drawStatus(); }
      catch (x) { b.disabled = false; say(/no lessons/.test(x.message) ? 'أضف الدروس أولًا.' : /missing/.test(x.message) ? 'أكمل بيانات الخطوة الأولى.' : /contract/.test(x.message) ? 'وقّع الاتفاقية أولًا.' : err(x), 'err'); }
    };
  }

  function drawStatus() {
    const T = { submitted: ['وصل طلبك ✓', 'سيراجع فريق Biosyn الدورة والفيديوهات ويتواصل معك عبر بريدك الإلكتروني. تقديم الطلب لا يعني القبول.'], in_review: ['طلبك قيد المراجعة', 'يراجع الفريق الدورة الآن.'], accepted: ['تم قبول الدورة 🎉', 'أُضيفت الدورة إلى المنصة وستُنشر بعد التجهيز النهائي. يمكنك متابعة أرباحك من لوحة المحاضر.'], rejected: ['لم يُقبل الطلب هذه المرة', 'يمكنك بدء دورة جديدة في أي وقت.'] }[P.status] || ['', ''];
    $$('li', stepper).forEach((li) => { li.removeAttribute('aria-current'); li.classList.add('done'); });
    root.innerHTML = `<div class="bx-formcard bx-wzdone"><span class="bx-cat-ic" style="width:52px;height:52px"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></span><h4>${T[0]}</h4><p class="bx-hint">${T[1]}</p><p class="bx-hint">الدورة: <b>${esc(P.title || '')}</b> · ${L.length} درس</p>
      <div class="bx-btnrow">${P.status === 'accepted' ? '<a class="bs-btn bs-btn-primary" href="instructor.html">لوحة المحاضر</a>' : ''}<button type="button" class="bs-btn bs-btn-ghost" id="wznew">ابدأ دورة جديدة</button></div></div>`;
    $('#wznew', root).onclick = () => { P = null; L = []; setStep(1); };
  }

  function draw() {
    if (step === 1) stepInfo(); else if (step === 2) stepLessons(); else if (step === 3) stepVideos(); else stepReview();
  }

  async function init() {
    root = $('#rec-wizard'); stepper = $('#recorded-instructor .bx-stepper');
    if (!root || !window.sb) return;
    if (new URLSearchParams(location.search).get('track') === 'recorded') setTimeout(() => root.closest('section').scrollIntoView({ block: 'start' }), 300);
    if (!sb.user) {
      root.innerHTML = `<div class="bx-formcard bx-wzdone"><h4>سجّل دخولك لتبدأ</h4><p class="bx-hint">يُحفظ إعداد الدورة ورفع الفيديوهات في حسابك، فيمكنك المتابعة في أي وقت ومن أي جهاز.</p>
        <div class="bx-btnrow"><a class="bs-btn bs-btn-primary" href="login.html?mode=signup&next=teach.html?track=recorded">إنشاء حساب</a><a class="bs-btn bs-btn-ghost" href="login.html?next=teach.html?track=recorded">تسجيل الدخول</a></div></div>`;
      return;
    }
    root.innerHTML = '<div class="bx-loading">جارٍ التحميل…</div>';
    try {
      const [st, m] = await Promise.all([sb.fn('bunny-upload', { action: 'status' }).catch(() => ({ ready: false })), window.getMe ? window.getMe().catch(() => null) : null, loadLatest()]);
      ready = !!(st && st.ready); me = m;
    } catch (e) { root.innerHTML = `<div class="bx-empty-big"><b>تعذّر التحميل</b>${esc(err(e))}</div>`; return; }
    if (P && P.status !== 'draft') return drawStatus();
    setStep(P ? (L.length ? (L.every((l) => l.uploaded || l.video_url) ? 4 : 3) : 2) : 1, true);
    window.addEventListener('beforeunload', (e) => { if (Object.keys(uploads).length) { e.preventDefault(); e.returnValue = ''; } });
  }
  if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
})();
