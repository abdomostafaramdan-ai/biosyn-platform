/* Live per-course analytics (views, viewers, watching now, instructor earnings).
   Used by the admin dashboard (all courses) and the instructor dashboard (own courses). Data: course_stats() RPC. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const REFRESH = 20000;

  window.courseAnalytics = async function (main, opt) {
    opt = opt || {};
    const F = { q: '', kind: opt.admin ? '' : 'recorded', status: '', sort: 'views_month', unlinked: false };
    let rows = [], at = null, timer = null;
    const load = async () => { const r = await sb.rpc('course_stats'); rows = Array.isArray(r) ? r : []; at = new Date(); };
    await load();

    const sum = (k, list) => (list || rows).reduce((s, r) => s + Number(r[k] || 0), 0);
    const list = () => rows.filter((r) => (!F.kind || r.kind === F.kind) && (!F.status || r.status === F.status) && (!F.unlinked || (r.kind === 'recorded' && !r.instructor_id))
      && (!F.q || `${r.title} ${r.instructor_name || ''} ${r.featured_names || ''}`.toLowerCase().includes(F.q.toLowerCase())))
      .sort((a, b) => Number(b[F.sort] || 0) - Number(a[F.sort] || 0) || Number(b.views_total) - Number(a.views_total));
    const live = (k) => Number(k) > 0 ? `<span class="bx-live"><i></i>${n(k)}</span>` : '<span class="bx-hint">0</span>';
    const who = (r) => {
      const names = esc(r.featured_names || r.instructor_name || '—');
      if (!opt.admin) return names;
      return r.kind === 'recorded' && !r.instructor_id
        ? `${names}<br><span class="bx-st bx-st-warn" title="تُحتسب الأرباح لحساب المحاضر المرتبط بالدورة">غير مرتبط بحساب محاضر</span>`
        : `${names}${r.instructor_name && r.instructor_name !== r.featured_names ? `<br><small class="bx-hint">الحساب: ${esc(r.instructor_name)}</small>` : ''}`;
    };

    function draw() {
      const L = list(), rec = rows.filter((r) => r.kind === 'recorded'), unlinked = rec.filter((r) => !r.instructor_id && Number(r.views_total) > 0).length;
      const head = ['الدورة', ...(opt.admin ? ['المحاضر'] : []), 'المشاهدات', 'طلاب', 'النشاط', 'شهادات', opt.admin ? 'أرباح المحاضر' : 'أرباحك'];
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('مشاهدات هذا الشهر', n(sum('views_month', rec)), 'مشاهدة واحدة لكل طالب في كل دورة')}
          ${D.stat('يشاهدون الآن', `<span class="bx-live bx-live-lg"><i></i>${n(sum('watching_now'))}</span>`, 'آخر دقيقتين')}
          ${D.stat('نشطين آخر 24 ساعة', n(sum('active_today')), n(sum('viewers_total', rec)) + ' طالب شاهدوا إجمالًا')}
          ${D.stat(opt.admin ? 'أرباح المحاضرين المتوقعة' : 'أرباحك المتوقعة هذا الشهر', D.money(sum('est_earnings_month', rec)), '30٪ من قيمة المشاهدات · تُعتمد في بداية الشهر')}
        </div>
        ${opt.admin && unlinked ? `<div class="bx-warnnote" style="margin-top:16px">توجد ${unlinked} دورة عليها مشاهدات وغير مرتبطة بحساب محاضر، لذا لن تُحتسب أرباحها لأحد. افتح الدورة من «الدورات» واختر المحاضر من حساباته.</div>` : ''}
        <div class="bx-payfilters" style="margin-top:20px">
          <div class="bx-field bx-pf-q"><label for="aq" class="bx-hint">بحث</label><input id="aq" class="bx-input" type="search" value="${esc(F.q)}" placeholder="اسم الدورة أو المحاضر"></div>
          ${opt.admin ? `<div class="bx-field"><label for="ak" class="bx-hint">النوع</label><select id="ak" class="bx-select">${[['', 'الكل'], ['recorded', 'مسجل'], ['interactive', 'تفاعلي']].map(([k, t]) => `<option value="${k}" ${k === F.kind ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="bx-field"><label for="as" class="bx-hint">الحالة</label><select id="as" class="bx-select">${[['', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']].map(([k, t]) => `<option value="${k}" ${k === F.status ? 'selected' : ''}>${t}</option>`).join('')}</select></div>` : ''}
          <div class="bx-field"><label for="ao" class="bx-hint">ترتيب حسب</label><select id="ao" class="bx-select">${[['views_month', 'مشاهدات الشهر'], ['views_total', 'إجمالي المشاهدات'], ['watching_now', 'يشاهدون الآن'], ['est_earnings_month', 'الربح المتوقع']].map(([k, t]) => `<option value="${k}" ${k === F.sort ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          ${opt.admin ? `<label class="bx-check bx-pf-act" style="align-self:center"><input type="checkbox" id="au" ${F.unlinked ? 'checked' : ''}> الدورات غير المرتبطة بمحاضر فقط</label>` : ''}
        </div>
        ${D.panel(opt.admin ? 'تحليل كل دورة' : 'مشاهدات دوراتك', D.table(head, L.map((r) => [
          `<div class="bx-an-title"><b class="bs-latin">${esc(r.title)}</b><small class="bx-hint">${r.kind === 'interactive' ? 'تفاعلي' : 'مسجل'} · ${r.lectures} محاضرة ${D.badge('course', r.status)}</small></div>`,
          ...(opt.admin ? [who(r)] : []),
          r.kind === 'recorded' ? `<b class="bx-an-big">${n(r.views_month)}</b><small class="bx-hint bx-an-sub">هذا الشهر · ${n(r.views_total)} إجمالي</small>` : '<span class="bx-hint">—</span>',
          n(r.viewers_total),
          `${live(r.watching_now)} <small class="bx-hint">الآن</small><small class="bx-hint bx-an-sub">${n(r.active_today)} آخر 24 ساعة</small>`,
          n(r.certificates),
          r.kind === 'recorded' ? `<b>${D.money(r.est_earnings_month)}</b><small class="bx-hint bx-an-sub">متوقع هذا الشهر · ${D.money(r.earned_closed)} شهور مقفولة</small>` : '<span class="bx-hint">اتفاق منفصل</span>',
        ]), opt.admin ? 'لا توجد دورات بهذه التصفية' : 'لا توجد دورات مرتبطة بحسابك بعد'),
        `<span class="bx-hint bx-livestamp"><span class="bx-live"><i></i></span> بيتحدث تلقائي · آخر تحديث ${at.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`)}
        <p class="bx-hint">المشاهدة المعتمدة = طالب مشترك شاهد 50٪ من محاضرة، وتُحتسب مرة واحدة فقط لكل طالب في الدورة كل شهر مهما شاهد من محاضرات. «يشاهدون الآن» = طلاب يعمل الفيديو لديهم خلال آخر دقيقتين. يُحتسب الربح المتوقع على اشتراكات الشهر حتى الآن، ويُقفل الرقم النهائي في بداية الشهر القادم.</p>`;
      const bind = (id, k, ev) => { const el = $('#' + id, main); if (el) el.addEventListener(ev || 'change', () => { F[k] = el.type === 'checkbox' ? el.checked : el.value; const pos = el.selectionStart; draw(); if (ev === 'input') { const x = $('#' + id, main); x.focus(); x.setSelectionRange(pos, pos); } }); };
      bind('aq', 'q', 'input'); bind('ak', 'kind'); bind('as', 'status'); bind('ao', 'sort'); bind('au', 'unlinked');
    }
    draw();
    // live: refresh while this view is on screen
    timer = setInterval(async () => {
      if (!main.isConnected || !$('.bx-livestamp', main)) return clearInterval(timer);
      if (document.hidden || (document.activeElement && main.contains(document.activeElement) && document.activeElement.matches('input,select'))) return;
      try { await load(); draw(); } catch (e) { /* keep last numbers */ }
    }, REFRESH);
  };
})();
