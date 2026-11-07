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
          ${D.stat('مشاهدات هذا الشهر', thisMonth, `<span class="bx-live"><i></i>${d.stats.reduce((s, r) => s + Number(r.watching_now || 0), 0)}</span> يشاهدون الآن · <a class="bx-link" href="#live">التفاصيل لايف</a>`)}
          ${D.stat('دوراتي', d.courses.length, d.courses.filter((c) => c.status === 'published').length + ' منشور')}
          ${D.stat('أرباح آخر شهر مُقفل', d.earnings[0] ? D.money(d.earnings[0].amount_egp) : '—', d.earnings[0] ? D.month(d.earnings[0].month) : 'تُحتسب أول كل شهر')}
        </div>
        <div class="bx-dgrid2">
          <section class="bx-balance" aria-labelledby="bal"><span class="bx-eyebrow" style="color:#c6f84a">رصيد متراكم</span><h3 id="bal">المستحقات</h3><b class="bx-balance-n">${EGP(d.available)} <small>ج.م</small></b>
            <p style="margin:0;font:400 13px/20px var(--font-sans)">تُضاف الأرباح إلى رصيدك شهريًا، ويمكنك طلب السحب كل 3 أشهر.${d.nextOK && !d.canWithdraw && d.available > 0 ? ' موعد السحب القادم: ' + D.date(d.nextOK) + '.' : ''}</p>
            <button class="bs-btn bs-btn-primary bs-btn-lg" id="wd" ${d.canWithdraw ? '' : 'disabled'}>اطلب سحب المستحقات</button></section>
          <section class="bx-panel"><div class="bx-panel-head"><div><span class="bx-eyebrow">آخر 6 أشهر</span><h3>مشاهدات دوراتي</h3></div></div>
            <div class="bx-bars" role="img" aria-label="رسم أعمدة لمشاهدات آخر ستة أشهر">${months.map((m) => `<div class="bx-barcol"><div class="bx-barpair"><i style="height:${Math.max(3, Math.round((m.n / max) * 100))}%"></i></div><span>${m.label} · ${m.n}</span></div>`).join('')}</div></section>
        </div>
        <p class="bx-hint">أرباح الدورات المسجلة تُحتسب بنسبة 30٪ للمحاضر من قيمة المشاهدات. الدورات التفاعلية لها اتفاقات مستقلة. <a class="bx-link" href="#calc">احسب أرباحك المتوقعة</a></p>`;
      const w = $('#wd', main); if (w) w.onclick = () => requestPayout(d);
    },

    // earnings calculator with the instructor's real numbers (instructor_calc RPC) + what-if simulator
    async calc(main) {
      const c = await sb.rpc('instructor_calc');
      const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
      const pct = Number(c.pct) || 30;
      const closed = (c.history || []).find((h) => Number(h.rate) > 0);
      const rate0 = closed ? Number(closed.rate) : c.rate != null && Number(c.rate) > 0 ? Number(c.rate) : 2;
      const rateSrc = closed ? `قيمة المشاهدة الفعلية لشهر ${D.month(closed.month)}` : c.rate != null && Number(c.rate) > 0 ? 'قيمة المشاهدة حتى الآن هذا الشهر' : 'قيمة افتراضية للتجربة، وتتحدّث تلقائيًا بعد أول إقفال شهري';
      const pace = c.day > 0 ? Math.round((Number(c.my_views) / c.day) * c.days) : 0;
      const views0 = pace || Number((c.history[0] || {}).my_views) || 100;
      const promo = (c.promo || [])[0]; const ppct = promo ? Number(promo.pct) || 50 : 50;
      const plans = c.plans || []; const plan0 = plans[0] || { name: 'اشتراك شهري', price: 200 };
      const plan0Price = (p) => Math.round(Number(p.price) * (1 - (promo ? Number(promo.percent_off) || 0 : 0) / 100));
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('مشاهداتك المعتمدة هذا الشهر', fmt(c.my_views), `حتى اليوم ${c.day} من ${c.days}`)}
          ${D.stat('المتوقع بنهاية الشهر', fmt(pace), 'بنفس معدل المشاهدة الحالي')}
          ${D.stat('قيمة المشاهدة المستخدمة', fmt(rate0, 2) + ' ج.م', esc(rateSrc))}
          ${D.stat('الأرباح المتوقعة هذا الشهر', D.money(pace * rate0 * pct / 100), `${fmt(pace)} × ${fmt(rate0, 2)} × ${pct}٪`)}
        </div>
        <section class="bx-calc" aria-labelledby="calc-h">
          <div class="bx-calc-head"><div><span class="bx-calc-tag">${D.ic('calc')}حاسبة الأرباح</span>
            <h2 id="calc-h">احسب أرباحك المتوقعة</h2>
            <p>الأرقام معبّأة من بياناتك الفعلية، ويمكنك تغييرها لترى أثر كل رقم على أرباحك.</p></div>
            <span class="bx-calc-live">تقدير لشهر واحد</span></div>
          <div class="bx-calc-inputs">
            <div class="bx-field"><label for="k-v">مشاهدات دوراتك المعتمدة في الشهر</label><input id="k-v" class="bx-input bx-num" type="number" min="0" inputmode="numeric" value="${views0}"><span class="bx-hint">طالب واحد = مشاهدة واحدة للدورة في الشهر</span></div>
            <div class="bx-field"><label for="k-r">قيمة المشاهدة الواحدة (ج.م)</label><input id="k-r" class="bx-input bx-num" type="number" min="0" step="0.01" inputmode="decimal" value="${rate0.toFixed(2)}"><span class="bx-hint">دخل الاشتراكات ÷ إجمالي المشاهدات المعتمدة على المنصة</span></div>
            <div class="bx-field"><label for="k-p">اشتراكات بكود الخصم الخاص بك في الشهر</label><input id="k-p" class="bx-input bx-num" type="number" min="0" inputmode="numeric" value="0"><span class="bx-hint">${promo ? `كودك <b class="bs-latin">${esc(promo.code)}</b>: نسبتك ${ppct}٪ من المبلغ المدفوع` : `نسبتك ${ppct}٪ من المبلغ المدفوع. اطلب كودك من فريق Biosyn`}</span></div>
            <div class="bx-field"><label for="k-pl">الباقة التي يشترك فيها الطلاب بكودك</label><select id="k-pl" class="bx-select">${plans.map((p, i) => `<option value="${plan0Price(p)}" ${i === 0 ? 'selected' : ''}>${esc(p.name)} · ${fmt(plan0Price(p))} ج.م</option>`).join('') || `<option value="${plan0Price(plan0)}">${esc(plan0.name)}</option>`}</select><span class="bx-hint">${promo && Number(promo.percent_off) ? `السعر بعد خصم كودك ${promo.percent_off}٪` : 'سعر الباقة المدفوع'}</span></div>
            <div class="bx-field"><label for="k-g">هدفك الشهري من الأرباح (ج.م)</label><input id="k-g" class="bx-input bx-num" type="number" min="0" inputmode="numeric" value="5000"><span class="bx-hint">نحسب لك عدد المشاهدات التي تحتاجها</span></div>
          </div>
          <div class="bx-calc-out" role="status" aria-live="polite">
            <div class="bx-calc-tile"><span>أرباح المشاهدات (${pct}٪)</span><b data-o="v">0</b><small data-s="v"></small></div>
            <div class="bx-calc-tile"><span>أرباح كود الخصم (${ppct}٪)</span><b data-o="p">0</b><small data-s="p"></small></div>
            <div class="bx-calc-tile bx-calc-win"><span>إجمالي أرباحك في الشهر</span><b data-o="t">0</b><small data-s="t">يُضاف إلى رصيدك مع الإقفال الشهري</small></div>
            <div class="bx-calc-tile bx-calc-plat"><span>رصيدك عند موعد السحب (3 أشهر)</span><b data-o="q">0</b><small>بافتراض ثبات الأرقام لثلاثة أشهر</small></div>
          </div>
          <div class="bx-calc-note">${D.ic('chart')}<div><b data-goal></b><p>المشاهدة المعتمدة: طالب مشترك شاهد 50٪ على الأقل من محاضرة، وتُحتسب مرة واحدة لكل طالب في الدورة كل شهر. قيمة المشاهدة تتغير كل شهر حسب دخل الاشتراكات وعدد المشاهدات على المنصة، فالنتيجة تقديرية وليست وعدًا بدخل.</p></div></div>
        </section>`
        + D.panel('مشاهدات دوراتك هذا الشهر', D.table(['الدورة', 'المشاهدات المعتمدة', 'القيمة التقديرية لنصيبك'], (c.courses || []).map((x) => [`<b class="bs-latin">${esc(x.title)}</b>`, fmt(x.views), D.money(x.views * rate0 * pct / 100)]), 'لا توجد لديك دورات مسجلة بعد'))
        + D.panel('قيمة المشاهدة وأرباحك في الأشهر السابقة', D.table(['الشهر', 'قيمة المشاهدة', 'مشاهداتك', 'أرباحك', 'منها من كودك'], (c.history || []).map((h) => [D.month(h.month), Number(h.rate) ? fmt(h.rate, 2) + ' ج.م' : '—', fmt(h.my_views), D.money(h.amount), Number(h.promo) ? D.money(h.promo) : '—']), 'لم يُقفل أي شهر بعد. تُحتسب الأرباح أول كل شهر.'))
        + '<p class="bx-hint">لديك أسئلة عن طريقة الحساب؟ اقرأ <a class="bx-link" href="teach.html#earnings">الأسئلة الشائعة عن الأرباح</a>.</p>';
      const v = $('#k-v', main), r = $('#k-r', main), p = $('#k-p', main), pl = $('#k-pl', main), g = $('#k-g', main);
      const out = (k, n) => ($(`[data-o="${k}"]`, main).innerHTML = `${fmt(n, 2)} <small>ج.م</small>`);
      const sub = (k, t) => ($(`[data-s="${k}"]`, main).textContent = t);
      const draw = () => {
        const V = Math.max(0, +v.value || 0), R = Math.max(0, +r.value || 0), P = Math.max(0, +p.value || 0), PR = +pl.value || 0, G = Math.max(0, +g.value || 0);
        const ev = V * R * pct / 100, ep = P * PR * ppct / 100, t = ev + ep;
        out('v', ev); sub('v', `${fmt(V)} مشاهدة × ${fmt(R, 2)} ج.م × ${pct}٪`);
        out('p', ep); sub('p', `${fmt(P)} اشتراك × ${fmt(PR)} ج.م × ${ppct}٪`);
        out('t', t); out('q', t * 3);
        const per = R * pct / 100, need = per > 0 ? Math.ceil(Math.max(0, G - ep) / per) : 0;
        $('[data-goal]', main).textContent = G > 0 ? (per > 0 ? (ep >= G ? 'تحقق هدفك من اشتراكات كودك وحدها.' : `لتحقيق ${fmt(G)} ج.م في الشهر تحتاج نحو ${fmt(need)} مشاهدة معتمدة لدوراتك${P ? ` إلى جانب ${fmt(P)} اشتراك بكودك` : ''}.`) : 'أدخل قيمة المشاهدة لحساب المشاهدات المطلوبة لهدفك.') : 'كيف تُحتسب أرباحك؟';
      };
      [v, r, p, pl, g].forEach((e) => e.addEventListener('input', draw)); draw();
    },

    async live(main) { await window.courseAnalytics(main, { admin: false }); },
    async contracts(main) { await window.myContracts(main); },

    async messages(main) {
      main.innerHTML = D.panel('أسئلة الطلاب', `<p class="bx-hint" style="margin-top:0">يسألك الطلاب المشتركون هنا من صفحة الدورة. يصلك بريد إلكتروني مع كل سؤال جديد، ويصل الطالب بريد عند ردّك.</p><div data-ib></div>`);
      await Chat.inbox($('[data-ib]', main), { mode: 'instructor', kind: 'course', empty: 'لا توجد أسئلة بعد.' });
    },

    async promo(main) {
      const rows = await sb.rpc('my_promo_stats').then((r) => (Array.isArray(r) ? r : [])).catch(() => []);
      const share = (base) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}pricing.html?code=${encodeURIComponent(base)}`;
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('اشتراكات بكودك هذا الشهر', rows.reduce((s, r) => s + Number(r.uses_month || 0), 0), rows.reduce((s, r) => s + Number(r.uses_total || 0), 0) + ' إجمالي')}
          ${D.stat('أرباحك من الكود هذا الشهر', D.money(rows.reduce((s, r) => s + Number(r.earned_month || 0), 0)), 'تُضاف إلى رصيدك في بداية الشهر القادم')}
        </div>` + D.panel('كود الخصم الخاص بك', rows.length ? D.table(['الكود', 'خصم للطالب', 'نسبتك', 'الاستخدام', 'رابط المشاركة', 'الحالة'], rows.map((r) => [
          `<b class="bs-latin" style="font-size:18px">${esc(r.code)}</b>`, r.percent_off ? r.percent_off + '٪' : '—', Number(r.instructor_pct) + '٪ من قيمة الاشتراك',
          `${r.uses_month} هذا الشهر · ${r.uses_total} إجمالي`, `<button class="bx-linkbtn" data-copy="${esc(share(r.code))}">انسخ الرابط</button>`, r.active ? '<span class="bx-st bx-st-ok">يعمل</span>' : '<span class="bx-st bx-st-mute">متوقف</span>']))
          : '<div class="bx-empty-big"><b>لا يوجد لديك كود بعد</b>اطلب من فريق Biosyn يعملّك كود خصم باسمك.</div>')
        + '<p class="bx-hint">أي طالب يشترك في باقة بكودك تحصل عنه على نسبتك (50٪ افتراضيًا) من قيمة الاشتراك بدلًا من نسبة الـ 30٪ المعتادة من المشاهدات، ويُضاف المبلغ إلى رصيدك مع الإقفال الشهري. انشر الكود أو الرابط لجمهورك.</p>';
      $$('[data-copy]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); ui.toast('تم نسخ الرابط.'); } catch { prompt('انسخ الرابط:', b.dataset.copy); } }));
    },

    async courses(main) {
      const d = await load();
      main.innerHTML = D.panel('دوراتي', D.table(['الدورة', 'النوع', 'المحاضرات', 'الحالة'], d.courses.map((c) => [`<b class="bs-latin">${esc(c.title)}</b>`, c.kind === 'interactive' ? 'تفاعلي' : 'مسجل', (c.lectures || []).length, D.badge('course', c.status)]), 'لم تُسنَد إليك دورات بعد'))
        + '<p class="bx-hint">لإضافة دورة جديدة أو تعديل محتوى دورة، تواصل مع فريق Biosyn أو <a class="bx-link" href="teach.html">قدّم طلب دورة جديدة</a>.</p>';
    },

    async earnings(main) {
      const d = await load();
      main.innerHTML = D.panel('الأرباح الشهرية', D.table(['الشهر', 'مشاهداتك', 'الأرباح', 'منها من كودك', 'الحالة'], d.earnings.map((e) => [D.month(e.month), e.instructor_views, D.money(e.amount_egp), Number(e.promo_egp) ? `${D.money(e.promo_egp)} <small class="bx-hint">(${e.promo_count} اشتراك)</small>` : '—', e.payout_id ? '<span class="bx-st bx-st-ok">ضمن طلب سحب</span>' : '<span class="bx-st bx-st-info">رصيد متاح</span>']), 'لم يُقفل أي شهر بعد. تُحتسب الأرباح أول كل شهر.'))
        + D.panel('طلبات السحب', D.table(['التاريخ', 'المبلغ', 'الوسيلة', 'الحالة'], d.payouts.map((p) => [D.date(p.requested_at), D.money(p.amount_egp), `<span style="white-space:pre-wrap">${esc(p.method)}</span>`, D.badge('payout', p.status)]), 'لا توجد طلبات سحب'));
    },
  };

  window.BiosynPages.instructor = async () => {
    me = await D.guard(['instructor', 'admin']); if (!me) return;
    await D.shell({
      title: 'لوحة المحاضر', who: me.full_name || sb.user.email, sub: D.roleAr[me.role],
      items: [{ id: 'home', label: 'نظرة عامة', icon: 'home' }, { id: 'live', label: 'المشاهدات لايف', icon: 'chart' }, { id: 'messages', label: 'أسئلة الطلاب', icon: 'chat' }, { id: 'calc', label: 'حاسبة الأرباح', icon: 'calc' }, { id: 'promo', label: 'كود الخصم الخاص بي', icon: 'tag' }, { id: 'courses', label: 'دوراتي', icon: 'book' }, { id: 'earnings', label: 'الأرباح والسحب', icon: 'coin' }, { id: 'contracts', label: 'اتفاقياتي', icon: 'list' }],
      views, topLink: '<a href="account.html" class="bs-btn bs-btn-secondary bs-btn-sm">حسابي</a>',
    });
    const pulse = () => Chat.unreadCounts().then((u) => D.setBadge('messages', (u && u.instructor) || 0));
    pulse(); setInterval(() => { if (!document.hidden) pulse(); }, 60000);
  };
})();
