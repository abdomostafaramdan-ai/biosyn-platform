/* Admin → «الأخبار والفعاليات» (news_items, shown on the home page and news.html)
   and «آراء الطلاب» (testimonials, the auto-scrolling strip on the home page). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const KIND = { news: 'خبر', event: 'فعالية' };
  const pub = (path) => `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-media/${path}`;
  async function uploadImage(file, folder) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('يجب أن تكون الصورة PNG أو JPG أو WebP.');
    if (file.size > 5 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 5 ميجابايت.');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
    await sb.storage.upload('site-media', path, file);
    return pub(path);
  }
  const say = (m, t, k) => { m.className = 'bx-formmsg' + (k ? ' ' + k : ''); m.textContent = t; };

  window.newsAdmin = async function (main) {
    const list = await sb.get('news_items', { select: '*', order: 'published_at.desc', limit: 500 }).catch(() => []);
    main.innerHTML = `<div class="bx-stats">${D.stat('الأخبار', list.filter((n) => n.kind === 'news').length)}${D.stat('الفعاليات', list.filter((n) => n.kind === 'event').length)}${D.stat('ظاهرة في الموقع', list.filter((n) => n.visible).length)}</div>
      ${D.panel('الأخبار والفعاليات', `<p class="bx-hint" style="margin-top:0">تظهر أحدث 3 عناصر في الصفحة الرئيسية (المثبّتة أولًا)، وكل العناصر في صفحة <a class="bx-link" href="news.html" target="_blank">الأخبار والفعاليات</a> المرتبطة من أسفل الموقع.</p>
        ${D.table(['', 'العنوان', 'النوع', 'التاريخ', 'الحالة', ''], list.map((n) => [
          n.cover_url ? `<img src="${esc(n.cover_url)}" alt="" style="width:72px;height:44px;object-fit:cover;border-radius:8px">` : '—',
          `<b dir="auto">${esc(n.title)}</b>${n.featured ? ' <span class="bx-st bx-st-ok">مثبّت</span>' : ''}`, KIND[n.kind], D.date(n.kind === 'event' && n.event_date ? n.event_date : n.published_at),
          n.visible ? '<span class="bx-st bx-st-ok">ظاهر</span>' : '<span class="bx-st bx-st-mute">مخفي</span>',
          `<div class="bx-btnrow" style="margin:0"><button class="bs-btn bs-btn-secondary bs-btn-sm" data-e="${n.id}">تعديل</button><a class="bs-btn bs-btn-ghost bs-btn-sm" href="news.html?id=${n.id}" target="_blank">عرض</a></div>`]), 'لا توجد أخبار أو فعاليات بعد.')}`,
        '<button class="bs-btn bs-btn-primary bs-btn-sm" type="button" id="nw-new">+ خبر أو فعالية</button>')}`;
    $('#nw-new', main).onclick = () => edit(null);
    $$('[data-e]', main).forEach((b) => (b.onclick = () => edit(list.find((n) => n.id === b.dataset.e))));

    function edit(n) {
      const x = n || { kind: 'news', title: '', summary: '', body: '', cover_url: '', gallery: [], video_url: '', event_date: '', location: '', published_at: new Date().toISOString(), visible: true, featured: false };
      let gallery = Array.isArray(x.gallery) ? [...x.gallery] : [];
      ui.modal(`<h3>${n ? 'تعديل' : 'خبر أو فعالية جديدة'}</h3><form class="bx-form2" id="nwf" novalidate>
        <div class="bx-field"><label for="nw-k">النوع</label><select id="nw-k" class="bx-select"><option value="news"${x.kind === 'news' ? ' selected' : ''}>خبر</option><option value="event"${x.kind === 'event' ? ' selected' : ''}>فعالية</option></select></div>
        <div class="bx-field"><label for="nw-t">العنوان *</label><input id="nw-t" class="bx-input" value="${esc(x.title)}" maxlength="160"></div>
        <div class="bx-field"><label for="nw-s">ملخص قصير (يظهر على البطاقة)</label><input id="nw-s" class="bx-input" value="${esc(x.summary || '')}" maxlength="240"></div>
        <div class="bx-field"><label for="nw-b">النص</label><textarea id="nw-b" class="bx-input" rows="8" dir="rtl">${esc(x.body || '')}</textarea><small class="bx-hint">اترك سطرًا جديدًا بين الفقرات.</small></div>
        <div class="bx-field"><label for="nw-d">تاريخ النشر</label><input id="nw-d" class="bx-input" type="date" value="${String(x.published_at || '').slice(0, 10)}" dir="ltr"></div>
        <div class="bx-field" data-ev><label for="nw-ed">تاريخ الفعالية</label><input id="nw-ed" class="bx-input" type="date" value="${x.event_date || ''}" dir="ltr"></div>
        <div class="bx-field" data-ev><label for="nw-l">المكان</label><input id="nw-l" class="bx-input" value="${esc(x.location || '')}" placeholder="مثال: كلية العلوم – جامعة المنصورة"></div>
        <div class="bx-field"><label for="nw-c">صورة الغلاف</label>${x.cover_url ? `<img src="${esc(x.cover_url)}" alt="" style="max-width:220px;border-radius:10px;display:block;margin-bottom:8px" id="nw-cimg">` : ''}<input id="nw-c" type="file" accept="image/png,image/jpeg,image/webp" class="bx-input"></div>
        <div class="bx-field"><label for="nw-g">صور إضافية (معرض الصور)</label><div id="nw-gal" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div><input id="nw-g" type="file" accept="image/png,image/jpeg,image/webp" multiple class="bx-input"></div>
        <div class="bx-field"><label for="nw-v">رابط فيديو (اختياري)</label><input id="nw-v" class="bx-input" dir="ltr" value="${esc(x.video_url || '')}" placeholder="https://"></div>
        <label class="bx-check"><input type="checkbox" id="nw-vis"${x.visible ? ' checked' : ''}> ظاهر في الموقع</label>
        <label class="bx-check"><input type="checkbox" id="nw-f"${x.featured ? ' checked' : ''}> تثبيت في الصفحة الرئيسية</label>
        <div class="bx-formmsg" aria-live="polite"></div>
        <div class="bx-modal-actions">${n ? '<button type="button" class="bs-btn bs-btn-ghost" data-del style="margin-inline-end:auto">حذف</button>' : ''}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button><button type="submit" class="bs-btn bs-btn-primary">حفظ</button></div></form>`, (m, close) => {
        const ev = () => $$('[data-ev]', m).forEach((e) => (e.hidden = $('#nw-k', m).value !== 'event'));
        $('#nw-k', m).onchange = ev; ev();
        const drawGal = () => { $('#nw-gal', m).innerHTML = gallery.map((g, i) => `<span style="position:relative"><img src="${esc(g)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><button type="button" data-rm="${i}" aria-label="حذف الصورة" style="position:absolute;top:-6px;inset-inline-end:-6px;width:22px;height:22px;border-radius:50%;border:0;background:#ff6b6b;color:#fff;cursor:pointer">×</button></span>`).join(''); };
        drawGal();
        $('#nw-gal', m).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { gallery.splice(Number(b.dataset.rm), 1); drawGal(); } };
        $('[data-x]', m).onclick = close;
        const del = $('[data-del]', m);
        if (del) del.onclick = async () => {
          if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'اضغط مرة أخرى للتأكيد'; return; }
          try { await sb.remove('news_items', { id: 'eq.' + n.id }); ui.toast('تم الحذف'); close(); D.reload(); } catch (e) { say($('.bx-formmsg', m), arErr(e), 'err'); }
        };
        $('#nwf', m).onsubmit = async (e) => {
          e.preventDefault(); const msg = $('.bx-formmsg', m), btn = $('button[type=submit]', m);
          const title = $('#nw-t', m).value.trim(); if (title.length < 4) { say(msg, 'اكتب عنوانًا واضحًا.', 'err'); return; }
          const vid = $('#nw-v', m).value.trim(); if (vid && !/^https:\/\//.test(vid)) { say(msg, 'يجب أن يبدأ رابط الفيديو بـ https://', 'err'); return; }
          btn.disabled = true;
          try {
            const row = { kind: $('#nw-k', m).value, title, summary: $('#nw-s', m).value.trim() || null, body: $('#nw-b', m).value.trim() || null, video_url: vid || null,
              event_date: $('#nw-k', m).value === 'event' ? ($('#nw-ed', m).value || null) : null, location: $('#nw-k', m).value === 'event' ? ($('#nw-l', m).value.trim() || null) : null,
              published_at: $('#nw-d', m).value ? new Date($('#nw-d', m).value + 'T12:00:00').toISOString() : new Date().toISOString(),
              visible: $('#nw-vis', m).checked, featured: $('#nw-f', m).checked, updated_at: new Date().toISOString() };
            const cf = $('#nw-c', m).files[0]; if (cf) { say(msg, 'جارٍ رفع صورة الغلاف…'); row.cover_url = await uploadImage(cf, 'news'); }
            const gf = [...$('#nw-g', m).files]; for (let i = 0; i < gf.length; i++) { say(msg, `جارٍ رفع الصور (${i + 1} من ${gf.length})…`); gallery.push(await uploadImage(gf[i], 'news')); }
            row.gallery = gallery;
            if (n) await sb.update('news_items', { id: 'eq.' + n.id }, row); else await sb.insert('news_items', row);
            ui.toast('تم الحفظ'); close(); D.reload();
          } catch (err) { btn.disabled = false; say(msg, arErr(err), 'err'); }
        };
      });
    }
  };

  window.testimonialsAdmin = async function (main) {
    const list = await sb.get('testimonials', { select: '*', order: 'sort.asc,created_at.asc' }).catch(() => []);
    main.innerHTML = D.panel('آراء الطلاب', `<p class="bx-hint" style="margin-top:0">تظهر في شريط متحرك في الصفحة الرئيسية بالترتيب من الأصغر إلى الأكبر. يمكنك إضافة لقطة شاشة لرسالة طالب، أو كتابة الرأي نصًا مع اسم صاحبه. أضف فقط آراء حقيقية وصلتك من طلاب، ويُفضّل أخذ موافقتهم أو إخفاء أسمائهم وصورهم.</p>
      <div class="nw-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${list.map((x) => `<div class="bx-panel" style="padding:10px;margin:0;${x.visible ? '' : 'opacity:.55'}">
        ${x.image_url ? `<img src="${esc(x.image_url)}" alt="" style="width:100%;aspect-ratio:810/690;object-fit:cover;border-radius:10px;background:#fff">` : `<q dir="auto" style="display:block;font-size:14px;line-height:1.8">${esc(x.quote)}</q><b dir="auto">${esc(x.author || '')}</b>`}
        <div class="bx-btnrow" style="margin:8px 0 0;gap:6px;flex-wrap:wrap"><input class="bx-input" type="number" value="${x.sort}" data-sort="${x.id}" aria-label="الترتيب" style="width:70px;padding:6px 8px" dir="ltr">
          <button class="bs-btn bs-btn-ghost bs-btn-sm" data-vis="${x.id}">${x.visible ? 'إخفاء' : 'إظهار'}</button><button class="bs-btn bs-btn-ghost bs-btn-sm" data-del="${x.id}">حذف</button></div></div>`).join('') || '<p class="bx-hint">لا توجد آراء بعد.</p>'}</div>`,
      '<button class="bs-btn bs-btn-primary bs-btn-sm" type="button" id="tm-new">+ رأي جديد</button>');
    $$('[data-sort]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('testimonials', { id: 'eq.' + i.dataset.sort }, { sort: parseInt(i.value, 10) || 0 }); ui.toast('تم تحديث الترتيب'); } catch (e) { ui.toast(arErr(e)); } }));
    $$('[data-vis]', main).forEach((b) => (b.onclick = async () => { const x = list.find((y) => y.id === b.dataset.vis); try { await sb.update('testimonials', { id: 'eq.' + x.id }, { visible: !x.visible }); D.reload(); } catch (e) { ui.toast(arErr(e)); } }));
    $$('[data-del]', main).forEach((b) => (b.onclick = async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد الحذف'; return; }
      try { await sb.remove('testimonials', { id: 'eq.' + b.dataset.del }); D.reload(); } catch (e) { ui.toast(arErr(e)); }
    }));
    $('#tm-new', main).onclick = () => ui.modal(`<h3>رأي جديد</h3><form class="bx-form2" id="tmf" novalidate>
      <div class="bx-field"><label for="tm-i">لقطة شاشة لرأي الطالب</label><input id="tm-i" type="file" accept="image/png,image/jpeg,image/webp" class="bx-input"></div>
      <p class="bx-hint" style="margin:0">أو اكتب الرأي نصًا:</p>
      <div class="bx-field"><label for="tm-q">نص الرأي</label><textarea id="tm-q" class="bx-input" rows="4" maxlength="600"></textarea></div>
      <div class="bx-field"><label for="tm-a">الاسم</label><input id="tm-a" class="bx-input" maxlength="80"></div>
      <div class="bx-field"><label for="tm-r">الصفة (اختياري)</label><input id="tm-r" class="bx-input" maxlength="100" placeholder="مثال: طالبة بكلية الصيدلة"></div>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button><button type="submit" class="bs-btn bs-btn-primary">حفظ</button></div></form>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('#tmf', m).onsubmit = async (e) => {
        e.preventDefault(); const msg = $('.bx-formmsg', m), f = $('#tm-i', m).files[0], q = $('#tm-q', m).value.trim();
        if (!f && q.length < 10) { say(msg, 'ارفع لقطة شاشة أو اكتب نص الرأي.', 'err'); return; }
        $('button[type=submit]', m).disabled = true;
        try {
          const row = { quote: q || null, author: $('#tm-a', m).value.trim() || null, role: $('#tm-r', m).value.trim() || null, sort: (list.reduce((a, x) => Math.max(a, x.sort), 0) || 0) + 1 };
          if (f) { say(msg, 'جارٍ رفع الصورة…'); row.image_url = await uploadImage(f, 'feedback'); }
          await sb.insert('testimonials', row); ui.toast('تمت الإضافة'); close(); D.reload();
        } catch (err) { $('button[type=submit]', m).disabled = false; say(msg, arErr(err), 'err'); }
      };
    });
  };
})();
