/* Admin course editor add-ons:
   1) «الكليات والتخصصات المناسبة» — extra faculties per course with a fit level (course_faculties)
   2) «إعدادات SEO» — per-course SEO title, description, keywords, canonical, Open Graph, index / sitemap (courses.seo)
   3) Images — crop before upload (16:9 cover, 1:1 instructor photo), alt text, separate social sharing image
   Also: window.cropImage(src, {w, h}) → Blob (WebP), used by the instructor editor too. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const FIT = { direct: 'مناسبة مباشرة', prereq: 'بعد معرفة مسبقة', related: 'للتخصصات القريبة' };

  // ---------- image cropper (no library): drag to move, slider to zoom, output w×h WebP ----------
  window.cropImage = (src, opt = {}) => new Promise((resolve) => {
    const W = opt.w || 1280, H = opt.h || 720, ratio = W / H;
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onerror = () => { ui.toast('تعذّر فتح الصورة.', 'err'); resolve(null); };
    img.onload = () => {
      const VW = Math.min(560, window.innerWidth - 64), VH = Math.round(VW / ratio);
      const base = Math.max(VW / img.naturalWidth, VH / img.naturalHeight);
      let z = 1, x = 0, y = 0, drag = null;
      const close = ui.modal(`<h3>قص الصورة</h3><p class="bx-hint" style="margin:0">اسحب الصورة لتحريكها واستخدم الشريط للتكبير. المقاس الناتج ${W} × ${H}.</p>
        <div class="cx-stage" style="width:${VW}px;height:${VH}px"><canvas width="${VW * 2}" height="${VH * 2}" style="width:${VW}px;height:${VH}px"></canvas></div>
        <label class="bx-hint" style="display:flex;gap:10px;align-items:center">تكبير <input type="range" min="1" max="4" step="0.01" value="1" data-z style="flex:1"></label>
        <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-ok>استخدام الصورة</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`, (m, cl) => {
        const cv = $('canvas', m), ctx = cv.getContext('2d');
        const clamp = () => { const s = base * z, w = img.naturalWidth * s, h = img.naturalHeight * s; x = Math.min(0, Math.max(VW - w, x)); y = Math.min(0, Math.max(VH - h, y)); };
        const draw = () => { clamp(); const s = base * z; ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.fillStyle = '#010232'; ctx.fillRect(0, 0, VW, VH); ctx.drawImage(img, x, y, img.naturalWidth * s, img.naturalHeight * s); };
        x = (VW - img.naturalWidth * base) / 2; y = (VH - img.naturalHeight * base) / 2; draw();
        $('[data-z]', m).oninput = (e) => { const cx = VW / 2, cy = VH / 2, s0 = base * z; z = Number(e.target.value); const s1 = base * z; x = cx - ((cx - x) * s1) / s0; y = cy - ((cy - y) * s1) / s0; draw(); };
        cv.onpointerdown = (e) => { drag = [e.clientX - x, e.clientY - y]; cv.setPointerCapture(e.pointerId); };
        cv.onpointermove = (e) => { if (!drag) return; x = e.clientX - drag[0]; y = e.clientY - drag[1]; draw(); };
        cv.onpointerup = () => (drag = null);
        $('[data-x]', m).onclick = () => { cl(); resolve(null); };
        $('[data-ok]', m).onclick = () => {
          const out = document.createElement('canvas'); out.width = W; out.height = H; const o = out.getContext('2d'), k = W / VW, s = base * z;
          o.fillStyle = '#010232'; o.fillRect(0, 0, W, H); o.imageSmoothingQuality = 'high';
          o.drawImage(img, x * k, y * k, img.naturalWidth * s * k, img.naturalHeight * s * k);
          try { out.toBlob((b) => { cl(); resolve(b); }, 'image/webp', 0.88); } catch (err) { ui.toast('تعذّر قص هذه الصورة (مصدر خارجي). ارفعها من جهازك.', 'err'); }
        };
        void close;
      });
    };
    img.src = url;
  });
  const upload = async (blob, folder) => {
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.webp`;
    await sb.storage.upload('site-media', path, new File([blob], 'img.webp', { type: 'image/webp' }));
    return `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-media/${path}`;
  };
  window.uploadCropped = upload;

  // ---------- course editor sections ----------
  const facOpts = (cur) => (window.FACULTIES || []).map((f) => `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  const specList = (fid) => { const f = (window.FACULTIES || []).find((x) => x.id === fid); return f ? f.specs : []; };
  const facRow = (r = {}) => `<div class="cx-frow"><select class="bx-select" data-ff aria-label="الكلية"><option value="">— الكلية —</option>${facOpts(r.faculty)}</select>
    <select class="bx-select" data-fs aria-label="التخصص"><option value="">كل التخصصات</option>${specList(r.faculty).map((s) => `<option ${s === r.specialty ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <select class="bx-select" data-fit aria-label="درجة الملاءمة">${Object.entries(FIT).map(([k, v]) => `<option value="${k}" ${k === (r.fit || 'direct') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button type="button" class="bx-linkbtn" data-frm style="color:var(--danger-text)" aria-label="حذف">✕</button></div>`;

  window.CourseExtras = {
    async load(c) {
      if (!c || !c.id) return [];
      return sb.get('course_faculties', { select: 'faculty,specialty,fit', course_id: 'eq.' + c.id }).catch(() => []);
    },
    html(c, facs) {
      const s = c.seo || {};
      return `<details class="cx-sec" open><summary>الكليات والتخصصات المناسبة</summary>
          <p class="bx-hint">الكلية الأساسية أعلاه تظهر دائمًا. أضف هنا كل كلية يناسبها محتوى الدورة علميًا، مع درجة الملاءمة. تظهر في صفحة الدورة وفلاتر الكليات وصفحات الكليات.</p>
          <div id="cx-facs">${(facs.length ? facs : []).map(facRow).join('')}</div>
          <button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" id="cx-fadd">+ إضافة كلية</button></details>
        <details class="cx-sec"><summary>الصور: النص البديل وصورة المشاركة</summary>
          <div class="bx-field"><label for="cx-alt">النص البديل لصورة الغلاف (Alt)</label><input id="cx-alt" class="bx-input" maxlength="160" value="${esc(c.cover_alt || '')}" placeholder="مثلًا: غلاف دورة أساسيات معامل أطفال الأنابيب"></div>
          ${c.cover_url ? '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" id="cx-recrop" style="justify-self:start">قص صورة الغلاف الحالية</button>' : ''}
          <div class="bx-field"><label>صورة المشاركة على السوشيال ميديا (اختياري)</label>
            <div id="cx-ogp" class="cx-ogp">${c.og_image_url ? `<img src="${esc(c.og_image_url)}" alt="">` : '<small class="bx-hint" style="margin:0">تُستخدم صورة الغلاف إذا تركتها فارغة</small>'}</div>
            <input type="file" id="cx-og" accept="image/png,image/jpeg,image/webp" class="bx-input"><input type="hidden" id="cx-ogu" value="${esc(c.og_image_url || '')}">
            ${c.og_image_url ? '<button type="button" class="bx-linkbtn" id="cx-ogrm" style="justify-self:start">إزالة صورة المشاركة</button>' : ''}</div></details>
        <details class="cx-sec"><summary>إعدادات SEO للدورة</summary>
          <p class="bx-hint">اتركها فارغة لتُنشأ تلقائيًا من العنوان والوصف. العنوان المثالي أقل من 60 حرفًا، والوصف أقل من 160.</p>
          <div class="bx-field"><label for="cx-st">عنوان SEO</label><input id="cx-st" class="bx-input" maxlength="90" value="${esc(s.title || '')}"><small class="bx-hint" data-cnt="cx-st"></small></div>
          <div class="bx-field"><label for="cx-sd">وصف الميتا (Meta Description)</label><textarea id="cx-sd" class="bx-textarea" rows="2" maxlength="300">${esc(s.description || '')}</textarea><small class="bx-hint" data-cnt="cx-sd"></small></div>
          <div class="row2"><div class="bx-field"><label for="cx-sf">الكلمة المفتاحية الأساسية</label><input id="cx-sf" class="bx-input" maxlength="80" value="${esc(s.focus || '')}" placeholder="مثلًا: كورس أطفال الأنابيب"></div>
          <div class="bx-field"><label for="cx-sk">كلمات مفتاحية إضافية (مفصولة بفاصلة)</label><input id="cx-sk" class="bx-input" maxlength="300" value="${esc(s.keywords || '')}"></div></div>
          <div class="row2"><div class="bx-field"><label for="cx-ot">عنوان Open Graph (اختياري)</label><input id="cx-ot" class="bx-input" maxlength="90" value="${esc(s.og_title || '')}"></div>
          <div class="bx-field"><label for="cx-od">وصف Open Graph (اختياري)</label><input id="cx-od" class="bx-input" maxlength="200" value="${esc(s.og_description || '')}"></div></div>
          <div class="bx-field"><label for="cx-sc">الرابط الأساسي (Canonical) — اتركه فارغًا في الغالب</label><input id="cx-sc" class="bx-input" dir="ltr" value="${esc(s.canonical || '')}" placeholder="https://biosyneg.com/course-${esc(c.slug || 'slug')}.html"></div>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="cx-ni" ${s.noindex ? 'checked' : ''}> إخفاء الدورة من محركات البحث (noindex)</label>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="cx-sm" ${s.sitemap === false ? '' : 'checked'}> تضمينها في خريطة الموقع (Sitemap)</label>
          <p class="bx-hint" style="margin:0">بيانات Course وFAQ وBreadcrumb وPerson المنظمة (Schema) تُنشأ تلقائيًا من محتوى الصفحة نفسه. <a class="bx-link" target="_blank" rel="noopener" href="https://search.google.com/test/rich-results?url=${encodeURIComponent('https://biosyneg.com/course-' + (c.slug || '') + '.html')}">اختبر البيانات المنظمة ↗</a></p></details>`;
    },
    bind(m, c) {
      const box = $('#cx-facs', m);
      const wire = (row) => {
        $('[data-ff]', row).onchange = (e) => { $('[data-fs]', row).innerHTML = '<option value="">كل التخصصات</option>' + specList(e.target.value).map((s) => `<option>${esc(s)}</option>`).join(''); };
        $('[data-frm]', row).onclick = () => row.remove();
      };
      $$('.cx-frow', box).forEach(wire);
      $('#cx-fadd', m).onclick = () => { box.insertAdjacentHTML('beforeend', facRow()); wire(box.lastElementChild); };
      const cnt = () => $$('[data-cnt]', m).forEach((s) => { const el = $('#' + s.dataset.cnt, m); s.textContent = `${el.value.length} حرف`; });
      $$('#cx-st,#cx-sd', m).forEach((el) => el.addEventListener('input', cnt)); cnt();
      // cover: crop to 1280×720 before uploading (replaces the plain upload handler)
      const cover = $('#cimg', m);
      if (cover) cover.onchange = async (ev) => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return ui.toast('يجب أن تكون الصورة PNG أو JPG أو WebP.', 'err');
        const b = await window.cropImage(f, { w: 1280, h: 720 }); if (!b) return;
        try { const u = await upload(b, 'courses'); $('#cimgu', m).value = u; $('#cimg-prev', m).innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover">`; ui.toast('تم رفع الصورة. اضغط «حفظ» لتثبيتها.'); }
        catch (err) { ui.toast(arErr(err), 'err'); }
      };
      const rc = $('#cx-recrop', m);
      if (rc) rc.onclick = async () => {
        const b = await window.cropImage($('#cimgu', m).value || c.cover_url, { w: 1280, h: 720 }); if (!b) return;
        try { const u = await upload(b, 'courses'); $('#cimgu', m).value = u; $('#cimg-prev', m).innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover">`; ui.toast('تم. اضغط «حفظ».'); } catch (err) { ui.toast(arErr(err), 'err'); }
      };
      $('#cx-og', m).onchange = async (ev) => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
        const b = await window.cropImage(f, { w: 1200, h: 630 }); if (!b) return;
        try { const u = await upload(b, 'og'); $('#cx-ogu', m).value = u; $('#cx-ogp', m).innerHTML = `<img src="${u}" alt="">`; } catch (err) { ui.toast(arErr(err), 'err'); }
      };
      const ogrm = $('#cx-ogrm', m); if (ogrm) ogrm.onclick = () => { $('#cx-ogu', m).value = ''; $('#cx-ogp', m).innerHTML = '<small class="bx-hint" style="margin:0">ستُزال عند الحفظ</small>'; };
    },
    collect(m) {
      const v = (id) => ($('#' + id, m).value || '').trim();
      const seo = { title: v('cx-st'), description: v('cx-sd'), focus: v('cx-sf'), keywords: v('cx-sk'), og_title: v('cx-ot'), og_description: v('cx-od'), canonical: v('cx-sc'), noindex: $('#cx-ni', m).checked, sitemap: $('#cx-sm', m).checked };
      Object.keys(seo).forEach((k) => { if (seo[k] === '' || (k === 'noindex' && !seo[k]) || (k === 'sitemap' && seo[k])) delete seo[k]; });
      if (seo.canonical && !/^https:\/\//.test(seo.canonical)) throw new Error('الرابط الأساسي يجب أن يبدأ بـ https://');
      const facs = []; const seen = new Set();
      $$('.cx-frow', m).forEach((r) => { const f = $('[data-ff]', r).value, s = $('[data-fs]', r).value, k = f + '|' + s; if (f && !seen.has(k)) { seen.add(k); facs.push({ faculty: f, specialty: s, fit: $('[data-fit]', r).value }); } });
      return { row: { seo, cover_alt: v('cx-alt') || null, og_image_url: v('cx-ogu') || null }, facs };
    },
    async saveFacs(courseId, facs) {
      await sb.remove('course_faculties', { course_id: 'eq.' + courseId });
      if (facs.length) await sb.insert('course_faculties', facs.map((r) => ({ ...r, course_id: courseId })));
    },
  };
})();
