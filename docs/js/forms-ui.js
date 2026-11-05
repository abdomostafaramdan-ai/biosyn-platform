/* Custom forms: builder (questions, timers, answer key, grading), responses, and sharing by email.
   Used by Admin → «النماذج والردود» and by «نماذج مشتركة معي» in the student account (viewer / editor). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const say = (el, t, k) => { el.className = 'bx-formmsg' + (k ? ' ' + k : ''); el.textContent = t; };
  const GRADABLE = ['radio', 'select', 'checkbox', 'text', 'number'];

  const FTYPES = { text: 'نص قصير', textarea: 'نص طويل', email: 'بريد إلكتروني', phone: 'هاتف محمول', number: 'رقم', date: 'تاريخ', select: 'قائمة اختيار', radio: 'اختيار واحد', checkbox: 'اختيارات متعددة' };
  const hasOpts = (t) => t === 'select' || t === 'radio' || t === 'checkbox';
  const rid = () => Math.random().toString(36).slice(2, 9);
  async function formBuilder(f, opt) {
    opt = opt || {}; const isNew = !f, owner = opt.role !== 'editor';
    let key = {}; if (f) { try { const k = await sb.one('form_answer_keys', { select: 'answers', form_id: 'eq.' + f.id }); key = (k && k.answers) || {}; } catch (e) { key = {}; } }
    f = f ? JSON.parse(JSON.stringify(f)) : { title: '', slug: '', description: '', submit_label: '', success_message: '', active: true, notify: true,
      fields: [{ id: rid(), label: 'الاسم', type: 'text', required: true }, { id: rid(), label: 'رقم الهاتف المحمول (واتساب)', type: 'phone', required: true }, { id: rid(), label: 'البريد الإلكتروني', type: 'email', required: false }] };
    ui.modal(`<h3>${isNew ? 'نموذج جديد' : 'تعديل النموذج'}</h3><form class="bx-form2" id="fbf" novalidate>
      <div class="row2"><div class="bx-field"><label for="fbt">عنوان النموذج</label><input id="fbt" class="bx-input" maxlength="120" value="${esc(f.title)}" placeholder="مثلًا: سجّل اهتمامك بدبلومة المعلوماتية الحيوية"></div>
      <div class="bx-field"><label for="fbs">الرابط (بالإنجليزي)</label><input id="fbs" class="bx-input" dir="ltr" maxlength="60" value="${esc(f.slug)}" placeholder="bioinformatics-interest" ${owner ? '' : 'disabled'}></div></div>
      <div class="bx-field"><label for="fbd">وصف يظهر فوق النموذج (اختياري)</label><textarea id="fbd" class="bx-textarea" rows="2">${esc(f.description || '')}</textarea></div>
      <div class="bx-field"><label>الحقول</label><div id="fbfields" class="bx-fbfields"></div><button type="button" class="bs-btn bs-btn-ghost" id="fbadd" style="justify-self:start">+ إضافة حقل</button></div>
      <div class="row2"><div class="bx-field"><label for="fbb">نص زر الإرسال</label><input id="fbb" class="bx-input" value="${esc(f.submit_label || '')}" placeholder="إرسال"></div>
      <div class="bx-field"><label for="fbm">رسالة بعد الإرسال</label><input id="fbm" class="bx-input" value="${esc(f.success_message || '')}" placeholder="شكرًا! وصلنا ردك وسنتواصل معك قريبًا."></div></div>
      <div class="bx-row" style="gap:18px"><label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fba" ${f.active ? 'checked' : ''}> النموذج مفتوح لاستقبال الردود</label><label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fbn" ${f.notify ? 'checked' : ''}> أرسل لي بريدًا إلكترونيًا مع كل رد</label></div>
      <fieldset class="bx-field" style="border:1px solid var(--line);border-radius:12px;padding:12px 14px"><legend style="padding:0 6px">⏱ نموذج مؤقت (اختبار أو مسابقة)</legend>
        <label class="bx-check" style="min-height:auto"><input type="checkbox" id="fblock" ${f.settings && f.settings.lock_on_leave ? 'checked' : ''}> إغلاق النموذج إذا غادر الشخص الصفحة أو بدّل التبويب، وإرسال ما أجاب عنه حتى تلك اللحظة</label>
        <div class="bx-field" style="margin-top:8px"><label for="fbtm">الوقت الكلي للنموذج بالدقائق (اختياري)</label><input id="fbtm" class="bx-input" type="number" min="1" max="600" value="${(f.settings && f.settings.total_minutes) || ''}" dir="ltr" style="max-width:160px"></div>
        <small class="bx-hint">لتحديد وقت لكل سؤال اكتب عدد الثواني في خانة ⏱ بجوار السؤال. عند وجود مؤقت تظهر الأسئلة سؤالًا تلو الآخر، وينتقل النموذج تلقائيًا للسؤال التالي عند انتهاء الوقت. لا يمكن الرجوع لسؤال سابق.</small></fieldset>
      <fieldset class="bx-field" style="border:1px solid var(--line);border-radius:12px;padding:12px 14px"><legend style="padding:0 6px">🎯 التصحيح التلقائي</legend>
        <small class="bx-hint">اكتب «الإجابة الصحيحة» تحت أي سؤال اختيار أو نص قصير أو رقم ليُصحَّح تلقائيًا. الإجابات الصحيحة لا تظهر لمن يجيب، وتُحسب الدرجة على الخادم.</small>
        <label class="bx-check" style="min-height:auto"><input type="checkbox" id="fbss" ${!f.settings || f.settings.show_score !== false ? 'checked' : ''}> إظهار النتيجة فورًا بعد الإرسال</label>
        <label class="bx-check" style="min-height:auto"><input type="checkbox" id="fbsa" ${f.settings && f.settings.show_answers ? 'checked' : ''}> إظهار الإجابات الصحيحة مع النتيجة</label>
        <div class="bx-field" style="margin-top:4px"><label for="fbpp">نسبة النجاح ٪ (اختياري)</label><input id="fbpp" class="bx-input" type="number" min="1" max="100" value="${(f.settings && f.settings.pass_percent) || ''}" dir="ltr" style="max-width:160px"></div></fieldset>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button>${isNew || !owner ? '' : '<button type="button" class="bs-btn bs-btn-ghost" data-del style="color:var(--danger-text)">حذف النموذج</button>'}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      const t = $('#fbt', m), sl = $('#fbs', m);
      if (isNew) t.oninput = () => { if (!sl.dataset.touched) sl.value = t.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ''; };
      sl.oninput = () => (sl.dataset.touched = '1');
      const box = $('#fbfields', m);
      const read = () => { $$('.bx-fbrow', box).forEach((r, i) => { const x = f.fields[i]; x.label = $('[data-l]', r).value.trim(); x.type = $('[data-t]', r).value; x.required = $('[data-r]', r).checked; const o = $('[data-o]', r); x.options = o ? o.value.split('\n').map((v) => v.trim()).filter(Boolean) : []; const tl = parseInt($('[data-tl]', r).value, 10); x.time_limit = tl >= 5 ? Math.min(3600, tl) : null; const an = $('[data-ans]', r); if (an) { const v = an.value.split('\n').map((y) => y.trim()).filter(Boolean); if (v.length) key[x.id] = { correct: v, points: Math.max(0, Number($('[data-pts]', r).value) || 0) }; else delete key[x.id]; } else delete key[x.id]; }); };
      const draw = () => {
        box.innerHTML = f.fields.map((x, i) => `<div class="bx-fbrow"><div class="bx-fbmain"><input class="bx-input" data-l value="${esc(x.label)}" placeholder="اسم الحقل (السؤال)" aria-label="اسم الحقل"><select class="bx-select" data-t aria-label="نوع الحقل">${Object.entries(FTYPES).map(([k, v]) => `<option value="${k}" ${k === x.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label class="bx-hint" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-r ${x.required ? 'checked' : ''}> إجباري</label><label class="bx-hint" style="display:flex;gap:4px;align-items:center;white-space:nowrap" title="اتركه فارغًا لسؤال بلا وقت">⏱ <input class="bx-input" data-tl type="number" min="5" max="3600" step="5" value="${x.time_limit || ''}" placeholder="ثوانٍ" aria-label="مؤقت السؤال بالثواني" style="width:84px;padding:6px 8px" dir="ltr"></label>
          <span class="bx-btnrow" style="gap:2px"><button type="button" class="bx-linkbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="للأعلى">↑</button><button type="button" class="bx-linkbtn" data-dn="${i}" ${i < f.fields.length - 1 ? '' : 'disabled'} aria-label="للأسفل">↓</button><button type="button" class="bx-linkbtn" data-rm="${i}" style="color:var(--danger-text)" aria-label="حذف">✕</button></span></div>
          ${hasOpts(x.type) ? `<textarea class="bx-textarea" data-o rows="3" placeholder="كل اختيار في سطر">${esc((x.options || []).join('\n'))}</textarea>` : ''}
          ${GRADABLE.includes(x.type) ? `<div class="bx-row" style="gap:8px;align-items:flex-start;flex-wrap:wrap"><label class="bx-hint" style="flex:1;min-width:220px">✅ الإجابة الصحيحة (اختياري)${x.type === 'checkbox' ? ' — كل اختيار صحيح في سطر' : x.type === 'text' ? ' — يمكن كتابة أكثر من إجابة مقبولة، كل واحدة في سطر' : ''}<textarea class="bx-textarea" data-ans rows="${x.type === 'checkbox' || x.type === 'text' ? 2 : 1}" placeholder="${hasOpts(x.type) ? 'انسخ الاختيار الصحيح كما هو' : 'الإجابة'}">${esc(((key[x.id] || {}).correct || []).join('\n'))}</textarea></label>
            <label class="bx-hint">الدرجة<input class="bx-input" data-pts type="number" min="0" max="100" step="0.5" value="${(key[x.id] || {}).points ?? 1}" style="width:80px;padding:6px 8px" dir="ltr"></label></div>` : ''}</div>`).join('') || '<p class="bx-hint">لا توجد حقول. أضف حقلًا.</p>';
        $$('[data-t]', box).forEach((sel) => (sel.onchange = () => { read(); draw(); }));
        $$('[data-up]', box).forEach((b) => (b.onclick = () => { read(); const i = +b.dataset.up; [f.fields[i - 1], f.fields[i]] = [f.fields[i], f.fields[i - 1]]; draw(); }));
        $$('[data-dn]', box).forEach((b) => (b.onclick = () => { read(); const i = +b.dataset.dn; [f.fields[i + 1], f.fields[i]] = [f.fields[i], f.fields[i + 1]]; draw(); }));
        $$('[data-rm]', box).forEach((b) => (b.onclick = () => { read(); f.fields.splice(+b.dataset.rm, 1); draw(); }));
      };
      draw();
      $('#fbadd', m).onclick = () => { read(); f.fields.push({ id: rid(), label: '', type: 'text', required: false }); draw(); const ls = $$('[data-l]', box); ls[ls.length - 1].focus(); };
      const del = $('[data-del]', m); if (del) del.onclick = async () => { if (!confirm('حذف النموذج وكل الردود عليه نهائيًا؟')) return; try { await sb.remove('forms', { id: 'eq.' + f.id }); close(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); } };
      $('#fbf', m).onsubmit = async (e) => {
        e.preventDefault(); read(); const msg = $('.bx-formmsg', m);
        const row = { title: t.value.trim(), slug: sl.value.trim().toLowerCase(), description: $('#fbd', m).value.trim() || null, submit_label: $('#fbb', m).value.trim() || null, success_message: $('#fbm', m).value.trim() || null, active: $('#fba', m).checked, notify: $('#fbn', m).checked, updated_at: new Date().toISOString() };
        if (row.title.length < 2) return say(msg, 'اكتب عنوان النموذج.', 'err');
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(row.slug)) return say(msg, 'يجب أن يتكون الرابط من حروف إنجليزية صغيرة وأرقام وشرطة (-) فقط.', 'err');
        const fields = f.fields.filter((x) => x.label);
        if (!fields.length) return say(msg, 'أضف حقلًا واحدًا على الأقل.', 'err');
        const bad = fields.find((x) => hasOpts(x.type) && !(x.options || []).length); if (bad) return say(msg, `اكتب اختيارات الحقل "${bad.label}".`, 'err');
        row.fields = fields.map((x) => ({ id: x.id, label: x.label, type: x.type, required: !!x.required, ...(hasOpts(x.type) ? { options: x.options } : {}), ...(x.time_limit ? { time_limit: x.time_limit } : {}) }));
        const tm = parseInt($('#fbtm', m).value, 10);
        const pp = parseInt($('#fbpp', m).value, 10);
        row.settings = { ...(f.settings || {}), lock_on_leave: $('#fblock', m).checked, total_minutes: tm >= 1 ? Math.min(600, tm) : null, show_score: $('#fbss', m).checked, show_answers: $('#fbsa', m).checked, pass_percent: pp >= 1 ? Math.min(100, pp) : null };
        Object.keys(key).forEach((id) => { if (!fields.some((x) => x.id === id)) delete key[id]; });
        try {
          let fid = f.id;
          if (isNew) { const [n] = await sb.insert('forms', row); fid = n.id; } else await sb.update('forms', { id: 'eq.' + f.id }, owner ? row : { title: row.title, description: row.description, fields: row.fields, submit_label: row.submit_label, success_message: row.success_message, settings: row.settings, updated_at: row.updated_at });
          const ex = await sb.get('form_answer_keys', { select: 'form_id', form_id: 'eq.' + fid }).catch(() => []);
          if (ex.length) await sb.update('form_answer_keys', { form_id: 'eq.' + fid }, { answers: key, updated_at: new Date().toISOString() });
          else if (Object.keys(key).length) await sb.insert('form_answer_keys', { form_id: fid, answers: key });
          ui.toast('تم حفظ النموذج.'); close(); opt.onDone ? opt.onDone() : D.reload();
        }
        catch (err) { say(msg, /duplicate|unique/i.test(err.message) ? 'هذا الرابط مستخدم لنموذج آخر.' : arErr(err), 'err'); }
      };
    });
  }
  async function formResponses(f, opt) {
    opt = opt || {}; const canEdit = opt.role !== 'viewer', canDel = !opt.role || opt.role === 'owner';
    let rows = await sb.get('form_submissions', { select: '*', form_id: 'eq.' + f.id, order: 'created_at.desc' }).catch(() => []);
    const cols = [...new Set([...(f.fields || []).map((x) => x.label), ...rows.flatMap((r) => Object.keys(r.data || {}))])];
    const ST = { new: ['جديد', 'warn'], read: ['تمت المشاهدة', 'info'], done: ['تم', 'ok'] };
    const csv = () => {
      const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['التاريخ', ...cols, 'الحالة'].map(q).join(','), ...rows.map((r) => [new Date(r.created_at).toLocaleString('en-GB'), ...cols.map((c) => r.data[c]), (ST[r.status] || [r.status])[0]].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `${f.slug}-responses.csv`; a.click();
    };
    const gr = rows.filter((r) => r.max_score), avg = gr.length ? Math.round(gr.reduce((a, r) => a + (r.score / r.max_score) * 100, 0) / gr.length) : null;
    ui.modal(`<h3>ردود: ${esc(f.title)}</h3><p class="bx-hint" style="margin:0">${rows.length} رد${avg != null ? ` · متوسط الدرجات ${avg}٪ · أعلى درجة ${Math.max(...gr.map((r) => Math.round((r.score / r.max_score) * 100)))}٪` : ''}</p>
      <div class="bx-btnrow" style="margin:8px 0 12px"><button class="bs-btn bs-btn-primary bs-btn-sm" id="frcsv" ${rows.length ? '' : 'disabled'}>تحميل Excel (CSV)</button><button class="bs-btn bs-btn-ghost bs-btn-sm" data-x>إغلاق</button></div>
      <div class="bx-scroll" style="max-height:60vh">${rows.length ? `<table class="bx-table"><thead><tr><th>التاريخ</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>الحالة</th>${canDel ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr><td style="white-space:nowrap">${D.date(r.created_at)}</td>${cols.map((c) => `<td>${esc(r.data[c] ?? '')}</td>`).join('')}
        <td><select class="bx-select" data-rs="${r.id}" style="min-width:90px;height:34px;padding:0 8px" ${canEdit ? '' : 'disabled'}>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></td>${canDel ? `<td><button class="bx-linkbtn" data-rd="${r.id}" style="color:var(--danger-text)">حذف</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="bx-hint">لا توجد ردود بعد. انشر رابط النموذج.</p>'}</div>`,
    (m, close) => {
      $('[data-x]', m).onclick = () => { close(); opt.onDone ? opt.onDone() : D.reload(); };
      const cb = $('#frcsv', m); if (cb) cb.onclick = csv;
      $$('[data-rs]', m).forEach((sel) => (sel.onchange = async () => { try { await sb.update('form_submissions', { id: 'eq.' + sel.dataset.rs }, { status: sel.value }); const r = rows.find((x) => x.id === sel.dataset.rs); if (r) r.status = sel.value; ui.toast('تم التحديث.'); } catch (e) { ui.toast(arErr(e), 'err'); } }));
      $$('[data-rd]', m).forEach((b) => (b.onclick = async () => { if (!confirm('حذف هذا الرد؟')) return; try { await sb.remove('form_submissions', { id: 'eq.' + b.dataset.rd }); rows = rows.filter((x) => x.id !== b.dataset.rd); b.closest('tr').remove(); } catch (e) { ui.toast(arErr(e), 'err'); } }));
      // opening the list marks new responses as seen
      const fresh = rows.filter((r) => r.status === 'new').map((r) => r.id);
      if (fresh.length && canEdit) sb.update('form_submissions', { id: 'in.(' + fresh.join(',') + ')' }, { status: 'read' }).catch(() => {});
    });
  }



  // ---------- share a form by email (admin) ----------
  async function formShare(f) {
    const list = await sb.get('form_collaborators', { select: '*', form_id: 'eq.' + f.id, order: 'created_at.asc' }).catch(() => []);
    const ROLE = { viewer: 'متفرج (يرى الردود فقط)', editor: 'محرر (يعدّل النموذج ويدير الردود)' };
    ui.modal(`<h3>مشاركة: ${esc(f.title)}</h3><p class="bx-hint" style="margin-top:0">ادعُ أي شخص ببريده الإلكتروني. يصله بريد بالدعوة، ويرى النموذج في «نماذج مشتركة معي» داخل حسابه بعد تسجيل الدخول بالبريد نفسه. لا يرى أي شيء آخر في لوحة الإدارة.</p>
      <form class="bx-row" id="shf" novalidate style="gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="bx-field" style="flex:1;min-width:220px;margin:0"><label for="sh-e">البريد الإلكتروني</label><input id="sh-e" class="bx-input" type="email" dir="ltr" placeholder="name@example.com"></div>
        <div class="bx-field" style="margin:0"><label for="sh-r">الصلاحية</label><select id="sh-r" class="bx-select"><option value="viewer">متفرج</option><option value="editor">محرر</option></select></div>
        <button class="bs-btn bs-btn-primary" type="submit">إرسال الدعوة</button></form>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div id="sh-list" style="margin-top:12px">${list.length ? D.table(['البريد', 'الصلاحية', 'آخر دخول', ''], list.map((x) => [`<span dir="ltr">${esc(x.email)}</span>`,
        `<select class="bx-select" data-role="${x.id}" style="height:34px;padding:0 8px"><option value="viewer" ${x.role === 'viewer' ? 'selected' : ''}>متفرج</option><option value="editor" ${x.role === 'editor' ? 'selected' : ''}>محرر</option></select>`,
        x.last_seen_at ? D.date(x.last_seen_at) : 'لم يدخل بعد', `<button class="bx-linkbtn" data-rm="${x.id}" style="color:var(--danger-text)">إلغاء الوصول</button>`]), '') : '<p class="bx-hint">لم تتم مشاركة هذا النموذج مع أحد بعد.</p>'}</div>
      <p class="bx-hint">${Object.values(ROLE).join(' · ')}</p>
      <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`, (m, close) => {
      const msg = $('.bx-formmsg', m);
      $('[data-x]', m).onclick = () => { close(); D.reload(); };
      $('#shf', m).onsubmit = async (e) => {
        e.preventDefault(); const em = $('#sh-e', m).value.trim();
        if (!/^\S+@\S+\.\S+$/.test(em)) return say(msg, 'اكتب بريدًا إلكترونيًا صحيحًا.', 'err');
        try { const r = await sb.rpc('form_invite', { p_form: f.id, p_email: em, p_role: $('#sh-r', m).value }); ui.toast('أُرسلت الدعوة'); close(); formShare(f); if (!r.has_account) setTimeout(() => ui.toast('ليس لديه حساب بعد، وستصله دعوة لإنشاء حساب بالبريد نفسه.'), 600); }
        catch (err) { say(msg, /invalid email/.test(err.message || '') ? 'اكتب بريدًا إلكترونيًا صحيحًا.' : arErr(err), 'err'); }
      };
      $$('[data-role]', m).forEach((s) => (s.onchange = async () => { try { await sb.update('form_collaborators', { id: 'eq.' + s.dataset.role }, { role: s.value }); ui.toast('تم تحديث الصلاحية'); } catch (e) { ui.toast(arErr(e), 'err'); } }));
      $$('[data-rm]', m).forEach((b) => (b.onclick = async () => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد'; return; } try { await sb.remove('form_collaborators', { id: 'eq.' + b.dataset.rm }); b.closest('tr').remove(); ui.toast('تم إلغاء الوصول'); } catch (e) { ui.toast(arErr(e), 'err'); } }));
    });
  }

  // ---------- «نماذج مشتركة معي» (student / any account) ----------
  async function sharedForms(main) {
    const list = await sb.rpc('my_shared_forms').catch(() => []);
    const base = location.href.replace(/[^/]*$/, '');
    main.innerHTML = D.panel('نماذج مشتركة معي', `<p class="bx-hint" style="margin-top:0">النماذج التي دعاك فريق Biosyn للوصول إليها. المتفرج يرى الردود والنتائج ويحمّلها، والمحرر يعدّل الأسئلة ويدير الردود أيضًا.</p>
      ${D.table(['النموذج', 'صلاحيتك', 'الردود', ''], (list || []).map((f) => [`<b dir="auto">${esc(f.title)}</b><br><a class="bx-linkbtn" href="${base}form.html?f=${encodeURIComponent(f.slug)}" target="_blank" rel="noopener">فتح النموذج ↗</a>`,
        f.role === 'editor' ? 'محرر' : 'متفرج', `${f.responses}${f.new ? ` <span class="bx-st bx-st-warn">${f.new} جديد</span>` : ''}`,
        `<button class="bx-linkbtn" data-fr="${f.id}">الردود</button>${f.role === 'editor' ? ` · <button class="bx-linkbtn" data-fe="${f.id}">تعديل</button>` : ''}`]), 'لا توجد نماذج مشتركة معك.')}`);
    const get = (id) => sb.one('forms', { select: '*', id: 'eq.' + id });
    $$('[data-fr]', main).forEach((b) => (b.onclick = async () => { const f = await get(b.dataset.fr); const r = list.find((x) => x.id === b.dataset.fr); formResponses(f, { role: r.role, onDone: () => sharedForms(main) }); }));
    $$('[data-fe]', main).forEach((b) => (b.onclick = async () => { const f = await get(b.dataset.fe); formBuilder(f, { role: 'editor', onDone: () => sharedForms(main) }); }));
  }

  window.FormsUI = { builder: formBuilder, responses: formResponses, share: formShare, shared: sharedForms };
})();
