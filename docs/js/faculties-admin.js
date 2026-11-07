/* Admin → «الكليات والتخصصات»: edit the faculty list and their specialties (site_content.faculties).
   The SEO build turns it into js/faculties-data.js within 15 minutes, so filters, course pages and faculty pages all use it. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  window.facultiesAdmin = async function (main) {
    let list = (window.FACULTIES || []).map((f) => ({ id: f.id, name: f.name, specs: [...f.specs], icon: f.icon }));
    let counts = {};
    try {
      const [cs, cf] = await Promise.all([sb.get('courses', { select: 'faculty', status: 'eq.published' }), sb.get('course_faculties', { select: 'faculty' })]);
      cs.concat(cf).forEach((r) => (counts[r.faculty] = (counts[r.faculty] || 0) + 1));
    } catch (e) {}
    const draw = () => {
      main.innerHTML = Dash.panel('الكليات والتخصصات', `<p class="bx-hint" style="margin-top:0">هذه القائمة تظهر في فلاتر الدورات، وفي محرر الدورة لاختيار الكليات المناسبة، وتُبنى منها صفحات الكليات. التعديلات تظهر في الموقع خلال 15 دقيقة. لا تغيّر «المعرّف» لكلية مرتبطة بدورات.</p>
        <div id="fx-list" style="display:grid;gap:12px">${list.map((f, i) => `<div class="bx-panel" style="padding:14px" data-i="${i}">
          <div class="row2"><div class="bx-field"><label>اسم الكلية</label><input class="bx-input" data-n value="${esc(f.name)}"></div>
          <div class="bx-field"><label>المعرّف (بالإنجليزية)</label><input class="bx-input" dir="ltr" data-id value="${esc(f.id)}" ${counts[f.id] ? 'readonly title="مرتبطة بدورات"' : ''}></div></div>
          <div class="bx-field"><label>التخصصات (سطر لكل تخصص)</label><textarea class="bx-textarea" rows="3" data-s>${esc(f.specs.join('\n'))}</textarea></div>
          <div class="bx-spread"><small class="bx-hint">${counts[f.id] ? `مرتبطة بـ ${counts[f.id]} دورة/تصنيف` : 'غير مرتبطة بدورات'}</small>
          <span><button class="bx-linkbtn" data-up ${i ? '' : 'disabled'}>↑</button> <button class="bx-linkbtn" data-dn ${i < list.length - 1 ? '' : 'disabled'}>↓</button> ${counts[f.id] ? '' : '<button class="bx-linkbtn" data-rm style="color:var(--danger-text)">حذف</button>'}</span></div></div>`).join('')}</div>
        <div class="bx-btnrow" style="margin-top:12px"><button class="bs-btn bs-btn-ghost" id="fx-add">+ إضافة كلية</button><button class="bs-btn bs-btn-primary" id="fx-save">حفظ</button><button class="bs-btn bs-btn-ghost" id="fx-reset">استعادة القائمة الافتراضية</button></div>
        <div class="bx-formmsg" id="fx-msg" aria-live="polite"></div>`);
      const read = () => { list = $$('[data-i]', main).map((el) => { const f = list[+el.dataset.i]; return { id: $('[data-id]', el).value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'), name: $('[data-n]', el).value.trim(), specs: $('[data-s]', el).value.split('\n').map((x) => x.trim()).filter(Boolean), icon: f.icon || '' }; }); };
      $$('[data-i]', main).forEach((el) => {
        const i = +el.dataset.i;
        const up = $('[data-up]', el), dn = $('[data-dn]', el), rm = $('[data-rm]', el);
        if (up) up.onclick = () => { read(); [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); };
        if (dn) dn.onclick = () => { read(); [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); };
        if (rm) rm.onclick = () => { if (!confirm('حذف هذه الكلية من القائمة؟')) return; read(); list.splice(i, 1); draw(); };
      });
      $('#fx-add', main).onclick = () => { read(); list.push({ id: '', name: '', specs: [], icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>' }); draw(); };
      $('#fx-save', main).onclick = async () => {
        read(); const msg = $('#fx-msg', main);
        const ids = list.map((f) => f.id);
        if (list.some((f) => !f.id || !f.name)) return say(msg, 'اكتب اسم ومعرّف كل كلية.', 'err');
        if (new Set(ids).size !== ids.length) return say(msg, 'المعرّف مكرر.', 'err');
        try { const ex = await sb.get('site_content', { select: 'key', key: 'eq.faculties' }); ex.length ? await sb.update('site_content', { key: 'eq.faculties' }, { data: list, updated_at: new Date().toISOString() }) : await sb.insert('site_content', { key: 'faculties', data: list });
          window.FACULTIES = list; say(msg, 'تم الحفظ ✓ — تظهر في الموقع خلال 15 دقيقة.', 'ok'); }
        catch (err) { say(msg, arErr(err), 'err'); }
      };
      $('#fx-reset', main).onclick = async () => {
        if (!confirm('استعادة قائمة الكليات الافتراضية؟')) return;
        try { await sb.remove('site_content', { key: 'eq.faculties' }); location.reload(); } catch (err) { say($('#fx-msg', main), arErr(err), 'err'); }
      };
    };
    const say = (el, t, k) => { el.textContent = t; el.className = 'bx-formmsg ' + (k || ''); };
    draw();
  };
})();
