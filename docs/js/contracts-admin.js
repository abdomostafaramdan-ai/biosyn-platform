/* Admin → «العقود»: signed instructor agreements (PDF + printable copy) and the agreement template versions.
   Instructor dashboard → «اتفاقياتي» uses window.myContracts. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;

  async function openPdf(c) {
    if (!c.pdf_path) { window.open('contract.html?id=' + c.id, '_blank', 'noopener'); return; }
    try { window.open(await sb.storage.signedUrl('contracts', c.pdf_path, 300), '_blank', 'noopener'); } catch (e) { ui.toast(arErr(e)); }
  }
  const IDST = { auto_verified: ['اتفحصت تلقائيًا ✓', 'ok'], needs_review: ['محتاجة مراجعة', 'warn'], approved: ['معتمدة ✓', 'ok'], rejected: ['مرفوضة', 'danger'] };
  const idCell = (c) => c.id_front_path ? `<button class="bx-linkbtn" data-idv="${c.id}"><span class="bx-st bx-st-${(IDST[c.id_status] || ['', 'mute'])[1]}">${(IDST[c.id_status] || [c.id_status || '—'])[0]}</span></button>` : '<small class="bx-muted">—</small>';
  const rows = (list, admin) => D.table(admin ? ['المحاضر', 'الدورة', 'الإصدار', 'تاريخ التوقيع', 'الهوية', 'IP', ''] : ['الدورة', 'الإصدار', 'تاريخ التوقيع', ''],
    list.map((c) => [
      ...(admin ? [`<b>${esc(c.signer_name)}</b><br><small class="bx-muted" dir="ltr">${esc(c.signer_email)}</small>`] : []),
      `<span dir="auto">${esc(c.course_title || '—')}</span>`, 'v' + c.version, D.dateTime(c.signed_at), ...(admin ? [idCell(c), `<small dir="ltr">${esc(c.ip || '—')}</small>`] : []),
      `<div class="bx-btnrow" style="margin:0"><button class="bs-btn bs-btn-secondary bs-btn-sm" data-pdf="${c.id}">${c.pdf_path ? 'PDF' : 'PDF (طباعة)'}</button><a class="bs-btn bs-btn-ghost bs-btn-sm" href="contract.html?id=${c.id}" target="_blank">عرض</a></div>`]),
    'لا توجد اتفاقيات موقّعة بعد.');

  async function idReview(c, isAdmin, done) {
    const V = { match: 'الرقم اتقرا من الصورة ومطابق', card: 'المستند اتعرف بس الرقم ما اتقراش', unclear: 'غير واضح', not_card: 'الفحص ما لقاش مستند', too_small: 'الصورة صغيرة', ocr_failed: 'الفحص التلقائي ما اشتغلش' };
    let f = '', b = '';
    try { [f, b] = await Promise.all([sb.storage.signedUrl('id-cards', c.id_front_path, 300), sb.storage.signedUrl('id-cards', c.id_back_path, 300)]); } catch (e) { ui.toast(arErr(e)); return; }
    const ch = c.id_check || {};
    ui.modal(`<h3>إثبات شخصية: ${esc(c.signer_name)}</h3>
      <dl class="bx-kv"><dt>النوع</dt><dd>${c.id_type === 'passport' ? 'جواز سفر' : 'بطاقة رقم قومي'}</dd><dt>الرقم</dt><dd dir="ltr">${esc(c.id_number || '—')}</dd><dt>الفحص التلقائي</dt><dd>${esc(V[ch.verdict] || ch.verdict || '—')}${ch.front ? ` <small class="bx-muted">(أرقام مطابقة ${Math.max(ch.front.num || 0, (ch.back && ch.back.num) || 0)} من ${c.id_type === 'passport' ? (c.id_number || '').length : 14} · كلمات المستند ${(ch.front.kw || 0) + ((ch.back && ch.back.kw) || 0)})</small>` : ''}</dd><dt>الحالة</dt><dd>${(IDST[c.id_status] || [c.id_status || '—'])[0]}</dd></dl>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0"><a href="${f}" target="_blank" rel="noopener"><img src="${f}" alt="الوجه" style="width:100%;border-radius:10px"></a><a href="${b}" target="_blank" rel="noopener"><img src="${b}" alt="الظهر" style="width:100%;border-radius:10px"></a></div>
      <p class="bx-hint" style="margin:0">قارن الاسم والرقم في الصورة باسم الموقّع (${esc(c.signer_name)}) وبالرقم المكتوب.</p>
      <div class="bx-modal-actions">${isAdmin ? '<button class="bs-btn bs-btn-primary" data-s="approved">اعتماد</button><button class="bs-btn bs-btn-secondary" data-s="rejected" style="color:var(--danger-text)">رفض</button>' : ''}<button class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $$('[data-s]', m).forEach((btn) => (btn.onclick = async () => {
        btn.disabled = true;
        try { await sb.rpc('review_contract_id', { p_id: c.id, p_status: btn.dataset.s }); c.id_status = btn.dataset.s; ui.toast(btn.dataset.s === 'approved' ? 'اتعتمدت الهوية.' : 'اترفضت الهوية.'); close(); done(); }
        catch (e) { btn.disabled = false; ui.toast(arErr(e)); }
      }));
    });
  }

  window.contractsAdmin = async function (main, isAdmin) {
    if (window.loadFounderSig) await window.loadFounderSig();
    const [list, tpls] = await Promise.all([
      sb.get('contracts', { select: 'id,signer_name,signer_email,course_title,version,signed_at,ip,pdf_path,status,proposal_id,id_type,id_number,id_front_path,id_back_path,id_check,id_status', order: 'signed_at.desc', limit: 500 }).catch(() => []),
      sb.get('contract_templates', { select: '*', kind: 'eq.instructor_recorded', order: 'version.desc' }).catch(() => []),
    ]);
    const cur = tpls.find((t) => t.active) || tpls[0];
    main.innerHTML = `<div class="bx-stats">${D.stat('اتفاقيات موقّعة', list.filter((c) => c.status === 'signed').length)}${D.stat('الإصدار الحالي', cur ? 'v' + cur.version : '—', cur ? D.date(cur.created_at) : '')}${D.stat('بنسخة PDF', list.filter((c) => c.pdf_path).length)}${D.stat('هويات محتاجة مراجعة', list.filter((c) => c.id_status === 'needs_review').length)}</div>
      ${D.panel('الاتفاقيات الموقّعة', `<input class="bx-input" id="k-q" placeholder="ابحث باسم المحاضر أو الدورة أو البريد الإلكتروني" style="margin-bottom:12px"><div id="k-list">${rows(list, true)}</div>
        <p class="bx-hint">يُحفظ مع كل اتفاقية نصها الأصلي الذي وُقّع وبصمته الرقمية (SHA-256)، ووقت التوقيع وعنوان الـ IP والمتصفح. وإذا عُدّل النص بعد التوقيع فلن تتطابق البصمة.</p>`)}
      ${D.panel('نص الاتفاقية', cur ? `<p class="bx-hint" style="margin-top:0">التعديل هنا يُنشئ <b>إصدار جديد</b> يُطبَّق على التوقيعات القادمة فقط، وتبقى الاتفاقيات السابقة كما وُقّعت. المتغيرات المتاحة: {{name}} {{email}} {{phone}} {{course}} {{date}} {{version}} {{id_label}} {{national_id}} (وجود {{national_id}} في النص يخلي رفع البطاقة إجباري عند التوقيع)</p>
        ${isAdmin ? `<div class="bx-field"><label for="k-title">العنوان</label><input id="k-title" class="bx-input" value="${esc(cur.title)}"></div><div class="bx-field"><label for="k-body">النص</label><textarea id="k-body" class="bx-input" rows="16" dir="rtl">${esc(cur.body.trim())}</textarea></div>
        <div class="bx-formmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="button" id="k-save">حفظ كإصدار جديد (v${cur.version + 1})</button><button class="bs-btn bs-btn-ghost" type="button" id="k-prev">معاينة</button></div>`
        : `<div class="kc-box">${window.contractDoc({ ...cur })}</div>`}
        <p class="bx-hint">ملاحظة: كُتب هذا النص بناءً على شروط المنصة الحالية (30% / 70%، الكود الترويجي 50%، السحب كل 3 أشهر). يُفضّل أن يراجعه محامٍ قبل اعتماده نهائيًا.</p>` : '<p class="bx-hint">لا يوجد قالب.</p>')}`;
    const wire = () => {
      $$('[data-pdf]', main).forEach((b) => (b.onclick = () => openPdf(list.find((c) => c.id === b.dataset.pdf))));
      $$('[data-idv]', main).forEach((b) => (b.onclick = () => idReview(list.find((c) => c.id === b.dataset.idv), isAdmin, () => { $('#k-q', main).dispatchEvent(new Event('input')); })));
    };
    wire();
    $('#k-q', main).oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $('#k-list', main).innerHTML = rows(list.filter((c) => !q || `${c.signer_name} ${c.signer_email} ${c.course_title}`.toLowerCase().includes(q)), true); wire(); };
    if (isAdmin && cur) {
      $('#k-prev', main).onclick = () => ui.modal(`<div class="kc-box" style="max-height:70vh">${window.contractDoc({ title: $('#k-title', main).value, body: $('#k-body', main).value, version: cur.version + 1 })}</div><div class="bx-modal-actions"><button class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`, (m, close) => { $('[data-x]', m).onclick = close; });
      $('#k-save', main).onclick = async (ev) => {
        const m = $('.bx-formmsg', main), title = $('#k-title', main).value.trim(), body = $('#k-body', main).value.trim();
        if (title.length < 5 || body.length < 200) { m.className = 'bx-formmsg err'; m.textContent = 'العنوان والنص قصيران جدًا.'; return; }
        if (body === cur.body.trim() && title === cur.title) { m.className = 'bx-formmsg err'; m.textContent = 'لا يوجد تغيير.'; return; }
        ev.target.disabled = true;
        try {
          await sb.insert('contract_templates', { kind: 'instructor_recorded', version: cur.version + 1, title, body: '\n' + body + '\n', active: true });
          await sb.update('contract_templates', { kind: 'eq.instructor_recorded', version: 'lt.' + (cur.version + 1) }, { active: false });
          ui.toast('تم حفظ الإصدار v' + (cur.version + 1)); D.reload();
        } catch (e) { ev.target.disabled = false; m.className = 'bx-formmsg err'; m.textContent = arErr(e); }
      };
    }
  };

  window.myContracts = async function (main, uid) {
    const list = await sb.get('contracts', { select: 'id,course_title,version,signed_at,pdf_path', user_id: 'eq.' + (uid || sb.user.id), order: 'signed_at.desc' }).catch(() => []);
    main.innerHTML = D.panel('اتفاقياتي', `<p class="bx-hint" style="margin-top:0">نسخة من كل اتفاقية نشر وقّعت عليها مع Biosyn. يمكنك فتحها أو تحميلها بصيغة PDF في أي وقت.</p><div>${rows(list, false)}</div>`);
    $$('[data-pdf]', main).forEach((b) => (b.onclick = () => openPdf(list.find((c) => c.id === b.dataset.pdf))));
  };
})();
