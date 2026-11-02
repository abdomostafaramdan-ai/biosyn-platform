/* "Teach with us" → recorded course wizard (4 steps).
   Data lives in course_proposals + proposal_lessons; videos go straight from the browser to Bunny Stream (TUS),
   using a short-lived signature from the bunny-upload Edge Function. Submitting files a request for the team. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = window.esc || ((s) => String(s ?? ''));
  const err = (e) => (window.arErr ? window.arErr(e) : e.message);
  const LEVELS = ['مبتدئ', 'مبتدئ ومتوسط', 'متوسط', 'متوسط ومتقدم', 'متقدم', 'كل المستويات'];
  const AUDIENCE = ['طلاب', 'باحثون', 'مهنيون', 'الكل'];
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
    const specs = (window.FACULTIES || []).map((f) => `<optgroup label="${esc(f.name)}">${f.specs.map((s) => `<option ${s === v.specialty ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`).join('');
    root.innerHTML = `<form class="bx-form" id="wz1" novalidate style="gap:20px">
      <h4 class="bx-stephead"><span>البيانات الأساسية<small>عرّف نفسك والكورس والفئة اللي معمول لها.</small></span></h4>
      <div class="bx-form-grid">
        <div class="bx-field"><label for="w-n">اسم المحاضر *</label><input id="w-n" class="bx-input" value="${esc(v.name || '')}" placeholder="الاسم الكامل"></div>
        <div class="bx-field"><label for="w-e">البريد الإلكتروني *</label><input id="w-e" class="bx-input" type="email" dir="ltr" value="${esc(v.email || '')}"></div>
        <div class="bx-field"><label for="w-p">رقم الموبايل (واتساب)</label><input id="w-p" class="bx-input" type="tel" dir="ltr" value="${esc(v.phone || '')}" placeholder="01xxxxxxxxx"></div>
        <div class="bx-field"><label for="w-a">الفئة المستهدفة</label><select id="w-a" class="bx-select">${AUDIENCE.map((a) => `<option ${a === v.audience ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div class="bx-field bx-wide"><label for="w-t">عنوان الكورس *</label><input id="w-t" class="bx-input" value="${esc(v.title || '')}" placeholder="اسم الدورة العلمية"></div>
        <div class="bx-field"><label for="w-s">التخصص العلمي *</label><select id="w-s" class="bx-select"><option value="">اختر التخصص</option><option ${v.specialty === 'كل التخصصات' ? 'selected' : ''}>كل التخصصات</option>${specs}</select></div>
        <div class="bx-field"><label for="w-l">المستوى *</label><select id="w-l" class="bx-select">${LEVELS.map((l) => `<option ${l === v.level ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="bx-field bx-wide"><label for="w-d">نبذة عن الكورس</label><textarea id="w-d" class="bx-textarea" rows="3" placeholder="الكورس بيغطي إيه، وهيستفيد منه مين؟">${esc(v.summary || '')}</textarea></div>
      </div>${foot('', '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">حفظ ومتابعة</button>')}</form>`;
    $('#wz1', root).onsubmit = async (e) => {
      e.preventDefault();
      const g = (id) => $('#' + id, root).value.trim();
      const row = { name: g('w-n'), email: g('w-e'), phone: g('w-p') || null, audience: g('w-a'), title: g('w-t'), specialty: g('w-s') || null, level: g('w-l'), summary: g('w-d') || null };
      const fac = (window.FACULTIES || []).find((f) => f.specs.includes(row.specialty)); row.faculty = row.specialty === 'كل التخصصات' ? 'all' : fac ? fac.id : null;
      if (!row.name || !/^\S+@\S+\.\S+$/.test(row.email)) return say('اكتب اسمك وإيميل صحيح.', 'err');
      if (!row.title) return say('اكتب عنوان الكورس.', 'err');
      if (!row.specialty) return say('اختر التخصص العلمي.', 'err');
      const b = e.submitter || $('button[type=submit]', root); b.disabled = true; say('جارٍ الحفظ…');
      try { await saveInfo(row); setStep(2); } catch (x) { b.disabled = false; say(err(x), 'err'); }
    };
  }

  function stepLessons() {
    let rows = L.map((l) => ({ id: l.id, title: l.title }));
    if (!rows.length) rows = [{ title: '' }, { title: '' }];
    const paint = () => {
      $('#wzl', root).innerHTML = rows.map((r, i) => `<div class="bx-wzrow"><b class="bx-wznum">${i + 1}</b><input class="bx-input" data-i="${i}" value="${esc(r.title)}" placeholder="عنوان الدرس ${i + 1}" aria-label="عنوان الدرس ${i + 1}">
        <span class="bx-btnrow" style="gap:2px"><button type="button" class="bx-linkbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="لفوق">↑</button><button type="button" class="bx-linkbtn" data-dn="${i}" ${i < rows.length - 1 ? '' : 'disabled'} aria-label="لتحت">↓</button><button type="button" class="bx-linkbtn" data-rm="${i}" style="color:var(--danger-text)" aria-label="حذف">✕</button></span></div>`).join('');
      $$('[data-i]', root).forEach((inp) => (inp.oninput = () => (rows[+inp.dataset.i].title = inp.value)));
      $$('[data-up]', root).forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(); }));
      $$('[data-dn]', root).forEach((b) => (b.onclick = () => { const i = +b.dataset.dn; [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(); }));
      $$('[data-rm]', root).forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.rm, 1); if (!rows.length) rows.push({ title: '' }); paint(); }));
    };
    root.innerHTML = `<form class="bx-form" id="wz2" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>المنهج والدروس<small>اكتب دروس الكورس بالترتيب. كل درس = فيديو واحد هترفعه في الخطوة الجاية.</small></span></h4>
      <div id="wzl" class="bx-wzlist"></div>
      <button type="button" class="bs-btn bs-btn-ghost" id="wzadd" style="justify-self:start">+ إضافة درس</button>
      ${foot(back(), '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">حفظ ومتابعة</button>')}</form>`;
    paint();
    $('#wzadd', root).onclick = () => { rows.push({ title: '' }); paint(); const ins = $$('[data-i]', root); ins[ins.length - 1].focus(); };
    $('[data-back]', root).onclick = () => setStep(1);
    $('#wz2', root).onsubmit = async (e) => {
      e.preventDefault();
      const clean = rows.map((r) => ({ ...r, title: r.title.trim() })).filter((r) => r.title);
      if (!clean.length) return say('اكتب درس واحد على الأقل.', 'err');
      const b = $('button[type=submit]', root); b.disabled = true; say('جارٍ الحفظ…');
      try { await saveLessons(clean); setStep(3); } catch (x) { b.disabled = false; say(err(x), 'err'); }
    };
  }

  let tusLoading = null;
  const loadTus = () => window.tus ? Promise.resolve() : (tusLoading = tusLoading || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js'; s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل أداة الرفع، جرّب تاني.')); document.head.appendChild(s); }));
  const uploads = {}; // lesson id -> tus upload in progress

  function lessonState(l) {
    if (uploads[l.id]) return '<span class="bx-st bx-st-info">جارٍ الرفع…</span>';
    if (l.uploaded) return `<span class="bx-st bx-st-ok">✓ اتّرفع${l.file_name ? ' · ' + esc(l.file_name) : ''}</span>`;
    if (l.video_url) return '<span class="bx-st bx-st-ok">✓ لينك</span>';
    return '<span class="bx-st bx-st-mute">لسه</span>';
  }
  function stepVideos() {
    const done = () => L.every((l) => l.uploaded || l.video_url);
    root.innerHTML = `<form class="bx-form" id="wz3" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>الفيديوهات<small>${ready ? 'ارفع فيديو كل درس من جهازك (MP4 أفضل). الرفع بيكمل حتى لو النت فصل ورجع، بس خلّي الصفحة مفتوحة لحد ما يخلص.' : 'رفع الفيديوهات من الموقع هيتفعّل قريب. لحد ده حط لينك Google Drive لكل فيديو (متشارك Anyone with the link) والفيديو هيتنقل للمنصة.'}</small></span></h4>
      <div class="bx-wzlist">${L.map((l, i) => `<div class="bx-wzvid" data-l="${l.id}"><div class="bx-wzvid-top"><b class="bx-wznum">${i + 1}</b><b class="bx-wzvid-t">${esc(l.title)}</b><span data-state>${lessonState(l)}</span></div>
        ${ready ? `<div class="bx-wzvid-act"><label class="bs-btn bs-btn-ghost bs-btn-sm bx-filebtn">${l.uploaded ? 'استبدال الفيديو' : 'اختر فيديو'}<input type="file" accept="video/*" data-file hidden></label><div class="bx-prog" hidden><i></i></div><small class="bx-hint" data-pct></small></div>` : ''}
        <details class="bx-wzlink" ${!ready && !l.video_url ? 'open' : ''}><summary class="bx-hint">${ready ? 'أو حط لينك بدل الرفع' : 'لينك الفيديو'}</summary><div class="bx-btnrow"><input class="bx-input" dir="ltr" data-url value="${esc(l.video_url || '')}" placeholder="https://drive.google.com/…"><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-saveurl>حفظ</button></div></details></div>`).join('')}</div>
      ${foot(back(), '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">متابعة للمراجعة</button>')}</form>`;
    $('[data-back]', root).onclick = () => setStep(2);
    $$('.bx-wzvid', root).forEach((box) => {
      const l = L.find((x) => x.id === box.dataset.l);
      const st = $('[data-state]', box), fi = $('[data-file]', box), pr = $('.bx-prog', box), pct = $('[data-pct]', box);
      if (fi) fi.onchange = async () => {
        const f = fi.files[0]; if (!f) return;
        if (!/^video\//.test(f.type) && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)) return say('اختار ملف فيديو.', 'err');
        if (f.size > MAX_BYTES) return say('حجم الفيديو أكبر من 6 جيجا.', 'err');
        say(''); fi.disabled = true; pr.hidden = false; pct.textContent = 'بنجهّز الرفع…';
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
          pct.textContent = 'تم الرفع ✓ (Bunny بيجهّز الفيديو للمشاهدة خلال دقايق)';
        } catch (x) {
          delete uploads[l.id];
          pct.textContent = ''; pr.hidden = true;
          say(/not configured/.test(x.message || '') ? 'رفع الفيديوهات مش متاح دلوقتي، حط لينك بدل الرفع.' : 'الرفع وقف: ' + (x.message || err(x)) + ' — جرّب تاني.', 'err');
        }
        fi.disabled = false; st.innerHTML = lessonState(l);
      };
      $('[data-saveurl]', box).onclick = async () => {
        const v = $('[data-url]', box).value.trim();
        if (v && !/^https:\/\/\S+$/.test(v)) return say('اللينك لازم يبدأ بـ https://', 'err');
        if (v && /(youtube\.com|youtu\.be)\//i.test(v)) return say('لينكات YouTube مينفعش تتنقل للمنصة. ارفع الملف أو حط لينك Google Drive.', 'err');
        try {
          await sb.update('proposal_lessons', { id: 'eq.' + l.id }, { video_url: v || null }); l.video_url = v || null; st.innerHTML = lessonState(l); say('اتحفظ اللينك.', 'ok');
          if (v && ready) {
            say('بننقل الفيديو من اللينك للمنصة…');
            const r = await sb.fn('bunny-upload', { action: 'import', lesson_id: l.id }); const res = (r.results || {})[l.id] || {};
            if (res.video_id) { l.uploaded = true; l.bunny_video_id = res.video_id; st.innerHTML = lessonState(l); say('اتنقل الفيديو للمنصة ✓', 'ok'); }
            else if (res.queued) say('اتبعت للمنصة وهيتنقل خلال دقايق.', 'ok');
            else say('اتحفظ اللينك، بس النقل التلقائي ما نجحش. اتأكد إن الملف متشارك "Anyone with the link".', 'err');
          }
        } catch (x) { say(err(x), 'err'); }
      };
    });
    $('#wz3', root).onsubmit = (e) => {
      e.preventDefault();
      if (Object.keys(uploads).length) return say('استنى لحد ما الرفع يخلص.', 'err');
      if (!done()) return say('كل درس محتاج فيديو مرفوع أو لينك.', 'err');
      setStep(4);
    };
  }

  function stepReview() {
    const n = L.length, withVid = L.filter((l) => l.uploaded || l.video_url).length;
    root.innerHTML = `<form class="bx-form" id="wz4" novalidate style="gap:16px">
      <h4 class="bx-stephead"><span>المراجعة والإرسال<small>راجع البيانات قبل ما تبعت. بعد الإرسال مش هتقدر تعدّل لحد ما الفريق يراجع.</small></span></h4>
      <dl class="bx-kv bx-wzsum"><dt>المحاضر</dt><dd>${esc(P.name)} · <span dir="ltr">${esc(P.email)}</span></dd><dt>الكورس</dt><dd>${esc(P.title)}</dd><dt>التخصص</dt><dd>${esc(P.specialty || '—')}</dd><dt>المستوى</dt><dd>${esc(P.level || '—')}</dd><dt>الدروس</dt><dd>${n} درس · ${withVid} بفيديو</dd></dl>
      <ol class="bx-wzreview">${L.map((l) => `<li>${esc(l.title)} ${l.uploaded ? '<small class="bx-hint">· فيديو مرفوع</small>' : l.video_url ? '<small class="bx-hint">· لينك</small>' : ''}</li>`).join('')}</ol>
      <label class="bx-check"><input type="checkbox" id="w-ok"> أؤكد إن المحتوى من إعدادي ولي حق نشره، وموافق على <a class="bx-link" href="terms.html" target="_blank">الشروط والأحكام</a></label>
      ${foot(back(), '<button type="submit" class="bs-btn bs-btn-primary bs-btn-lg">إرسال للمراجعة</button>')}</form>`;
    $('[data-back]', root).onclick = () => setStep(3);
    $('#wz4', root).onsubmit = async (e) => {
      e.preventDefault();
      if (!$('#w-ok', root).checked) return say('وافق على الشروط عشان تبعت.', 'err');
      const b = $('button[type=submit]', root); b.disabled = true; say('جارٍ الإرسال…');
      try { await sb.rpc('submit_course_proposal', { p_id: P.id }); window.track && track('lead', { type: 'instructor_recorded' }); P.status = 'submitted'; drawStatus(); }
      catch (x) { b.disabled = false; say(/no lessons/.test(x.message) ? 'ضيف دروس الأول.' : /missing/.test(x.message) ? 'كمّل بيانات الخطوة الأولى.' : err(x), 'err'); }
    };
  }

  function drawStatus() {
    const T = { submitted: ['وصل طلبك ✓', 'فريق Biosyn هيراجع الكورس والفيديوهات ويتواصل معاك على إيميلك. تقديم الطلب لا يعني القبول.'], in_review: ['طلبك قيد المراجعة', 'الفريق بيراجع الكورس دلوقتي.'], accepted: ['اتقبل الكورس 🎉', 'الكورس اتضاف للمنصة وهيتنشر بعد التجهيز النهائي. تقدر تتابع أرباحك من لوحة المحاضر.'], rejected: ['الطلب ما اتقبلش المرة دي', 'تقدر تبدأ كورس جديد في أي وقت.'] }[P.status] || ['', ''];
    $$('li', stepper).forEach((li) => { li.removeAttribute('aria-current'); li.classList.add('done'); });
    root.innerHTML = `<div class="bx-formcard bx-wzdone"><span class="bx-cat-ic" style="width:52px;height:52px"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></span><h4>${T[0]}</h4><p class="bx-hint">${T[1]}</p><p class="bx-hint">الكورس: <b>${esc(P.title || '')}</b> · ${L.length} درس</p>
      <div class="bx-btnrow">${P.status === 'accepted' ? '<a class="bs-btn bs-btn-primary" href="instructor.html">لوحة المحاضر</a>' : ''}<button type="button" class="bs-btn bs-btn-ghost" id="wznew">ابدأ كورس جديد</button></div></div>`;
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
      root.innerHTML = `<div class="bx-formcard bx-wzdone"><h4>سجّل دخولك عشان تبدأ</h4><p class="bx-hint">إعداد الكورس ورفع الفيديوهات بيتحفظ على حسابك، فتقدر تكمّل في أي وقت من أي جهاز.</p>
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
