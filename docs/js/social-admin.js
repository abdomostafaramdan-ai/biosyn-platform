/* Admin → «السوشيال والنشرة البريدية»: footer social links (site_content.social) and newsletter subscribers
   (newsletter_subscribers, filled by the footer sign-up box). Campaigns can target them as «مشتركو النشرة البريدية». */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NETS = [
    ['facebook', 'Facebook', 'https://www.facebook.com/…'], ['instagram', 'Instagram', 'https://www.instagram.com/…'],
    ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/…'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@…'],
    ['youtube', 'YouTube', 'https://www.youtube.com/@…'], ['x', 'X (Twitter)', 'https://x.com/…'], ['whatsapp', 'WhatsApp', 'https://wa.me/20…'],
  ];
  const D = () => window.Dash;
  const say = (el, t, k) => { el.className = 'bx-formmsg ' + (k || ''); el.textContent = t; };
  const fmtDate = (d) => new Date(d).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
  const srcAr = (s) => { const m = /^footer:(.*)$/.exec(s || ''); return m ? 'أسفل الصفحة · ' + (m[1] || 'index.html') : s || '—'; };

  window.socialAdmin = async function (main) {
    const [row, subs] = await Promise.all([
      sb.one('site_content', { select: 'data', key: 'eq.social' }).catch(() => null),
      sb.get('newsletter_subscribers', { select: 'email,source,created_at,user_id', order: 'created_at.desc' }).catch(() => []),
    ]);
    const links = (row && row.data) || {}; let exists = !!row;
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    let q = '';
    main.innerHTML = `<div class="bx-stats">
        ${D().stat('مشتركو النشرة البريدية', subs.length.toLocaleString('en-US'), 'من صندوق «تابع أخبار Biosyn» أسفل كل صفحة')}
        ${D().stat('اشتركوا هذا الشهر', subs.filter((s) => new Date(s.created_at) >= month).length, subs.filter((s) => s.user_id).length + ' منهم لديهم حساب على المنصة')}
      </div>`
      + D().panel('حسابات السوشيال ميديا', `<p class="bx-hint" style="margin-top:0">تظهر كأيقونات أسفل كل صفحات الموقع بالترتيب نفسه. اترك الخانة فارغة لإخفاء الأيقونة. الرابط يجب أن يبدأ بـ https://</p>
        <div class="row2">${NETS.map(([k, label, ph]) => `<div class="bx-field"><label for="so-${k}">${label}</label><input id="so-${k}" class="bx-input" dir="ltr" inputmode="url" placeholder="${ph}" value="${esc(links[k] || '')}"></div>`).join('')}</div>
        <div class="bx-btnrow" style="margin-top:12px"><button class="bs-btn bs-btn-primary" id="so-save">حفظ الروابط</button><a class="bs-btn bs-btn-ghost" href="index.html" target="_blank" rel="noopener">معاينة في الموقع ↗</a></div>
        <div class="bx-formmsg" id="so-msg" aria-live="polite"></div>`)
      + D().panel('المشتركون في النشرة البريدية', `<div class="bx-spread" style="margin-bottom:12px;gap:12px;flex-wrap:wrap">
          <input id="nl-q" class="bx-input" type="search" placeholder="ابحث بالبريد" style="max-width:320px">
          <span class="bx-btnrow"><button class="bs-btn bs-btn-ghost bs-btn-sm" id="nl-csv" ${subs.length ? '' : 'disabled'}>تصدير CSV</button><a class="bs-btn bs-btn-secondary bs-btn-sm" href="#emails">أرسل حملة للمشتركين</a></span></div>
        <div id="nl-list"></div>
        <p class="bx-hint">لإرسال الأخبار: من «رسائل البريد» أنشئ حملة واختر الجمهور «مشتركو النشرة البريدية». كل رسالة تحتوي على رابط لإلغاء الاشتراك، ولا تُرسل لمن ألغى اشتراكه.</p>`);

    const list = $('#nl-list', main);
    const drawList = () => {
      const rows = subs.filter((s) => !q || s.email.includes(q));
      list.innerHTML = D().table(['البريد الإلكتروني', 'مكان الاشتراك', 'التاريخ', 'حساب', ''], rows.slice(0, 300).map((s) => [
        `<span class="bs-latin" dir="ltr">${esc(s.email)}</span>`, esc(srcAr(s.source)), fmtDate(s.created_at), s.user_id ? '<span class="bx-st bx-st-ok">نعم</span>' : '<span class="bx-st bx-st-mute">لا</span>',
        `<button class="bx-linkbtn" data-del="${esc(s.email)}" style="color:var(--danger-text)">حذف</button>`]), q ? 'لا توجد نتائج' : 'لا يوجد مشتركون بعد. صندوق الاشتراك يظهر أسفل كل صفحات الموقع.')
        + (rows.length > 300 ? `<p class="bx-hint">يظهر أول 300 من ${rows.length}. استخدم البحث أو التصدير.</p>` : '');
      $$('[data-del]', list).forEach((b) => (b.onclick = async () => {
        if (!confirm(`حذف ${b.dataset.del} من النشرة البريدية؟ لن تصله رسائل النشرة بعد ذلك.`)) return;
        try { await sb.remove('newsletter_subscribers', { email: 'eq.' + b.dataset.del }); subs.splice(subs.findIndex((s) => s.email === b.dataset.del), 1); drawList(); ui.toast('تم الحذف.'); }
        catch (e) { ui.toast(arErr(e)); }
      }));
    };
    drawList();
    $('#nl-q', main).oninput = (e) => { q = e.target.value.trim().toLowerCase(); drawList(); };
    $('#nl-csv', main).onclick = () => {
      const csv = '﻿email,source,subscribed_at,has_account\n' + subs.map((s) => [s.email, s.source || '', s.created_at, s.user_id ? 'yes' : 'no'].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `biosyn-newsletter-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#so-save', main).onclick = async (ev) => {
      const msg = $('#so-msg', main), data = {};
      for (const [k, label] of NETS) {
        const v = $('#so-' + k, main).value.trim();
        if (!v) continue;
        if (!/^https:\/\/[^\s]+\.[^\s]+/.test(v)) { say(msg, `رابط ${label} غير صحيح. يجب أن يبدأ بـ https://`, 'err'); $('#so-' + k, main).focus(); return; }
        data[k] = v;
      }
      ev.currentTarget.disabled = true;
      try {
        if (exists) await sb.update('site_content', { key: 'eq.social' }, { data, updated_at: new Date().toISOString() }); else { await sb.insert('site_content', { key: 'social', data }); exists = true; }
        try { localStorage.setItem('biosyn.social', JSON.stringify(data)); } catch {}
        say(msg, 'تم الحفظ. تظهر الروابط الجديدة أسفل صفحات الموقع فورًا.', 'ok');
      } catch (e) { say(msg, arErr(e), 'err'); }
      ev.currentTarget.disabled = false;
    };
  };
})();
