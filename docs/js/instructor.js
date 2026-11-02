/* Instructor dashboard */
(() => {
  'use strict';
  const D = window.Dash;
  let me;

  const load = async () => {
    const courses = await sb.get('courses', { select: '*,lectures(id)', instructor_id: 'eq.' + sb.user.id, order: 'created_at.desc' });
    const ids = courses.map((c) => c.id);
    const [views, earnings, payouts, stats] = await Promise.all([
      ids.length ? sb.get('course_views', { select: 'month,course_id', course_id: 'in.(' + ids.join(',') + ')' }) : [],
      sb.get('earnings', { select: '*', instructor_id: 'eq.' + sb.user.id, order: 'month.desc' }),
      sb.get('payouts', { select: '*', instructor_id: 'eq.' + sb.user.id, order: 'requested_at.desc' }),
      sb.rpc('course_stats').then((r) => (Array.isArray(r) ? r : [])).catch(() => []),
    ]);
    const available = earnings.filter((e) => !e.payout_id).reduce((s, e) => s + Number(e.amount_egp), 0);
    const live = payouts.filter((p) => p.status !== 'rejected');
    const nextOK = live[0] ? D.addMonths(live[0].requested_at, 3) : null;
    return { stats, courses, views, earnings, payouts, available, nextOK, canWithdraw: available > 0 && (!nextOK || nextOK <= new Date()) };
  };

  function requestPayout(d) {
    ui.modal(`<h3>طلب سحب الأرباح</h3><p>المبلغ المتاح: <b>${D.money(d.available)}</b>. سيُحوَّل لك بعد مراجعة الإدارة.</p>
      <div class="bx-field"><label for="pm">وسيلة الاستلام وبياناتها</label><textarea id="pm" class="bx-textarea" placeholder="مثال: محفظة إلكترونية: رقم المحفظة، أو بنك: اسم البنك ورقم الحساب"></textarea></div>
      <div class="bx-formmsg" aria-live="polite"></div><div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-ok>إرسال الطلب</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = async (ev) => {
        const v = $('#pm', m).value.trim(), t = $('.bx-formmsg', m);
        if (v.length < 6) { t.className = 'bx-formmsg err'; t.textContent = 'اكتب بيانات استلام الأرباح.'; return; }
        ev.currentTarget.disabled = true;
        try { await sb.rpc('request_payout', { p_method: v }); close(); ui.toast('وصل طلب السحب وسيُراجع قريبًا.'); D.reload(); }
        catch (e) { ev.currentTarget.disabled = false; t.className = 'bx-formmsg err'; t.textContent = /next withdrawal/.test(e.message) ? 'السحب متاح مرة كل 3 أشهر. ' + e.message.replace('next withdrawal available on', 'موعد السحب القادم:') : /no available/.test(e.message) ? 'لا يوجد رصيد متاح للسحب.' : arErr(e); }
      };
    });
  }

  const views = {
    async home(main) {
      const d = await load();
      const now = new Date(), months = [];
      for (let i = 5; i >= 0; i--) { const m = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString('ar-EG-u-nu-latn', { month: 'short' }), n: 0 }); }
      d.views.forEach((v) => { const m = months.find((x) => x.key === String(v.month).slice(0, 7)); if (m) m.n++; });
      const max = Math.max(1, ...months.map((m) => m.n));
      const thisMonth = months[months.length - 1].n;
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('الرصيد المتراكم', D.money(d.available), d.canWithdraw ? 'متاح للسحب الآن' : d.nextOK && d.available > 0 ? 'السحب متاح في ' + D.date(d.nextOK) : 'يُضاف شهريًا')}
          ${D.stat('مشاهدات هذا الشهر', thisMonth, `<span class="bx-live"><i></i>${d.stats.reduce((s, r) => s + Number(r.watching_now || 0), 0)}</span> بيتفرجوا دلوقتي · <a class="bx-link" href="#live">التفاصيل لايف</a>`)}
          ${D.stat('كورساتي', d.courses.length, d.courses.filter((c) => c.status === 'published').length + ' منشور')}
          ${D.stat('أرباح آخر شهر مُقفل', d.earnings[0] ? D.money(d.earnings[0].amount_egp) : '—', d.earnings[0] ? D.month(d.earnings[0].month) : 'تُحتسب أول كل شهر')}
        </div>
        <div class="bx-dgrid2">
          <section class="bx-balance" aria-labelledby="bal"><span class="bx-eyebrow" style="color:#c6f84a">رصيد متراكم</span><h3 id="bal">المستحقات</h3><b class="bx-balance-n">${EGP(d.available)} <small>ج.م</small></b>
            <p style="margin:0;font:400 13px/20px var(--font-sans)">تُضاف الأرباح إلى رصيدك شهريًا، ويمكنك طلب السحب كل 3 أشهر.${d.nextOK && !d.canWithdraw && d.available > 0 ? ' موعد السحب القادم: ' + D.date(d.nextOK) + '.' : ''}</p>
            <button class="bs-btn bs-btn-primary bs-btn-lg" id="wd" ${d.canWithdraw ? '' : 'disabled'}>اطلب سحب المستحقات</button></section>
          <section class="bx-panel"><div class="bx-panel-head"><div><span class="bx-eyebrow">آخر 6 أشهر</span><h3>مشاهدات كورساتي</h3></div></div>
            <div class="bx-bars" role="img" aria-label="رسم أعمدة لمشاهدات آخر ستة أشهر">${months.map((m) => `<div class="bx-barcol"><div class="bx-barpair"><i style="height:${Math.max(3, Math.round((m.n / max) * 100))}%"></i></div><span>${m.label} · ${m.n}</span></div>`).join('')}</div></section>
        </div>
        <p class="bx-hint">أرباح الكورسات المسجلة تُحتسب بنسبة 30٪ للمحاضر من قيمة المشاهدات. الكورسات التفاعلية لها اتفاقات مستقلة.</p>`;
      const w = $('#wd', main); if (w) w.onclick = () => requestPayout(d);
    },

    async live(main) { await window.courseAnalytics(main, { admin: false }); },

    async courses(main) {
      const d = await load();
      main.innerHTML = D.panel('كورساتي', D.table(['الكورس', 'النوع', 'المحاضرات', 'الحالة'], d.courses.map((c) => [`<b class="bs-latin">${esc(c.title)}</b>`, c.kind === 'interactive' ? 'تفاعلي' : 'مسجل', (c.lectures || []).length, D.badge('course', c.status)]), 'لم تُسنَد إليك كورسات بعد'))
        + '<p class="bx-hint">لإضافة كورس جديد أو تعديل محتوى كورس، تواصل مع فريق Biosyn أو <a class="bx-link" href="teach.html">قدّم طلب كورس جديد</a>.</p>';
    },

    async earnings(main) {
      const d = await load();
      main.innerHTML = D.panel('الأرباح الشهرية', D.table(['الشهر', 'مشاهداتك', 'الأرباح', 'الحالة'], d.earnings.map((e) => [D.month(e.month), e.instructor_views, D.money(e.amount_egp), e.payout_id ? '<span class="bx-st bx-st-ok">ضمن طلب سحب</span>' : '<span class="bx-st bx-st-info">رصيد متاح</span>']), 'لم يُقفل أي شهر بعد. تُحتسب الأرباح أول كل شهر.'))
        + D.panel('طلبات السحب', D.table(['التاريخ', 'المبلغ', 'الوسيلة', 'الحالة'], d.payouts.map((p) => [D.date(p.requested_at), D.money(p.amount_egp), `<span style="white-space:pre-wrap">${esc(p.method)}</span>`, D.badge('payout', p.status)]), 'لا توجد طلبات سحب'));
    },
  };

  window.BiosynPages.instructor = async () => {
    me = await D.guard(['instructor', 'admin']); if (!me) return;
    await D.shell({
      title: 'لوحة المحاضر', who: me.full_name || sb.user.email, sub: D.roleAr[me.role],
      items: [{ id: 'home', label: 'نظرة عامة', icon: 'home' }, { id: 'live', label: 'المشاهدات لايف', icon: 'chart' }, { id: 'courses', label: 'كورساتي', icon: 'book' }, { id: 'earnings', label: 'الأرباح والسحب', icon: 'coin' }],
      views, topLink: '<a href="account.html" class="bs-btn bs-btn-secondary bs-btn-sm">حسابي</a>',
    });
  };
})();
