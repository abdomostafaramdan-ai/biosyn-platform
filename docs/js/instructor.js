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

    async live(main) { await window.courseAnalytics(main, { admin: false }); },
    async contracts(main) { await window.myContracts(main); },

    async messages(main) {
      main.innerHTML = D.panel('أسئلة الطلاب', `<p class="bx-hint" style="margin-top:0">يسألك الطلاب المشتركون هنا من صفحة الدورة. يصلك بريد إلكتروني مع كل سؤال جديد، ويصل الطالب بريد عند ردّك.</p><div data-ib></div>`);
      await Chat.inbox($('[data-ib]', main), { mode: 'instructor', kind: 'course', empty: 'لا توجد أسئلة بعد.' });
    },

    async promo(main) {
      const [rows, reqs] = await Promise.all([sb.rpc('my_promo_stats').then((r) => (Array.isArray(r) ? r : [])).catch(() => []), sb.rpc('my_promo_requests').then((r) => (Array.isArray(r) ? r : [])).catch(() => [])]);
      const share = (base) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}pricing?code=${encodeURIComponent(base)}`;
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('اشتراكات بكودك هذا الشهر', rows.reduce((s, r) => s + Number(r.uses_month || 0), 0), rows.reduce((s, r) => s + Number(r.uses_total || 0), 0) + ' إجمالي')}
          ${D.stat('أرباحك من الكود هذا الشهر', D.money(rows.reduce((s, r) => s + Number(r.earned_month || 0), 0)), 'تُضاف إلى رصيدك في بداية الشهر القادم')}
        </div>` + D.panel('كود الخصم الخاص بك', rows.length ? D.table(['الكود', 'خصم للطالب', 'نسبتك', 'الاستخدام', 'رابط المشاركة', 'الحالة'], rows.map((r) => [
          `<b class="bs-latin" style="font-size:18px">${esc(r.code)}</b>`, r.percent_off ? r.percent_off + '٪' : '—', Number(r.instructor_pct) + '٪ من قيمة الاشتراك',
          `${r.uses_month} هذا الشهر · ${r.uses_total} إجمالي`, `<button class="bx-linkbtn" data-copy="${esc(share(r.code))}">انسخ الرابط</button>`, r.active ? '<span class="bx-st bx-st-ok">يعمل</span>' : '<span class="bx-st bx-st-mute">متوقف</span>']))
          : '<div class="bx-empty-big"><b>لا يوجد لديك كود بعد</b>اطلب كودًا باسمك من النموذج أدناه وسيراجعه فريق Biosyn.</div>')
        + D.panel('اطلب كود خصم جديد', `<form class="bx-form2" id="prf" novalidate><div class="row2"><div class="bx-field"><label for="prc">الكود المطلوب</label><input id="prc" class="bx-input" dir="ltr" maxlength="30" placeholder="DRAHMED"></div><div class="bx-field"><label for="prn">ملاحظة للفريق (اختياري)</label><input id="prn" class="bx-input" maxlength="300"></div></div><p class="bx-hint" style="margin:0">حروف إنجليزية وأرقام فقط (من 3 إلى 30). الفريق هو من يحدد نسبة الخصم للطالب ونسبتك، وسيصلك إشعار بالقرار.</p><div class="bx-formmsg" id="prm" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">إرسال الطلب</button></div></form>`)
        + (reqs.length ? D.panel('طلباتي', D.table(['الكود', 'التاريخ', 'الحالة', 'ملاحظة الفريق'], reqs.map((q) => [`<b class="bs-latin">${esc(q.code)}</b>`, D.date(q.created_at), q.status === 'accepted' ? '<span class="bx-st bx-st-ok">تم الاعتماد</span>' : q.status === 'rejected' ? '<span class="bx-st bx-st-mute">مرفوض</span>' : '<span class="bx-st bx-st-info">قيد المراجعة</span>', esc(q.note || '—')]))) : '')
        + '<p class="bx-hint">أي طالب يشترك في باقة بكودك تحصل عنه على نسبتك (50٪ افتراضيًا) من قيمة الاشتراك بدلًا من نسبة الـ 30٪ المعتادة من المشاهدات، ويُضاف المبلغ إلى رصيدك مع الإقفال الشهري. انشر الكود أو الرابط لجمهورك.</p>';
      $$('[data-copy]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); ui.toast('تم نسخ الرابط.'); } catch { prompt('انسخ الرابط:', b.dataset.copy); } }));
      const pf = $('#prf', main);
      if (pf) pf.onsubmit = async (e) => {
        e.preventDefault(); const m = $('#prm', main), code = $('#prc', pf).value.trim().toUpperCase(), btn = $('button[type=submit]', pf);
        const say = (t, k) => { m.className = 'bx-formmsg' + (k ? ' ' + k : ''); m.textContent = t; };
        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return say('الكود: حروف إنجليزية وأرقام فقط (من 3 إلى 30).', 'err');
        btn.disabled = true;
        try { await sb.rpc('request_promo_code', { p_code: code, p_note: $('#prn', pf).value.trim() || null }); ui.toast('تم إرسال طلبك للفريق.'); views.promo(main); }
        catch (x) { btn.disabled = false; say(/code taken/.test(x.message) ? 'هذا الكود مستخدم أو مطلوب بالفعل، جرّب اسمًا آخر.' : /too many/.test(x.message) ? 'لديك 3 طلبات قيد المراجعة، انتظر القرار فيها أولًا.' : arErr(x), 'err'); }
      };
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
      items: [{ id: 'home', label: 'نظرة عامة', icon: 'home' }, { id: 'live', label: 'المشاهدات لايف', icon: 'chart' }, { id: 'messages', label: 'أسئلة الطلاب', icon: 'chat' }, { id: 'promo', label: 'كود الخصم الخاص بي', icon: 'tag' }, { id: 'courses', label: 'دوراتي', icon: 'book' }, { id: 'earnings', label: 'الأرباح والسحب', icon: 'coin' }, { id: 'contracts', label: 'اتفاقياتي', icon: 'list' }],
      views, topLink: '<a href="account.html" class="bs-btn bs-btn-secondary bs-btn-sm">حسابي</a>',
    });
    const pulse = () => Chat.unreadCounts().then((u) => D.setBadge('messages', (u && u.instructor) || 0));
    pulse(); setInterval(() => { if (!document.hidden) pulse(); }, 60000);
  };
})();
