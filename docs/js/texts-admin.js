/* Admin → «نصوص الموقع»: change any sentence on any page. Two ways: search the site's sentences here, or open a
   page in «التعديل المباشر» mode and click the text. Stored in text_overrides (scope «site»), applied by js/texts.js. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const PAGES = [['index.html', 'الرئيسية'], ['courses.html', 'الدورات المسجلة'], ['interactive.html', 'الدورات التفاعلية'], ['pricing.html', 'الأسعار'], ['instructors.html', 'المحاضرون'], ['consultations.html', 'الاستشارات'], ['institutions.html', 'حلول المؤسسات'], ['teach.html', 'انضم كمحاضر'], ['about.html', 'من نحن'], ['news.html', 'الأخبار والفعاليات'], ['blog.html', 'المدونة'], ['refer.html', 'شهر مجاني'], ['verify.html', 'التحقق من الشهادات'], ['login.html', 'تسجيل الدخول'], ['account.html', 'حساب الطالب'], ['terms.html', 'الشروط والأحكام'], ['privacy.html', 'سياسة الخصوصية']];
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let catalog = null;
  const loadCatalog = async () => {
    if (catalog) return catalog;
    let keys = Object.keys(window.I18N_EN || {});
    if (!keys.length) { try { const t = await fetch('js/i18n-en.js').then((r) => r.text()); keys = [...t.matchAll(/^"((?:[^"\\]|\\.)+)":/gm)].map((m) => JSON.parse('"' + m[1] + '"')); } catch (e) { keys = []; } }
    catalog = [...new Set(keys.map(norm))].filter((k) => /[؀-ۿ]/.test(k) && k.length > 1).sort((a, b) => a.length - b.length);
    return catalog;
  };

  window.textsAdmin = async function (main) {
    const rows = await sb.get('text_overrides', { select: '*', scope: 'eq.site', order: 'updated_at.desc' }).catch(() => []);
    const byOrig = Object.fromEntries(rows.map((r) => [norm(r.original), r]));
    main.innerHTML = `${D.panel('التعديل المباشر على الصفحة', `<p class="bx-hint" style="margin-top:0">افتح أي صفحة في وضع التعديل، ثم اضغط على أي جملة لتغييرها، ويُحفظ التغيير فورًا لكل الزوار. يعمل هذا الوضع لحساب المدير فقط.</p>
        <div class="bx-btnrow" style="flex-wrap:wrap">${PAGES.map(([p, n]) => `<a class="bs-btn bs-btn-ghost bs-btn-sm" href="${p}?edit-text=1" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>`)}
      ${D.panel('ابحث عن جملة في الموقع', `<input class="bx-input" id="tx-q" placeholder="اكتب جزءًا من الجملة كما تظهر في الموقع، مثل: ابدأ التعلّم" autocomplete="off"><div id="tx-res" style="display:grid;gap:8px;margin-top:10px"></div>`)}
      ${D.panel(`التعديلات الحالية (${rows.length})`, rows.length ? D.table(['النص الأصلي', 'النص الجديد', 'الإنجليزية', 'الصفحة', ''], rows.map((r) => [`<small dir="auto">${esc(r.original)}</small>`, `<b dir="auto">${esc(r.replacement)}</b>`, r.replacement_en ? `<small dir="ltr">${esc(r.replacement_en)}</small>` : '—', esc(r.page || '—'),
          `<div class="bx-btnrow" style="margin:0"><button class="bs-btn bs-btn-secondary bs-btn-sm" data-e="${r.id}">تعديل</button><button class="bs-btn bs-btn-ghost bs-btn-sm" data-d="${r.id}">إرجاع الأصل</button></div>`]), '')
        : '<p class="bx-hint">لا توجد تعديلات بعد. كل النصوص تظهر بصيغتها الأصلية.</p>')}`;

    const edit = (orig, r) => ui.modal(`<h3>تعديل نص</h3><form class="bx-form2" id="txf" novalidate>
        <div class="bx-field"><label>النص الأصلي</label><p class="bx-hint" dir="auto" style="margin:0;white-space:pre-wrap">${esc(orig)}</p></div>
        <div class="bx-field"><label for="tx-ar">النص الجديد بالعربية</label><textarea id="tx-ar" class="bx-textarea" rows="3" dir="auto">${esc(r ? r.replacement : orig)}</textarea></div>
        <div class="bx-field"><label for="tx-en">النص في النسخة الإنجليزية (اختياري)</label><textarea id="tx-en" class="bx-textarea" rows="2" dir="ltr">${esc((r && r.replacement_en) || '')}</textarea></div>
        <p class="bx-hint" style="margin:0">يتغير هذا النص في كل الصفحات التي يظهر فيها بالضبط، ويظهر للزوار خلال دقائق.</p>
        <div class="bx-formmsg" aria-live="polite"></div>
        <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button><button type="submit" class="bs-btn bs-btn-primary">حفظ</button></div></form>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('#txf', m).onsubmit = async (e) => {
        e.preventDefault(); const ar = norm($('#tx-ar', m).value), en = norm($('#tx-en', m).value), msg = $('.bx-formmsg', m);
        try {
          if (!ar || (ar === orig && !en)) { if (r) await sb.remove('text_overrides', { id: 'eq.' + r.id }); }
          else { const body = { scope: 'site', original: orig, replacement: ar, replacement_en: en || null, updated_at: new Date().toISOString() }; if (r) await sb.update('text_overrides', { id: 'eq.' + r.id }, body); else await sb.insert('text_overrides', { ...body, page: 'admin' }); }
          window.BiosynTexts && BiosynTexts.refresh(); ui.toast('تم الحفظ ✓'); close(); D.reload();
        } catch (err) { msg.className = 'bx-formmsg err'; msg.textContent = /duplicate|unique/i.test(err.message || '') ? 'يوجد تعديل لهذا النص بالفعل.' : arErr(err); }
      };
    });
    $$('[data-e]', main).forEach((b) => (b.onclick = () => { const r = rows.find((x) => x.id === b.dataset.e); edit(r.original, r); }));
    $$('[data-d]', main).forEach((b) => (b.onclick = async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد'; return; }
      try { await sb.remove('text_overrides', { id: 'eq.' + b.dataset.d }); window.BiosynTexts && BiosynTexts.refresh(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); }
    }));
    let tm = 0;
    $('#tx-q', main).oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => {
      const q = norm(e.target.value), box = $('#tx-res', main);
      if (q.length < 2) { box.innerHTML = ''; return; }
      const cat = await loadCatalog();
      const hits = cat.filter((k) => k.includes(q)).slice(0, 40);
      box.innerHTML = (hits.length ? hits.map((k) => `<div class="bx-panel" style="margin:0;padding:10px 12px;display:flex;gap:10px;align-items:center"><span dir="auto" style="flex:1">${esc(k)}${byOrig[k] ? ` <small class="bx-st bx-st-info">معدّل: ${esc(byOrig[k].replacement)}</small>` : ''}</span><button class="bs-btn bs-btn-secondary bs-btn-sm" data-h="${esc(k)}">تعديل</button></div>`).join('')
        : '<p class="bx-hint">لم نجد الجملة في فهرس الموقع. يمكنك فتح الصفحة في وضع «التعديل المباشر» بالأعلى والضغط عليها.</p>')
        + `<button class="bs-btn bs-btn-ghost bs-btn-sm" data-custom style="justify-self:start">تعديل «${esc(q)}» كما كتبته بالضبط</button>`;
      $$('[data-h]', box).forEach((b) => (b.onclick = () => edit(b.dataset.h, byOrig[b.dataset.h])));
      $('[data-custom]', box).onclick = () => edit(q, byOrig[q]);
    }, 200); };
  };
})();
