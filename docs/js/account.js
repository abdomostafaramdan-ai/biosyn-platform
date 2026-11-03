/* Student account */
(() => {
  'use strict';
  const D = window.Dash;
  let me;

  async function subscription() {
    const rows = await sb.get('subscriptions', { select: '*,plans(name)', order: 'ends_at.desc', limit: 10 });
    const now = Date.now();
    const active = rows.filter((s) => new Date(s.starts_at) <= now && new Date(s.ends_at) >= now);
    const upcoming = rows.filter((s) => new Date(s.starts_at) > now);
    return { rows, current: active[0] || null, upcoming };
  }

  async function myCourses() {
    const prog = await sb.get('lecture_progress', { select: 'lecture_id,completed,max_pct,updated_at,lectures(id,title,position,course_id)', order: 'updated_at.desc', limit: 500 });
    const ids = [...new Set(prog.map((p) => p.lectures && p.lectures.course_id).filter(Boolean))];
    if (!ids.length) return [];
    const cs = await sb.get('courses', { select: 'id,slug,title,cover_code,lectures(id,position,title)', id: 'in.(' + ids.join(',') + ')' });
    return cs.map((c) => {
      const mine = prog.filter((p) => p.lectures && p.lectures.course_id === c.id);
      const done = mine.filter((p) => p.completed).length, total = (c.lectures || []).length;
      const last = mine[0];
      return { ...c, done, total, pct: total ? Math.round((done / total) * 100) : 0, last, updated: last ? last.updated_at : null };
    }).sort((a, b) => new Date(b.updated) - new Date(a.updated));
  }

  function loadQR() {
    if (window.QRCode) return Promise.resolve(true);
    return new Promise((res) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  }
  function certModal(cert, name) {
    const url = new URL('verify.html?c=' + encodeURIComponent(cert.code || ''), location.href).href;
    ui.modal(`<div class="bx-cert"><small>شهادة إتمام</small><h4>Biosyn Egypt</h4><small>تشهد المنصة بأن</small><div class="nm">${esc(name)}</div><small>قد أتم بنجاح دورة</small><h4 class="bs-latin" style="direction:ltr">${esc(cert.courses ? cert.courses.title : '')}</h4><small>بتاريخ ${D.date(cert.issued_at)} · رقم الشهادة <b class="bs-latin">${esc(cert.code || cert.id.slice(0, 8).toUpperCase())}</b></small>
      <div style="display:flex;gap:12px;align-items:center;justify-content:center;margin-top:14px"><div id="qr" style="background:#fff;padding:6px;border-radius:6px;line-height:0"></div><small style="max-width:220px">للتحقق من صحة الشهادة امسح الكود أو افتح:<br><span class="bs-latin" style="direction:ltr;word-break:break-all">${esc(url)}</span></small></div></div>
      <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-primary" data-print>طباعة / حفظ PDF</button><button type="button" class="bs-btn bs-btn-secondary" data-copy>نسخ رابط التحقق</button><button type="button" class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`,
    (m, close) => {
      $('[data-print]', m).onclick = () => window.print(); $('[data-x]', m).onclick = close;
      $('[data-copy]', m).onclick = async () => { try { await navigator.clipboard.writeText(url); ui.toast('تم نسخ الرابط.'); } catch { ui.toast(url); } };
      loadQR().then((ok) => { const el = $('#qr', m); if (ok && el && window.QRCode) new QRCode(el, { text: url, width: 96, height: 96 }); else if (el) el.remove(); });
    });
  }

  const GWN = { paymob: 'Paymob', stripe: 'Stripe', fawaterk: 'Fawaterk', manual: 'تحويل يدوي' };
  function receiptModal(p) {
    const item = p.plans ? 'اشتراك: ' + p.plans.name : p.courses ? 'دورة تفاعلية: ' + p.courses.title : '—';
    const loc = p.currency && p.currency !== 'EGP';
    const amt = loc ? Number(p.amount_local) : Number(p.amount_egp), fee = loc ? Number(p.fee_local || 0) : Number(p.fee_egp || 0), total = amt + fee;
    const disc = loc ? 0 : Number(p.discount_egp || 0), list = loc ? amt : Number(p.list_price_egp ?? p.amount_egp);
    const M = (v) => (loc ? `${EGP(v)} ${p.currency}` : D.money(v));
    const row = (k, v) => `<tr><td style="padding:6px 0;color:inherit;opacity:.75">${k}</td><td style="padding:6px 0;text-align:left">${v}</td></tr>`;
    ui.modal(`<div class="bx-cert" style="text-align:right"><h4 style="text-align:center">Biosyn Egypt</h4><small style="display:block;text-align:center">إيصال دفع</small>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px">
      ${row('رقم الإيصال', `<b class="bs-latin">${esc(String(p.receipt_no || '—'))}</b>`)}${row('التاريخ', D.dateTime(p.paid_at || p.created_at))}${row('العميل', esc(me.full_name || '') + '<br><span class="bs-latin">' + esc(sb.user.email) + '</span>')}
      ${row('البند', esc(item))}${row('السعر', M(list))}${disc ? row('الخصم', '− ' + M(disc)) : ''}${fee ? row('رسوم بوابة الدفع', M(fee)) : ''}
      <tr><td style="padding:10px 0;border-top:1px solid currentColor"><b>الإجمالي المدفوع</b></td><td style="padding:10px 0;border-top:1px solid currentColor;text-align:left"><b>${M(total)}</b></td></tr>
      ${row('طريقة الدفع', esc(GWN[p.gateway] || p.gateway))}${row('الحالة', p.status === 'refunded' ? 'مُسترد' : 'مدفوع')}</table>
      <small style="display:block;margin-top:12px;text-align:center">هذا إيصال إلكتروني صادر من المنصة · contact@biosynegypt.com</small></div>
      <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-primary" data-print>طباعة / حفظ PDF</button><button type="button" class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`,
    (m, close) => { $('[data-print]', m).onclick = () => window.print(); $('[data-x]', m).onclick = close; });
  }

  const views = {
    async home(main) {
      const [sub, courses, enr, certs] = await Promise.all([subscription(), myCourses(), sb.get('enrollments', { select: '*,courses(slug,title,cover_code,starts_at)' }), sb.get('certificates', { select: 'id', limit: 50 })]);
      const last = courses.find((c) => c.pct < 100) || courses[0];
      const first = (me.full_name || '').split(' ')[0] || 'بك';
      main.innerHTML = `<div id="paybanner"></div>
        ${last ? `<section class="bx-resume" aria-labelledby="hi"><span class="bs-wm bs-wm-brand" aria-hidden="true"></span><div class="bx-resume-cover" aria-hidden="true"><span>${esc(last.cover_code || last.title.slice(0, 2).toUpperCase())}</span></div><div class="bx-resume-body"><span class="bx-eyebrow">أهلاً ${esc(first)} · تابع من حيث توقفت</span><h2 id="hi" class="bs-latin" style="direction:ltr;text-align:right">${esc(last.title)}</h2><p style="margin:0">أنهيت ${last.done} من ${last.total} محاضرة</p><div class="bx-progress" role="progressbar" aria-valuenow="${last.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${last.pct}%"></i></div></div><a href="watch.html?c=${esc(last.slug)}" class="bs-btn bs-btn-primary bs-btn-lg">تابع التعلم ←</a></section>`
          : `<section class="bx-resume"><span class="bs-wm bs-wm-brand" aria-hidden="true"></span><div class="bx-resume-body"><span class="bx-eyebrow">أهلاً ${esc(first)}</span><h2 id="hi">ابدأ رحلتك التعليمية</h2><p style="margin:0">${sub.current ? 'اشتراكك ساري. اختر دورة وابدأ المشاهدة.' : 'اشترك في إحدى الباقات للوصول إلى كل الكورسات المسجلة.'}</p></div><a href="${sub.current ? 'courses.html' : 'pricing.html'}" class="bs-btn bs-btn-primary bs-btn-lg">${sub.current ? 'تصفح الدورات' : 'اختر باقة'}</a></section>`}
        <div class="bx-stats">
          ${D.stat('الاشتراك', sub.current ? esc(sub.current.plans.name) : 'غير مشترك', sub.current ? 'ينتهي في ' + D.date(sub.current.ends_at) : '<a class="bx-link" href="pricing.html">عرض الباقات</a>')}
          ${D.stat('دورات بدأتها', courses.length)}
          ${D.stat('محاضرات مكتملة', courses.reduce((s, c) => s + c.done, 0))}
          ${D.stat('الشهادات', certs.length)}
        </div>
        ${D.panel('دوراتي', courses.length ? courses.map((c) => `<div class="bx-crow"><div class="bx-mine-code">${esc(c.cover_code || c.title.slice(0, 2).toUpperCase())}</div><div><h4>${esc(c.title)}</h4><div class="bx-progress" role="progressbar" aria-valuenow="${c.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${c.pct}%"></i></div><small>${c.done} من ${c.total} محاضرة</small></div><a href="watch.html?c=${esc(c.slug)}" class="bs-btn bs-btn-primary bs-btn-sm">${c.pct >= 100 ? 'مراجعة' : 'تابع'}</a></div>`).join('') : '<div class="bx-empty-big"><b>لم تبدأ أي دورة بعد</b><a class="bx-link" href="courses.html">تصفح الدورات المسجلة</a></div>')}
        ${enr.length ? D.panel('كورساتي التفاعلية', enr.map((e) => `<div class="bx-crow"><div class="bx-mine-code" style="font-size:18px">${esc((e.courses.cover_code || e.courses.title.slice(0, 2)).toUpperCase())}</div><div><h4>${esc(e.courses.title)}</h4><small>${e.courses.starts_at ? 'يبدأ ' + D.date(e.courses.starts_at) : 'سنوافيك بموعد الجلسات'}</small></div><span class="bx-st bx-st-ok">مسجّل</span></div>`).join('')) : ''}`;
      const q = new URLSearchParams(location.search), pay = q.get('payment');
      if (pay === 'cancelled') $('#paybanner').innerHTML = '<div class="bx-banner bx-appmsg" role="status">لم تكتمل عملية الدفع. لم يُخصم منك أي مبلغ، ويمكنك المحاولة مرة أخرى.</div>';
      if (pay === 'success') watchPayment(q.get('id'));
    },

    async payments(main) {
      const [rows, myRefs] = await Promise.all([sb.get('payments', { select: '*,plans(name),courses(title)', order: 'created_at.desc', limit: 100 }), sb.get('requests', { select: 'status,payload', type: 'eq.refund', user_id: 'eq.' + sb.user.id }).catch(() => [])]);
      const refOf = Object.fromEntries(myRefs.map((r) => [r.payload && r.payload.payment_id, r]));
      const REF_ST = { new: ['طلب الاسترداد وصل', 'warn'], in_review: ['طلب الاسترداد قيد المراجعة', 'info'], accepted: ['تم الاسترداد', 'ok'], rejected: ['طلب الاسترداد اترفض', 'mute'] };
      const sub = await subscription();
      main.innerHTML = D.panel('الاشتراك', sub.current
        ? `<p style="margin:0">باقتك الحالية: <b>${esc(sub.current.plans.name)}</b> · تنتهي في <b>${D.date(sub.current.ends_at)}</b>${sub.upcoming[0] ? ` · الباقة التالية تبدأ ${D.date(sub.upcoming[0].starts_at)}` : ''}.</p><p class="bx-hint">الاشتراك لا يتجدد تلقائيًا، يمكنك التمديد بالاشتراك في باقة جديدة وستبدأ بعد انتهاء الحالية. <a class="bx-link" href="pricing.html">عرض الباقات</a></p>`
        : '<p style="margin:0">ليس لديك اشتراك ساري. <a class="bx-link" href="pricing.html">اختر باقة</a></p>')
        + D.panel('المدفوعات', D.table(['التاريخ', 'البند', 'المبلغ', 'الحالة', ''], rows.map((p) => {
          const rq = refOf[p.id];
          const refundable = !rq && p.purpose === 'interactive_course' && p.status === 'paid' && p.paid_at && Date.now() <= new Date(p.paid_at).getTime() + 7 * 864e5;
          const rqTag = rq && p.status !== 'refunded' ? `<br><span class="bx-st bx-st-${REF_ST[rq.status][1]}" style="margin-top:4px">${REF_ST[rq.status][0]}</span>${rq.status === 'rejected' && rq.payload.decision_note ? `<br><small class="bx-hint">${esc(rq.payload.decision_note)}</small>` : ''}` : '';
          return [D.date(p.created_at), esc(p.plans ? p.plans.name : p.courses ? p.courses.title : '—'), paidTxt(p, 'total') + (Number(p.fee_egp) ? `<br><small class="bx-hint">منها ${paidTxt(p, 'fee')} رسوم البوابة</small>` : ''), D.badge('pay', p.status) + (p.gateway === 'manual' && p.status === 'pending' ? '<br><small class="bx-hint">تحويل يدوي قيد المراجعة</small>' : '') + rqTag, [p.receipt_no ? `<button class="bx-linkbtn" data-rc="${p.id}">الإيصال</button>` : '', refundable ? `<button class="bx-linkbtn" data-refund="${p.id}">اطلب الاسترداد</button>` : ''].filter(Boolean).join(' · ')];
        }), 'لا توجد مدفوعات بعد'));
      $$('[data-rc]', main).forEach((b) => (b.onclick = () => receiptModal(rows.find((p) => p.id === b.dataset.rc))));
      $$('[data-refund]', main).forEach((b) => (b.onclick = () => ui.modal(`<h3>طلب استرداد</h3><p>يمكن استرداد رسوم الكورس التفاعلي خلال أسبوع من الدفع، وبعد الاسترداد بيتلغي تسجيلك في الكورس.</p><p class="bx-warnnote"><b>تنبيه:</b> تقدر تطلب الاسترداد مرة واحدة بس لكل عملية دفع، فاتأكد من قرارك قبل الإرسال.</p>
          <div class="bx-field"><label for="rr">السبب *</label><select id="rr" class="bx-select"><option value="">اختر السبب</option><option>المحتوى مش مناسب لمستوايا</option><option>المواعيد مش مناسبة ليا</option><option>اشتركت بالغلط</option><option>مشكلة تقنية في الحضور</option><option>سبب آخر</option></select></div>
          <div class="bx-field"><label for="rn">تفاصيل (اختياري)</label><textarea id="rn" class="bx-textarea" maxlength="1000"></textarea></div><div class="bx-formmsg" aria-live="polite"></div><div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-ok>إرسال الطلب</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`, (m, close) => {
        $('[data-x]', m).onclick = close;
        $('[data-ok]', m).onclick = async (ev) => { const t = $('.bx-formmsg', m), reason = $('#rr', m).value; if (!reason) { t.className = 'bx-formmsg err'; t.textContent = 'اختر سبب الاسترداد.'; return; } ev.target.disabled = true; try { await sb.rpc('request_refund', { p_payment: b.dataset.refund, p_note: $('#rn', m).value.trim() || null, p_reason: reason }); close(); ui.toast('وصل طلب الاسترداد وهنراجعه قريب، وهيوصلك إيميل بالقرار.'); D.reload(); } catch (e) { ev.target.disabled = false; t.className = 'bx-formmsg err'; t.textContent = /already requested/.test(e.message) ? 'طلبت الاسترداد قبل كده للعملية دي، والطلب بيتعمل مرة واحدة بس.' : /window/.test(e.message) ? 'انتهت مهلة الاسترداد (أسبوع من الدفع).' : arErr(e); } };
      })));
    },

    async certs(main) {
      const certs = await sb.get('certificates', { select: '*,courses(title)', order: 'issued_at.desc' });
      main.innerHTML = D.panel('شهاداتي', certs.length
        ? certs.map((c) => `<div class="bx-crow"><div class="bx-mine-code">${D.ic('cert')}</div><div><h4 class="bs-latin" style="direction:ltr;text-align:right">${esc(c.courses.title)}</h4><small>صدرت في ${D.date(c.issued_at)}</small></div><button class="bs-btn bs-btn-secondary bs-btn-sm" data-c="${c.id}">عرض الشهادة</button></div>`).join('')
        : '<div class="bx-empty-big"><b>لا توجد شهادات بعد</b>تظهر شهادة الإتمام هنا بعد إنهاء الدورة.</div>');
      $$('[data-c]', main).forEach((b) => (b.onclick = () => certModal(certs.find((c) => c.id === b.dataset.c), me.full_name || sb.user.email)));
    },

    async settings(main) {
      main.innerHTML = D.panel('بيانات الحساب', `<form class="bx-form2" id="pf" novalidate><div class="row2"><div class="bx-field"><label for="pn">الاسم الكامل</label><input id="pn" class="bx-input" value="${esc(me.full_name)}"></div><div class="bx-field"><label for="pe">البريد الإلكتروني</label><input id="pe" class="bx-input" dir="ltr" value="${esc(sb.user.email)}" disabled></div></div>
        <div class="row2"><div class="bx-field"><label for="pp">الهاتف</label><input id="pp" class="bx-input" dir="ltr" type="tel" value="${esc(me.phone || '')}"></div><div class="bx-field"><label for="pw">واتساب</label><input id="pw" class="bx-input" dir="ltr" type="tel" value="${esc(me.whatsapp || '')}"></div><div class="bx-field"><label for="pc">الدولة</label><input id="pc" class="bx-input" value="${esc(me.country || '')}"></div></div>
        <div class="bx-formmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button></div></form>`);
      const [devs, refs] = await Promise.all([sb.get('user_devices', { select: '*', user_id: 'eq.' + sb.user.id, order: 'last_seen.desc' }).catch(() => []), sb.rpc('my_referrals').catch(() => null)]);
      const myDev = window.deviceId && deviceId();
      main.insertAdjacentHTML('beforeend', D.panel('الأجهزة', `<p class="bx-hint" style="margin-top:0">يمكنك مشاهدة المحاضرات من جهازين كحد أقصى. لإضافة جهاز جديد أزل جهازًا قديمًا (مرة كل 7 أيام).</p>` +
        D.table(['الجهاز', 'آخر استخدام', ''], devs.map((d) => [esc(d.label || 'جهاز') + (d.device_id === myDev ? ' <span class="bs-badge bs-badge-new">هذا الجهاز</span>' : ''), D.dateTime(d.last_seen), `<button class="bx-linkbtn" data-rmdev="${esc(d.device_id)}">إزالة</button>`]), 'لم تشاهد من أي جهاز بعد')));
      if (refs && refs.code) {
        const link = new URL('index.html?ref=' + refs.code, location.href).href;
        main.insertAdjacentHTML('beforeend', D.panel('ادعُ صديقًا واحصل على شهر مجاني', `<p style="margin-top:0">شارك رابطك. عندما يشترك صديقك لأول مرة في أي باقة مدفوعة نضيف لك <b>شهرًا مجانيًا</b> تلقائيًا.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="bx-input" dir="ltr" readonly value="${esc(link)}" id="reflink" style="flex:1;min-width:220px"><button class="bs-btn bs-btn-secondary" id="refcopy" type="button">نسخ الرابط</button></div><p class="bx-hint">سجّل من رابطك: <b>${refs.signed_up}</b> · حصلت على: <b>${refs.rewarded}</b> شهر مجاني</p>`));
        $('#refcopy', main).onclick = async () => { try { await navigator.clipboard.writeText(link); ui.toast('تم نسخ رابط الدعوة.'); } catch { $('#reflink', main).select(); } };
      }
      $$('[data-rmdev]', main).forEach((b) => (b.onclick = async () => {
        if (!confirm('إزالة هذا الجهاز؟ يمكنك إزالة جهاز مرة واحدة كل 7 أيام.')) return;
        try { await sb.rpc('remove_my_device', { p_device: b.dataset.rmdev }); ui.toast('تمت إزالة الجهاز.'); D.reload(); } catch (err) { ui.toast(arErr(err), 'err'); }
      }));
      $('#pf', main).onsubmit = async (e) => {
        e.preventDefault(); const m = $('.bx-formmsg', main);
        try { const r = await sb.update('profiles', { id: 'eq.' + sb.user.id }, { full_name: $('#pn').value.trim(), phone: $('#pp').value.trim() || null, whatsapp: $('#pw').value.trim() || null, country: $('#pc').value.trim() || null }); me = r[0] || me; m.className = 'bx-formmsg ok'; m.textContent = 'تم الحفظ.'; }
        catch (err) { m.className = 'bx-formmsg err'; m.textContent = arErr(err); }
      };
    },
  };

  async function watchPayment(id) {
    const box = $('#paybanner'); if (!box || !id) return;
    box.innerHTML = '<div class="bx-banner bx-appmsg" role="status">استلمنا عودتك من صفحة الدفع، ننتظر تأكيد البوابة…</div>';
    for (let i = 0; i < 15; i++) {
      try { const p = await sb.one('payments', { select: 'status,amount_egp,fee_egp', id: 'eq.' + id }); if (p && p.status === 'paid') { window.track && track('purchase', { id, value: Number(p.amount_egp) + Number(p.fee_egp) }); ui.toast('تم تأكيد الدفع. اشتراكك فعّال الآن!'); history.replaceState(null, '', 'account.html'); D.reload(); return; } if (p && p.status === 'failed') { box.innerHTML = '<div class="bx-banner bx-appmsg" role="alert">فشلت عملية الدفع. لم يُخصم منك أي مبلغ.</div>'; return; } } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    box.innerHTML = '<div class="bx-banner bx-appmsg" role="status">ما زلنا في انتظار تأكيد البوابة. إذا خُصم المبلغ فسيتفعّل اشتراكك تلقائيًا خلال دقائق، وتجده في «الاشتراك والمدفوعات».</div>';
  }

  window.BiosynPages.account = async () => {
    me = await D.guard(['student', 'instructor', 'support', 'admin']); if (!me) return;
    await D.shell({
      title: 'حسابي', who: me.full_name || sb.user.email, sub: D.roleAr[me.role],
      items: [{ id: 'home', label: 'الرئيسية', icon: 'home' }, { id: 'payments', label: 'الاشتراك والمدفوعات', icon: 'card' }, { id: 'certs', label: 'الشهادات', icon: 'cert' }, { id: 'settings', label: 'الإعدادات', icon: 'cog' }],
      views, topLink: '<a href="courses.html" class="bs-btn bs-btn-secondary bs-btn-sm">تصفح الدورات</a>',
    });
  };
})();
