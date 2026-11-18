/* Admin → النماذج → «نماذج الموقع»: edit the fields of the built-in site forms (join as instructor, institutions,
   consultations). The layout is saved in site_content.site_forms and the pages render from it (app.js → applySiteForm).
   Fields the page code needs (name / e-mail / phone, consultation type) can be renamed but not removed or retyped. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const say = (m, t, k) => { m.className = 'bx-formmsg' + (k ? ' ' + k : ''); m.textContent = t; };
  const FORMS = [
    { key: 'teach-interactive', title: 'انضم كمحاضر · دورة تفاعلية', page: 'teach.html', marker: 'i-n', core: ['i-n', 'i-e'] },
    { key: 'teach-help', title: 'انضم كمحاضر · مساعدة في تسجيل دورة', page: 'teach.html', marker: 'h-n', core: ['h-n', 'h-e', 'h-p'] },
    { key: 'institutions', title: 'حلول المؤسسات', page: 'institutions.html', marker: 'o-c', core: ['o-c', 'o-e', 'o-p'] },
    { key: 'consultations', title: 'طلب استشارة', page: 'consultations.html', marker: 'c-n', core: ['c-s', 'c-n', 'c-e', 'c-p', 'c-m'] },
  ];
  const TYPES = { text: 'نص قصير', textarea: 'نص طويل', email: 'بريد إلكتروني', tel: 'هاتف', number: 'رقم', date: 'تاريخ', select: 'قائمة اختيار', file: 'رفع ملف' };

  // the page's built-in fields, read from its HTML (also used for «استرجاع الافتراضي»)
  async function builtIn(def) {
    const html = await fetch(def.page + '?sf=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = [...doc.querySelectorAll('form')].find((f) => f.querySelector('#' + def.marker));
    if (!form) throw new Error('form not found on ' + def.page);
    const fields = [...form.querySelectorAll('.bx-field')].map((box) => {
      const el = box.querySelector('input,select,textarea'), lab = box.querySelector('label'); if (!el || !el.id) return null;
      const raw = (lab ? lab.textContent : '').trim(), sel = el.tagName === 'SELECT';
      const opts = sel ? [...el.options] : [], blank = sel && opts.length && (opts[0].value === '' || /^اختر/.test(opts[0].textContent.trim()));
      return {
        id: el.id, label: raw.replace(/\s*\*\s*$/, ''), required: /\*\s*$/.test(raw) || (el.type === 'file' && el.required),
        type: el.tagName === 'TEXTAREA' ? 'textarea' : sel ? 'select' : el.type === 'file' ? 'file' : ({ email: 'email', tel: 'tel', number: 'number', date: 'date' }[el.type] || 'text'),
        placeholder: sel ? (blank ? opts[0].textContent.trim() : '') : (el.getAttribute('placeholder') || ''),
        options: sel ? opts.slice(blank ? 1 : 0).map((o) => o.textContent.trim()).filter(Boolean) : [],
        hint: ((box.querySelector('small') || {}).textContent || '').trim(), wide: box.classList.contains('bx-wide'),
      };
    }).filter(Boolean);
    return { fields, submit: ((form.querySelector('button.bs-btn-primary') || {}).textContent || '').trim() };
  }

  async function loadAll() { try { const r = await sb.one('site_content', { select: 'data', key: 'eq.site_forms' }); return (r && r.data) || {}; } catch { return {}; } }
  async function saveAll(data) {
    const r = await sb.update('site_content', { key: 'eq.site_forms' }, { data, updated_at: new Date().toISOString() });
    if (!r.length) await sb.insert('site_content', { key: 'site_forms', data });
  }

  async function edit(def, onDone) {
    let all = await loadAll(), base;
    try { base = await builtIn(def); } catch (e) { ui.toast(arErr(e), 'err'); return; }
    const cur = all[def.key] && Array.isArray(all[def.key].fields) && all[def.key].fields.length ? all[def.key] : base;
    const st = { fields: JSON.parse(JSON.stringify(cur.fields)), submit: cur.submit || base.submit };
    const core = new Set(def.core);
    ui.modal(`<h3>تعديل نموذج: ${esc(def.title)}</h3>
      <p class="bx-hint" style="margin-top:0">غيّر أسماء الحقول ونوعها وترتيبها، أو أضف وامسح حقول. الحقول اللي عليها 🔒 مطلوبة لعمل النموذج: تقدر تغيّر اسمها بس. التعديل بيظهر في <a class="bx-link" href="${esc(def.page)}" target="_blank" rel="noopener">صفحة النموذج</a> فور الحفظ.</p>
      <div data-rows style="display:grid;gap:10px;max-height:58vh;overflow:auto;padding-inline-end:4px"></div>
      <div class="bx-btnrow" style="margin:10px 0"><button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" data-add>+ إضافة حقل</button></div>
      <div class="bx-field"><label for="sf-sub">نص زرار الإرسال</label><input id="sf-sub" class="bx-input" maxlength="60" value="${esc(st.submit)}"></div>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-save>حفظ</button><button class="bs-btn bs-btn-ghost" data-reset>استرجاع الحقول الأصلية</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`, (m, close) => {
      const rows = $('[data-rows]', m), msg = $('.bx-formmsg', m);
      const read = () => $$('[data-i]', rows).forEach((r) => {
        const x = st.fields[+r.dataset.i];
        x.label = $('[data-l]', r).value.trim(); x.required = $('[data-r]', r).checked; x.wide = $('[data-w]', r).checked;
        if (!core.has(x.id)) x.type = $('[data-t]', r).value;
        x.placeholder = $('[data-p]', r).value.trim(); x.hint = $('[data-h]', r).value.trim();
        const o = $('[data-o]', r); x.options = o ? o.value.split('\n').map((v) => v.trim()).filter(Boolean) : (x.options || []);
      });
      const draw = () => {
        rows.innerHTML = st.fields.map((x, i) => {
          const locked = core.has(x.id);
          return `<div data-i="${i}" style="border:1px solid var(--line);border-radius:12px;padding:10px;display:grid;gap:8px">
            <div class="bx-row" style="gap:8px;flex-wrap:wrap;align-items:center">
              ${locked ? '<span title="حقل أساسي" aria-label="حقل أساسي">🔒</span>' : ''}
              <input class="bx-input" data-l value="${esc(x.label)}" placeholder="اسم الحقل" style="flex:2;min-width:180px" maxlength="120">
              <select class="bx-select" data-t ${locked ? 'disabled' : ''} style="flex:1;min-width:130px">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <label class="bx-hint" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-r ${x.required ? 'checked' : ''}> إجباري</label>
              <label class="bx-hint" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-w ${x.wide ? 'checked' : ''}> عرض كامل</label>
              <span style="display:flex;gap:4px;margin-inline-start:auto">
                <button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-up ${i ? '' : 'disabled'} aria-label="لأعلى">↑</button>
                <button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-down ${i < st.fields.length - 1 ? '' : 'disabled'} aria-label="لأسفل">↓</button>
                ${locked ? '' : '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-del style="color:var(--danger-text)" aria-label="حذف">✕</button>'}</span></div>
            <div class="bx-row" style="gap:8px;flex-wrap:wrap">
              <input class="bx-input" data-p value="${esc(x.placeholder || '')}" placeholder="${x.type === 'select' ? 'نص الاختيار الأول (مثل: اختر…)' : 'نص توضيحي داخل الخانة'}" style="flex:1;min-width:180px" maxlength="120">
              <input class="bx-input" data-h value="${esc(x.hint || '')}" placeholder="ملاحظة صغيرة تحت الخانة (اختياري)" style="flex:1;min-width:180px" maxlength="160"></div>
            ${x.type === 'select' ? `<textarea class="bx-textarea" data-o rows="3" placeholder="كل اختيار في سطر">${esc((x.options || []).join('\n'))}</textarea>` : ''}
          </div>`;
        }).join('');
        $$('[data-i]', rows).forEach((r) => {
          const i = +r.dataset.i;
          $('[data-t]', r).onchange = () => { read(); draw(); };
          $('[data-up]', r).onclick = () => { read(); [st.fields[i - 1], st.fields[i]] = [st.fields[i], st.fields[i - 1]]; draw(); };
          $('[data-down]', r).onclick = () => { read(); [st.fields[i + 1], st.fields[i]] = [st.fields[i], st.fields[i + 1]]; draw(); };
          const d = $('[data-del]', r); if (d) d.onclick = () => { read(); st.fields.splice(i, 1); draw(); };
        });
      };
      draw();
      $('[data-add]', m).onclick = () => {
        read(); if (st.fields.length >= 40) return say(msg, 'الحد الأقصى 40 حقل.', 'err');
        const pre = def.marker.split('-')[0];
        st.fields.push({ id: `${pre}-x${Math.random().toString(36).slice(2, 8)}`, label: '', type: 'text', required: false, placeholder: '', hint: '', options: [], wide: false });
        draw(); const last = $$('[data-l]', rows).pop(); if (last) last.focus();
      };
      $('[data-x]', m).onclick = close;
      $('[data-reset]', m).onclick = async (e) => {
        if (!confirm('ترجيع حقول النموذج الأصلية؟ هتتمسح تعديلاتك على النموذج ده.')) return;
        e.target.disabled = true;
        try { all = await loadAll(); delete all[def.key]; await saveAll(all); close(); ui.toast('رجع النموذج لحقوله الأصلية.'); onDone && onDone(); }
        catch (x) { e.target.disabled = false; say(msg, arErr(x), 'err'); }
      };
      $('[data-save]', m).onclick = async (e) => {
        read();
        const bad = st.fields.find((x) => !x.label); if (bad) return say(msg, 'كل حقل لازم يكون له اسم.', 'err');
        const noOpts = st.fields.find((x) => x.type === 'select' && !(x.options || []).length); if (noOpts) return say(msg, `اكتب اختيارات للقائمة «${noOpts.label}».`, 'err');
        const missing = def.core.find((id) => !st.fields.some((x) => x.id === id)); if (missing) return say(msg, 'حقل أساسي ناقص، اضغط «استرجاع الحقول الأصلية».', 'err');
        const fields = st.fields.map((x) => ({ id: x.id, label: x.label.slice(0, 120), type: TYPES[x.type] ? x.type : 'text', required: !!x.required, wide: !!x.wide,
          ...(x.placeholder ? { placeholder: x.placeholder.slice(0, 120) } : {}), ...(x.hint ? { hint: x.hint.slice(0, 160) } : {}),
          ...(x.type === 'select' ? { options: x.options.slice(0, 60).map((o) => o.slice(0, 120)) } : {}) }));
        e.target.disabled = true;
        try { all = await loadAll(); all[def.key] = { fields, submit: ($('#sf-sub', m).value.trim() || base.submit).slice(0, 60), updated_at: new Date().toISOString() }; await saveAll(all); close(); ui.toast('تم حفظ النموذج، والتعديل ظاهر في الموقع.'); onDone && onDone(); }
        catch (x) { e.target.disabled = false; say(msg, arErr(x), 'err'); }
      };
    });
  }

  window.SiteFormsAdmin = { FORMS, edit, loadAll };
})();
