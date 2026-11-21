/* Instructor dashboard */
(() => {
  'use strict';
  const D = window.Dash;
  // uid = the instructor whose data is shown. Staff can open any instructor's dashboard read-only with ?as=<profile id>.
  let me, uid, viewing = null;
  const RO = 'لوحة المحاضر معروضة للإدارة للقراءة فقط.';

  const load = async () => {
    const courses = await sb.get('courses', { select: '*,lectures(id)', instructor_id: 'eq.' + uid, order: 'created_at.desc' });
    const ids = courses.map((c) => c.id);
    const [summary, earnings, payouts, stats] = await Promise.all([
      sb.rpc('instructor_watch_summary', viewing ? { p_user: uid } : {}).catch(() => null),
      sb.get('earnings', { select: '*', instructor_id: 'eq.' + uid, order: 'month.desc' }),
      sb.get('payouts', { select: '*', instructor_id: 'eq.' + uid, order: 'requested_at.desc' }),
      sb.rpc('course_stats').then((r) => (Array.isArray(r) ? r : []).filter((x) => x.instructor_id === uid)).catch(() => []),
    ]);
    const available = earnings.filter((e) => !e.payout_id).reduce((s, e) => s + Number(e.amount_egp), 0);
    const live = payouts.filter((p) => p.status !== 'rejected');
    const nextOK = live[0] ? D.addMonths(live[0].requested_at, 3) : null;
    return { stats, courses, summary, earnings, payouts, available, nextOK, canWithdraw: available > 0 && (!nextOK || nextOK <= new Date()) };
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
      const fmt = (x) => Math.round(Number(x || 0)).toLocaleString('en');
      const s = d.summary || { my_minutes: 0, share_pct: null, learners: 0, months: [] };
      const months = (s.months || []).map((m) => ({ label: new Date(String(m.month).slice(0, 10) + 'T00:00:00').toLocaleDateString('ar-EG-u-nu-latn', { month: 'short' }), n: Number(m.minutes || 0), l: Number(m.learners || 0) }));
      const max = Math.max(1, ...months.map((m) => m.n));
      const rec = d.stats.filter((r) => r.kind === 'recorded');
      const myMin = rec.reduce((a, r) => a + Number(r.watch_minutes_month || 0), 0);
      const est = rec.reduce((a, r) => a + Number(r.est_earnings_month || 0), 0);
      const liveNow = d.stats.reduce((a, r) => a + Number(r.watching_now || 0), 0);
      const top = rec.slice().sort((x, y) => Number(y.watch_minutes_month || 0) - Number(x.watch_minutes_month || 0));
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('الرصيد المتراكم', D.money(d.available), d.canWithdraw ? 'متاح للسحب الآن' : d.nextOK && d.available > 0 ? 'السحب متاح في ' + D.date(d.nextOK) : 'يُضاف شهريًا')}
          ${D.stat('دقائق المشاهدة هذا الشهر', fmt(s.my_minutes), `${fmt(s.learners)} طالب · <span class="bx-live"><i></i>${liveNow}</span> يشاهدون الآن`)}
          ${D.stat('الأرباح المتوقعة هذا الشهر', D.money(est), s.share_pct != null ? `نصيبك ${s.share_pct}٪ من دقائق المشاهدة على المنصة` : 'تظهر مع أول دقائق مشاهدة')}
          ${D.stat('أرباح آخر شهر مُقفل', d.earnings[0] ? D.money(d.earnings[0].amount_egp) : '—', d.earnings[0] ? D.month(d.earnings[0].month) : 'تُحتسب أول كل شهر')}
        </div>
        <div class="bx-dgrid2">
          <section class="bx-balance" aria-labelledby="bal"><span class="bx-eyebrow" style="color:#c6f84a">رصيد متراكم</span><h3 id="bal">المستحقات</h3><b class="bx-balance-n">${EGP(d.available)} <small>ج.م</small></b>
            <p style="margin:0;font:400 13px/20px var(--font-sans)">تُضاف الأرباح إلى رصيدك شهريًا، ويمكنك طلب السحب كل 3 أشهر.${d.nextOK && !d.canWithdraw && d.available > 0 ? ' موعد السحب القادم: ' + D.date(d.nextOK) + '.' : ''}</p>
            ${viewing ? `<p class="bx-hint" style="margin:0">${RO}</p>` : `<button class="bs-btn bs-btn-primary bs-btn-lg" id="wd" ${d.canWithdraw ? '' : 'disabled'}>اطلب سحب المستحقات</button>`}</section>
          <section class="bx-panel"><div class="bx-panel-head"><div><span class="bx-eyebrow">آخر 6 أشهر</span><h3>دقائق المشاهدة على دوراتي</h3></div></div>
            <div class="bx-bars" role="img" aria-label="رسم أعمدة لدقائق المشاهدة في آخر ستة أشهر">${months.map((m) => `<div class="bx-barcol" title="${fmt(m.n)} دقيقة · ${m.l} طالب"><div class="bx-barpair"><i style="height:${Math.max(3, Math.round((m.n / max) * 100))}%"></i></div><span>${m.label} · ${fmt(m.n)}</span></div>`).join('')}</div></section>
        </div>
        ${D.panel('دوراتي هذا الشهر', D.table(['الدورة', 'دقائق المشاهدة', 'من دقائقك', 'الربح المتوقع'], top.map((r) => [
          `<b class="bs-latin">${esc(r.title)}</b>`,
          `${fmt(r.watch_minutes_month)} <small class="bx-hint">دقيقة</small>`,
          myMin > 0 ? `${Math.round((Number(r.watch_minutes_month || 0) / myMin) * 100)}٪` : '—',
          D.money(r.est_earnings_month)]), 'لا توجد دورات مسجلة بعد'))}
        <p class="bx-hint">أرباح الدورات المسجلة = 30٪ من دخل الاشتراكات × نصيب دوراتك من دقائق المشاهدة على المنصة. تُحتسب كل دقيقة مرة واحدة لكل طالب، ولا تُحتسب المحاضرة الأولى المجانية. الربح المتوقع يتغير حتى إقفال الشهر في بدايته التالية، والدورات التفاعلية لها اتفاقات مستقلة. <a class="bx-link" href="#live">التفاصيل لايف</a></p>`;
      const w = $('#wd', main); if (w) w.onclick = () => requestPayout(d);
    },

    async live(main) { await window.courseAnalytics(main, { admin: false, instructorId: viewing ? uid : null }); },
    async contracts(main) { await window.myContracts(main, uid); },

    async messages(main) {
      main.innerHTML = D.panel('أسئلة الطلاب', `<p class="bx-hint" style="margin-top:0">يسألك الطلاب المشتركون هنا من صفحة الدورة. يصلك بريد إلكتروني مع كل سؤال جديد، ويصل الطالب بريد عند ردّك.</p><div data-ib></div>`);
      await Chat.inbox($('[data-ib]', main), { mode: 'instructor', kind: 'course', instructorId: uid, empty: 'لا توجد أسئلة بعد.' });
    },

    async promo(main) {
      const [rows, reqs] = await Promise.all([sb.rpc('my_promo_stats', viewing ? { p_user: uid } : {}).then((r) => (Array.isArray(r) ? r : [])).catch(() => []), sb.rpc('my_promo_requests', viewing ? { p_user: uid } : {}).then((r) => (Array.isArray(r) ? r : [])).catch(() => [])]);
      const share = (base) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}pricing?code=${encodeURIComponent(base)}`;
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('اشتراكات بكودك هذا الشهر', rows.reduce((s, r) => s + Number(r.uses_month || 0), 0), rows.reduce((s, r) => s + Number(r.uses_total || 0), 0) + ' إجمالي')}
          ${D.stat('أرباحك من مشاهدات طلاب كودك هذا الشهر', D.money(rows.reduce((s, r) => s + Number(r.earned_month || 0), 0)), 'تُضاف إلى رصيدك في بداية الشهر القادم')}
        </div>` + D.panel('كود الخصم الخاص بك', rows.length ? D.table(['الكود', 'خصم للطالب', 'نسبتك', 'الاستخدام', 'رابط المشاركة', 'الحالة'], rows.map((r) => [
          `<b class="bs-latin" style="font-size:18px">${esc(r.code)}</b>`, r.percent_off ? r.percent_off + '٪' : '—', Number(r.instructor_pct) + '٪ من قيمة دقائق المشاهدة (بدل 30٪)',
          `${r.uses_month} هذا الشهر · ${r.uses_total} إجمالي`, `<button class="bx-linkbtn" data-copy="${esc(share(r.code))}">انسخ الرابط</button>`, r.active ? '<span class="bx-st bx-st-ok">يعمل</span>' : '<span class="bx-st bx-st-mute">متوقف</span>']))
          : '<div class="bx-empty-big"><b>لا يوجد لديك كود بعد</b>اطلب كودًا باسمك من النموذج أدناه وسيراجعه فريق Biosyn.</div>')
        + (viewing ? '' : D.panel('اطلب كود خصم جديد', `<form class="bx-form2" id="prf" novalidate><div class="row2"><div class="bx-field"><label for="prc">الكود المطلوب</label><input id="prc" class="bx-input" dir="ltr" maxlength="30" placeholder="DRAHMED"></div><div class="bx-field"><label for="prn">ملاحظة للفريق (اختياري)</label><input id="prn" class="bx-input" maxlength="300"></div></div><p class="bx-hint" style="margin:0">حروف إنجليزية وأرقام فقط (من 3 إلى 30). الفريق هو من يحدد نسبة الخصم للطالب ونسبتك، وسيصلك إشعار بالقرار.</p><div class="bx-formmsg" id="prm" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">إرسال الطلب</button></div></form>`))
        + (reqs.length ? D.panel('طلباتي', D.table(['الكود', 'التاريخ', 'الحالة', 'ملاحظة الفريق'], reqs.map((q) => [`<b class="bs-latin">${esc(q.code)}</b>`, D.date(q.created_at), q.status === 'accepted' ? '<span class="bx-st bx-st-ok">تم الاعتماد</span>' : q.status === 'rejected' ? '<span class="bx-st bx-st-mute">مرفوض</span>' : '<span class="bx-st bx-st-info">قيد المراجعة</span>', esc(q.note || '—')]))) : '')
        + '<p class="bx-hint">في الوضع العادي تحصل على 30٪ من قيمة دقائق المشاهدة على دوراتك. أما دقائق مشاهدة الطلاب الذين اشتركوا في باقة بكودك فتحصل عليها بنسبة 50٪ (افتراضيًا) بدلًا من الـ 30٪ طوال مدة اشتراكهم، ويُضاف المبلغ إلى رصيدك مع الإقفال الشهري. انشر الكود أو الرابط لجمهورك.</p>';
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
      main.innerHTML = D.panel('الأرباح الشهرية', D.table(['الشهر', 'دقائق المشاهدة', 'الأرباح', 'منها من كودك', 'الحالة'], d.earnings.map((e) => [D.month(e.month), e.watch_seconds != null ? Math.round(Number(e.watch_seconds) / 60).toLocaleString('en') + ' دقيقة' : e.instructor_views + ' مشاهدة', D.money(e.amount_egp), Number(e.promo_egp) ? `${D.money(e.promo_egp)} <small class="bx-hint">(${e.promo_count} طالب من كودك)</small>` : '—', e.payout_id ? '<span class="bx-st bx-st-ok">ضمن طلب سحب</span>' : '<span class="bx-st bx-st-info">رصيد متاح</span>']), 'لم يُقفل أي شهر بعد. تُحتسب الأرباح أول كل شهر.'))
        + D.panel('طلبات السحب', D.table(['التاريخ', 'المبلغ', 'الوسيلة', 'الحالة'], d.payouts.map((p) => [D.date(p.requested_at), D.money(p.amount_egp), `<span style="white-space:pre-wrap">${esc(p.method)}</span>`, D.badge('payout', p.status)]), 'لا توجد طلبات سحب'));
    },
  };

  window.BiosynPages.instructor = async () => {
    me = await D.guard(['instructor', 'admin', 'support']); if (!me) return;
    uid = sb.user.id;
    const as = new URLSearchParams(location.search).get('as');
    if (as && /^[0-9a-f-]{36}$/i.test(as) && (me.role === 'admin' || me.role === 'support') && as !== sb.user.id) {
      const list = await sb.rpc('admin_users').catch(() => []);
      viewing = (Array.isArray(list) ? list : []).find((u) => u.id === as) || null;
      if (!viewing) { D.denied('لم نجد حساب المحاضر المطلوب.'); return; }
      uid = viewing.id;
    } else if (me.role === 'support') { D.denied('هذه الصفحة غير متاحة لحسابك.'); return; }
    const items = [{ id: 'home', label: 'نظرة عامة', icon: 'home' }, { id: 'live', label: 'المشاهدة لايف', icon: 'chart' }, { id: 'messages', label: 'أسئلة الطلاب', icon: 'chat' }, { id: 'promo', label: viewing ? 'كود الخصم' : 'كود الخصم الخاص بي', icon: 'tag' }, { id: 'courses', label: viewing ? 'الدورات' : 'دوراتي', icon: 'book' }, { id: 'earnings', label: 'الأرباح والسحب', icon: 'coin' }, { id: 'contracts', label: viewing ? 'الاتفاقيات' : 'اتفاقياتي', icon: 'list' }];
    if (viewing) document.title = `لوحة ${viewing.full_name || viewing.email} | Biosyn Eg`;
    await D.shell({
      title: 'لوحة المحاضر', who: viewing ? (viewing.full_name || viewing.email) : (me.full_name || sb.user.email), sub: viewing ? 'عرض الإدارة · قراءة فقط' : D.roleAr[me.role],
      items, views, topLink: viewing ? '<a href="admin.html#imonitor" class="bs-btn bs-btn-secondary bs-btn-sm">رجوع لمتابعة المحاضرين</a>' : '<a href="account.html" class="bs-btn bs-btn-secondary bs-btn-sm">حسابي</a>',
    });
    if (viewing) {
      const bar = document.createElement('div');
      bar.className = 'bx-warnnote bx-viewas'; bar.setAttribute('role', 'status');
      bar.style.cssText = 'margin:12px 24px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
      bar.innerHTML = `<span>تشاهد لوحة <b>${esc(viewing.full_name || viewing.email)}</b> كما يراها بالضبط. للقراءة فقط: طلبات السحب وطلب الأكواد متوقفة هنا، وأي رد على سؤال طالب سيظهر باسم فريق Biosyn.</span><a class="bx-link" href="admin.html#imonitor">رجوع للإدارة</a>`;
      const content = $('.bx-content'); if (content) content.insertBefore(bar, content.children[1] || null);
      return;
    }
    const pulse = () => Chat.unreadCounts().then((u) => D.setBadge('messages', (u && u.instructor) || 0));
    pulse(); setInterval(() => { if (!document.hidden) pulse(); }, 60000);
  };
})();
