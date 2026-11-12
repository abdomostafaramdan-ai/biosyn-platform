/* Admin / support dashboard */
(() => {
  'use strict';
  const D = window.Dash;
  let me; const isAdmin = () => me.role === 'admin';
  const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '');
  const mmss = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const parseDur = (t) => { t = String(t).trim(); if (!t) return null; const p = t.split(':').map(Number); if (p.some(Number.isNaN)) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60; };
  const say = (el, t, k) => { el.className = 'bx-formmsg' + (k ? ' ' + k : ''); el.textContent = t; };

  // ---------- requests ----------
  async function setReqStatus(id, status) { await sb.update('requests', { id: 'eq.' + id }, { status }); }
  function reqCard(r, usersById, lessonsByProp) {
    const pid = r.payload && r.payload.proposal_id;
    const f = r.payload && typeof r.payload === 'object' ? Object.entries(r.payload).filter(([k, v]) => v !== '' && v !== null && k !== 'proposal_id') : [];
    const ls = (pid && lessonsByProp && lessonsByProp[pid]) || [];
    const lessonsHtml = pid ? `<div class="bx-reqlessons"><b>الدروس والفيديوهات</b><ol>${ls.map((l) => `<li>${esc(l.title)} ${l.video_url ? `<a class="bx-linkbtn" href="${esc(l.video_url)}" target="_blank" rel="noopener">فتح رابط الفيديو</a>` : ''}${l.bunny_video_id ? ` <span class="bx-st bx-st-ok">مرفوع على Bunny</span>` : ''}${!l.video_url && !l.bunny_video_id ? ' <small class="bx-hint">بدون فيديو</small>' : ''}</li>`).join('') || '<li class="bx-hint">لا توجد دروس</li>'}</ol><button class="bs-btn bs-btn-secondary bs-btn-sm" data-act="proposal" data-pid="${esc(pid)}">فتح الدورة المقدّمة ومشاهدة الفيديوهات</button></div>` : '';
    const isRefund = r.type === 'refund';
    return `<article class="bx-reqcard" data-r="${r.id}"><div class="bx-spread" style="gap:8px;flex-wrap:wrap"><div><b>${esc(r.name)}</b> <span class="bx-hint">· ${esc(D.reqType[r.type] || r.type)} · ${D.dateTime(r.created_at)}</span></div>${D.badge('req', r.status)}</div>
      <dl><div><dt>التواصل</dt><dd class="bx-kbd">${esc(r.email || '')}${r.phone ? ' · ' + esc(r.phone) : ''}</dd></div>${f.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`).join('')}</dl>${lessonsHtml}
      <div class="bx-btnrow">
        ${isRefund && isAdmin() && ['new', 'in_review'].includes(r.status) ? `<button class="bs-btn bs-btn-primary bs-btn-sm" data-act="refund" data-pay="${esc(r.payload.payment_id)}">تنفيذ الاسترداد</button>` : ''}
        ${r.status === 'new' ? '<button class="bs-btn bs-btn-secondary bs-btn-sm" data-act="in_review">قيد المراجعة</button>' : ''}
        ${['new', 'in_review'].includes(r.status) && !isRefund ? '<button class="bs-btn bs-btn-secondary bs-btn-sm" data-act="accepted">قبول</button>' : ''}
        ${['new', 'in_review'].includes(r.status) ? '<button class="bs-btn bs-btn-ghost bs-btn-sm" data-act="rejected">رفض</button>' : ''}
        ${r.type.startsWith('instructor') && r.user_id && isAdmin() && usersById[r.user_id] && usersById[r.user_id].role === 'student' ? '<button class="bs-btn bs-btn-ghost bs-btn-sm" data-act="promote">ترقية الحساب لمحاضر</button>' : ''}
        ${r.email || r.user_id ? `<button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" data-act="chat">💬 مراسلة عبر المنصة</button>` : ''}
      </div></article>`;
  }

  async function doRefund(paymentId) {
    try {
      let r = await sb.fn('refund-payment', { payment_id: paymentId });
      return r;
    } catch (e) {
      if (e.status === 202 || (e.data && e.data.manual)) return { manual: true };
      throw e;
    }
  }

  const views = {
    async tickets(main) {
      main.innerHTML = D.panel('التذاكر والشكاوى', `<p class="bx-hint" style="margin-top:0">التذاكر التي يفتحها الطلاب من «حسابي ← الرسائل والدعم». يصلهم ردّك هنا وعلى البريد الإلكتروني.</p><div data-ib></div>`);
      await Chat.inbox($('[data-ib]', main), { mode: 'staff', kind: 'ticket', status: 'open', empty: 'لا توجد تذاكر بهذه التصفية' });
    },
    async questions(main) {
      main.innerHTML = D.panel('أسئلة الطلاب للمحاضرين', `<p class="bx-hint" style="margin-top:0">جميع أسئلة الطلاب في الدورات. أسئلة الدورات غير المرتبطة بحساب محاضر تصل إلى الفريق هنا للرد عليها.</p><div data-ib></div>`);
      await Chat.inbox($('[data-ib]', main), { mode: 'staff', kind: 'course', empty: 'لا توجد أسئلة بعد' });
    },
    async analytics(main) { await window.courseAnalytics(main, { admin: true, edit: isAdmin() }); },
    async traffic(main) { await window.trafficDashboard(main); },
    async insights(main) { await window.insightsDashboard(main); },
    async seo(main) { await window.seoDashboard(main); },
    async about(main) { await window.aboutAdmin(main); },
    async contracts(main) { await window.contractsAdmin(main, isAdmin()); },
    async campaign(main) { await window.campaignAdmin(main); },
    async news(main) { await window.newsAdmin(main); },
    async faculties(main) { await window.facultiesAdmin(main); },
    async social(main) { await window.socialAdmin(main); },
    async emails(main) { await window.emailsAdmin(main); },
    async mailcampaigns(main) { await window.campaignsAdmin(main); },
    async texts(main) { await window.textsAdmin(main); },
    async testimonials(main) { await window.testimonialsAdmin(main); },

    async home(main) {
      const now = new Date(), som = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [subs, pays, reqs, pouts, courses] = await Promise.all([
        sb.get('subscriptions', { select: 'id', ends_at: 'gt.' + now.toISOString(), starts_at: 'lte.' + now.toISOString() }),
        sb.get('payments', { select: 'amount_egp,purpose', status: 'eq.paid', paid_at: 'gte.' + som }),
        sb.get('requests', { select: '*', status: 'in.(new,in_review)', order: 'created_at.desc', limit: 50 }),
        sb.get('payouts', { select: 'id,amount_egp', status: 'in.(requested,approved)' }),
        sb.get('courses', { select: 'id,status' }),
      ]);
      const rev = pays.reduce((s, p) => s + Number(p.amount_egp), 0);
      const newReq = reqs.filter((r) => r.status === 'new');
      D.setBadge('requests', newReq.filter((r) => r.type !== 'refund').length);
      if (reqs.some((r) => r.type === 'refund')) views._payTab = 'ref';
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('اشتراكات سارية', subs.length)}
          ${D.stat('إيراد هذا الشهر', D.money(rev), 'مدفوعات مؤكدة (قبل رسوم البوابة)')}
          ${D.stat('طلبات جديدة', newReq.length, reqs.length + ' بانتظار إجراء')}
          ${D.stat('سحوبات معلّقة', pouts.length, pouts.length ? D.money(pouts.reduce((s, p) => s + Number(p.amount_egp), 0)) : '')}
        </div>
        ${D.panel('ما يحتاج إجراءك اليوم', reqs.length || pouts.length ? `<ol class="bx-focus">${reqs.slice(0, 6).map((r) => `<li><div class="bx-date bx-date-sm"><small>${esc(D.reqType[r.type] || '')}</small><b>•</b></div><div><b>${esc(r.name)}</b><span>${D.dateTime(r.created_at)}</span></div><a class="bs-btn bs-btn-secondary bs-btn-sm" href="${r.type === 'refund' ? '#payments' : '#requests'}">افتح</a></li>`).join('')}${pouts.length ? `<li><div class="bx-date bx-date-sm"><small>سحب</small><b>•</b></div><div><b>${pouts.length} طلب سحب أرباح</b><span>${D.money(pouts.reduce((s, p) => s + Number(p.amount_egp), 0))}</span></div><a class="bs-btn bs-btn-secondary bs-btn-sm" href="#payouts">افتح</a></li>` : ''}</ol>` : '<div class="bx-empty-big"><b>لا شيء ينتظرك الآن</b></div>')}
        ${courses.filter((c) => c.status === 'draft').length ? `<p class="bx-hint">${courses.filter((c) => c.status === 'draft').length} دورة ما زالت مسودة. أضف محاضراتها من «الدورات» ثم انشرها.</p>` : ''}`;
    },

    async requests(main) {
      const [reqs, users] = await Promise.all([sb.get('requests', { select: '*', type: 'neq.refund', order: 'created_at.desc', limit: 200 }), sb.rpc('admin_users').catch(() => [])]);
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      const pids = [...new Set(reqs.map((r) => r.payload && r.payload.proposal_id).filter(Boolean))];
      const lessonsByProp = {};
      if (pids.length) (await sb.get('proposal_lessons', { select: 'id,proposal_id,title,video_url,bunny_video_id,position', proposal_id: 'in.(' + pids.join(',') + ')', order: 'position.asc' }).catch(() => [])).forEach((l) => (lessonsByProp[l.proposal_id] = lessonsByProp[l.proposal_id] || []).push(l));
      D.setBadge('requests', reqs.filter((r) => r.status === 'new').length);
      const nRef = (await sb.get('requests', { select: 'id', type: 'eq.refund', status: 'in.(new,in_review)' }).catch(() => [])).length;
      let type = '', status = 'open';
      const draw = () => {
        const list = reqs.filter((r) => (!type || r.type === type) && (status === 'all' || (status === 'open' ? ['new', 'in_review'].includes(r.status) : r.status === status)));
        $('#rl').innerHTML = list.length ? list.map((r) => reqCard(r, byId, lessonsByProp)).join('') : '<div class="bx-empty-big"><b>لا توجد طلبات</b></div>';
      };
      main.innerHTML = `<div class="bx-btnrow" style="margin-bottom:16px"><div class="bx-field"><label for="ft" class="bx-hint">النوع</label><select id="ft" class="bx-select"><option value="">كل الأنواع</option>${Object.entries(D.reqType).filter(([k]) => k !== 'refund').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="bx-field"><label for="fs" class="bx-hint">الحالة</label><select id="fs" class="bx-select"><option value="open">مفتوحة</option><option value="all">الكل</option><option value="accepted">مقبولة</option><option value="rejected">مرفوضة</option></select></div></div>${nRef ? `<p class="bx-hint" style="margin:0 0 12px">أصبحت طلبات الاسترداد في <a class="bx-link" href="#payments">المدفوعات ← طلبات الاسترداد</a> (${nRef} مفتوح).</p>` : ''}<div id="rl" style="display:grid;gap:12px"></div>`;
      if (nRef) views._payTab = 'ref';
      $('#ft').onchange = (e) => { type = e.target.value; draw(); };
      $('#fs').onchange = (e) => { status = e.target.value; draw(); };
      $('#rl').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const card = b.closest('[data-r]'), id = card.dataset.r, r = reqs.find((x) => x.id === id), act = b.dataset.act;
        if (act === 'chat') {
          b.disabled = true;
          try { const tid = await sb.rpc('request_thread', { p_request: r.id, p_subject: 'بخصوص طلبك: ' + (D.reqType[r.type] || 'طلب') }); if (r.status === 'new') r.status = 'in_review'; window.Chat.openThread(tid, { onChange: () => {} }); }
          catch (err) { ui.toast(/no contact/.test(err.message || '') ? 'لا يوجد بريد إلكتروني لصاحب الطلب.' : arErr(err), 'err'); }
          b.disabled = false; return;
        }
        if (act === 'proposal') { const pp = await sb.get('course_proposals', { select: '*', id: 'eq.' + b.dataset.pid }).catch(() => []); if (pp[0]) proposalModal(pp[0]); else ui.toast('الدورة غير موجودة.', 'err'); return; }
        b.disabled = true;
        try {
          if (act === 'promote') { await sb.update('profiles', { id: 'eq.' + r.user_id }, { role: 'instructor' }); byId[r.user_id].role = 'instructor'; ui.toast('تمت ترقية الحساب إلى محاضر.'); }
          else if (act === 'refund') {
            const res = await doRefund(b.dataset.pay);
            if (res.manual) { if (!confirm('هذه البوابة لا تدعم الاسترداد الآلي. هل نفّذت الاسترداد من لوحة البوابة؟')) { b.disabled = false; return; } await sb.fn('refund-payment', { payment_id: b.dataset.pay, manual_confirmed: true }); }
            await setReqStatus(id, 'accepted'); r.status = 'accepted'; ui.toast('تم الاسترداد وإلغاء التسجيل.');
          } else { await setReqStatus(id, act); r.status = act; }
          D.setBadge('requests', reqs.filter((x) => x.status === 'new').length); draw();
        } catch (err) { b.disabled = false; ui.toast(((err.data && err.data.error) || arErr(err)), 'err'); }
      });
      draw();
    },

    async courses(main) {
      const [courses, insts, fl] = await Promise.all([sb.get('courses', { select: '*,lectures(id)', order: 'created_at.desc' }), sb.rpc('admin_users').then((u) => u.filter((x) => x.role === 'instructor')).catch(() => []), sb.get('featured_instructors', { select: 'id,name' }).catch(() => [])]);
      const nameOf = Object.fromEntries(insts.map((i) => [i.id, i.full_name || i.email])), fName = Object.fromEntries(fl.map((i) => [i.id, i.name]));
      const STL = { '': 'الكل', published: 'منشور', draft: 'مسودة', review: 'قيد المراجعة', archived: 'مؤرشف' };
      let fst = (() => { try { return localStorage.getItem('biosyn.admin.cst') || ''; } catch (e) { return ''; } })(), fkind = '', fq = '';
      const cnt = (k) => (k ? courses.filter((c) => c.status === k).length : courses.length);
      main.innerHTML = D.panel('الدورات', `<div class="bx-row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          <div class="nw-chips" style="margin:0" role="group" aria-label="تصفية حسب الحالة">${Object.entries(STL).map(([k, v]) => `<button type="button" class="bx-chip" data-st="${k}" aria-pressed="${k === fst}">${v} <small>(${cnt(k)})</small></button>`).join('')}</div>
          <select id="cfk" class="bx-select" style="max-width:160px" aria-label="النوع"><option value="">كل الأنواع</option><option value="recorded">مسجل</option><option value="interactive">تفاعلي</option></select>
          <input id="cfq" class="bx-input" type="search" placeholder="ابحث باسم الدورة" style="max-width:240px" aria-label="بحث"></div><div id="clist"></div>`,
        isAdmin() ? '<span class="bx-btnrow"><button class="bs-btn bs-btn-ghost bs-btn-sm" id="newbl">+ دورة من مكتبة Bunny</button><button class="bs-btn bs-btn-primary bs-btn-sm" id="newc">+ دورة جديدة</button></span>' : '');
      const drawList = () => {
        const list = courses.filter((c) => (!fst || c.status === fst) && (!fkind || c.kind === fkind) && (!fq || (c.title + ' ' + (c.slug || '')).toLowerCase().includes(fq)));
        $('#clist', main).innerHTML = D.table(['الدورة', 'النوع', 'المحاضر', 'المحاضرات', 'الحالة', ''], list.map((c) => [`<b class="bs-latin">${esc(c.title)}</b>`, c.kind === 'interactive' ? 'تفاعلي' : 'مسجل', esc((c.featured_instructor_ids || []).map((id) => fName[id]).filter(Boolean).join('، ') || fName[c.featured_instructor_id] || nameOf[c.instructor_id] || '—'), (c.lectures || []).length, D.badge('course', c.status), isAdmin() ? `<button class="bx-linkbtn" data-edit="${c.id}">تعديل</button>` : '']), fst || fkind || fq ? 'لا توجد دورات بهذه التصفية' : 'لا توجد دورات');
        $$('[data-edit]', main).forEach((b) => (b.onclick = () => open(courses.find((c) => c.id === b.dataset.edit))));
      };
      $$('[data-st]', main).forEach((b) => (b.onclick = () => { fst = b.dataset.st; try { localStorage.setItem('biosyn.admin.cst', fst); } catch (e) {} $$('[data-st]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawList(); }));
      $('#cfk', main).onchange = (e) => { fkind = e.target.value; drawList(); };
      $('#cfq', main).oninput = (e) => { fq = e.target.value.trim().toLowerCase(); drawList(); };
      const open = (c) => courseForm(c, insts);
      const nc = $('#newc', main); if (nc) nc.onclick = () => open(null);
      const nb = $('#newbl', main); if (nb) nb.onclick = () => pickLibrary(async (lib) => {
        const slug = (lib.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course') + '-' + lib.id;
        const [c] = await sb.insert('courses', { title: lib.name, slug, kind: 'recorded', status: 'draft', level: 'beginner', cover_code: lib.name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || null });
        const n = await addLibraryLectures(c.id, lib, []);
        ui.toast(`تم إنشاء دورة «${lib.name}» بـ ${n} محاضرة كمسودة. أكمل بياناتها ثم انشرها.`); D.reload(); setTimeout(() => open(c), 400);
      });
      drawList();
    },

    async users(main) {
      const users = await sb.rpc('admin_users');
      const draw = (t) => {
        const list = users.filter((u) => !t || (u.full_name + ' ' + u.email + ' ' + (u.phone || '') + ' ' + (u.whatsapp || '')).toLowerCase().includes(t.toLowerCase()));
        $('#ul').innerHTML = D.table(['الاسم', 'البريد', 'الهاتف', 'واتساب', 'التسجيل', 'الدور', ''], list.map((u) => [esc(u.full_name || '—'), `<span class="bx-kbd">${esc(u.email)}</span>`, `<span class="bx-kbd">${esc(u.phone || '—')}</span>`, u.whatsapp ? `<a class="bx-link bx-kbd" dir="ltr" href="https://wa.me/${esc(u.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(u.whatsapp)}</a>` : '—', D.date(u.created_at), isAdmin() && u.id !== sb.user.id ? `<select class="bx-select" data-u="${u.id}" aria-label="دور ${esc(u.full_name || u.email)}">${Object.entries(D.roleAr).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select>` : D.roleAr[u.role], isAdmin() ? `<button class="bx-linkbtn" data-dev="${u.id}">مسح الأجهزة</button>` : '']), 'لا يوجد مستخدمون');
      };
      main.innerHTML = D.panel('المستخدمون', `<div class="bx-search" style="margin-bottom:12px"><input id="us" class="bx-input" type="search" placeholder="ابحث بالاسم أو البريد أو الهاتف" aria-label="بحث"></div><div id="ul"></div>`, `<span class="bx-hint">${users.length >= 500 ? 'آخر 500' : users.length} مستخدم</span> <button class="bs-btn bs-btn-secondary bs-btn-sm" type="button" id="uxl">⬇ تحميل Excel</button>`);
      $('#us').oninput = (e) => draw(e.target.value); draw('');
      $('#uxl').onclick = (ev) => window.exportUsersXlsx(ev.target);
      $('#ul').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-dev]'); if (!b) return;
        if (!confirm('مسح كل الأجهزة المسجلة لهذا الحساب؟ سيتمكن من المشاهدة من جهازين جديدين.')) return;
        try { await sb.remove('user_devices', { user_id: 'eq.' + b.dataset.dev }); ui.toast('تم مسح الأجهزة.'); } catch (err) { ui.toast(arErr(err), 'err'); }
      });
      $('#ul').addEventListener('change', async (e) => {
        const s = e.target.closest('[data-u]'); if (!s) return;
        if (s.value === 'admin' && !confirm('منح صلاحية المدير الكاملة لهذا الحساب؟')) { D.reload(); return; }
        try { await sb.update('profiles', { id: 'eq.' + s.dataset.u }, { role: s.value }); ui.toast('تم تحديث الدور.'); } catch (err) { ui.toast(arErr(err), 'err'); D.reload(); }
      });
    },

    async payments(main) {
      const [rows, refs] = await Promise.all([
        sb.get('payments', { select: '*,profiles(full_name),plans(name),courses(title)', order: 'created_at.desc', limit: 1000 }),
        sb.get('requests', { select: '*', type: 'eq.refund', order: 'created_at.desc', limit: 500 }).catch(() => []),
      ]);
      const payById = Object.fromEntries(rows.map((p) => [p.id, p]));
      const openRef = (r) => ['new', 'in_review'].includes(r.status);
      const refByPay = {}; refs.forEach((r) => { const k = r.payload && r.payload.payment_id; if (k && (!refByPay[k] || openRef(r))) refByPay[k] = r; });
      D.setBadge('payments', refs.filter(openRef).length);
      const itemOf = (p) => (p ? (p.plans ? p.plans.name : p.courses ? p.courses.title : p.purpose === 'consultation' ? 'استشارة' : '—') : '—');
      const paidSum = (list) => list.reduce((s, p) => s + Number(p.amount_egp || 0), 0);
      const daysLeft = (p) => (p && p.paid_at ? Math.ceil((new Date(p.paid_at).getTime() + 7 * 864e5 - Date.now()) / 864e5) : null);
      const inRange = (iso, from, to) => (!from || iso >= from) && (!to || iso.slice(0, 10) <= to);
      const canRefund = (p) => p && p.purpose === 'interactive_course' && p.status === 'paid' && daysLeft(p) > 0;
      const F = { tab: views._payTab || 'pay', q: '', status: '', kind: '', gw: '', from: '', to: '', rs: 'open' };
      const csv = (name, head, data) => {
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...data].map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      };
      const match = (q, ...xs) => !q || xs.join(' ').toLowerCase().includes(q.toLowerCase());

      const payList = () => rows.filter((p) => (!F.status || p.status === F.status) && (!F.kind || p.purpose === F.kind) && (!F.gw || p.gateway === F.gw)
        && inRange(p.created_at, F.from, F.to) && match(F.q, (p.profiles && p.profiles.full_name) || '', itemOf(p), p.receipt_no || '', p.manual_ref || '', p.gateway_ref || ''));
      const refList = () => refs.filter((r) => (F.rs === 'all' || (F.rs === 'open' ? openRef(r) : r.status === F.rs)) && inRange(r.created_at, F.from, F.to)
        && match(F.q, r.name || '', r.email || '', (r.payload && r.payload.item) || itemOf(payById[r.payload && r.payload.payment_id])));

      function stats() {
        const paid = rows.filter((p) => p.status === 'paid' || p.status === 'refunded'), refunded = rows.filter((p) => p.status === 'refunded');
        const open = refs.filter(openRef);
        return `<div class="bx-stats">
          ${D.stat('إجمالي المحصّل', D.money(paidSum(paid)), paid.length + ' عملية ناجحة')}
          ${D.stat('المسترد', D.money(paidSum(refunded)), refunded.length + ' عملية')}
          ${D.stat('صافي الدخل', D.money(paidSum(paid) - paidSum(refunded)), 'قبل رسوم البوابة')}
          ${D.stat('طلبات استرداد مفتوحة', open.length, open.length ? 'بانتظار قرارك' : 'لا يوجد شيء معلّق')}
        </div>`;
      }
      const sel = (id, label, opts, v) => `<div class="bx-field"><label for="${id}" class="bx-hint">${label}</label><select id="${id}" class="bx-select">${opts.map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
      function filters() {
        const common = `<div class="bx-field bx-pf-q"><label for="pq" class="bx-hint">بحث</label><input id="pq" class="bx-input" type="search" value="${esc(F.q)}" placeholder="${F.tab === 'pay' ? 'اسم، دورة، رقم إيصال أو مرجع' : 'اسم الطالب أو البريد الإلكتروني أو الدورة'}"></div>
          <div class="bx-field"><label for="pf" class="bx-hint">من</label><input id="pf" class="bx-input" type="date" value="${F.from}"></div>
          <div class="bx-field"><label for="pt" class="bx-hint">إلى</label><input id="pt" class="bx-input" type="date" value="${F.to}"></div>`;
        return F.tab === 'pay'
          ? `${common}${sel('ps', 'الحالة', [['', 'كل الحالات'], ['paid', 'مدفوع'], ['pending', 'بانتظار الدفع'], ['failed', 'فشل'], ['refunded', 'مسترد']], F.status)}
             ${sel('pk', 'النوع', [['', 'الكل'], ['subscription', 'اشتراك باقة'], ['interactive_course', 'دورة تفاعلية'], ['consultation', 'استشارة']], F.kind)}
             ${sel('pg', 'البوابة', [['', 'كل البوابات'], ...Object.entries(D.gw)], F.gw)}`
          : `${common}${sel('rs', 'الحالة', [['open', 'مفتوحة (بانتظار قرار)'], ['all', 'الكل'], ['accepted', 'تم الاسترداد'], ['rejected', 'مرفوضة']], F.rs)}`;
      }
      function payTable(list) {
        return D.table(['التاريخ', 'العميل', 'البند', 'السعر', 'الرسوم', 'البوابة', 'الحالة', ''], list.map((p) => {
          const manual = p.gateway === 'manual' && p.status === 'pending' && isAdmin();
          const rq = refByPay[p.id];
          const act = manual ? `<button class="bx-linkbtn" data-ma="${p.id}">تأكيد الاستلام</button> · <button class="bx-linkbtn" data-mr="${p.id}" style="color:var(--danger-text)">رفض</button>`
            : rq && openRef(rq) ? `<button class="bx-linkbtn" data-goref="${rq.id}">طلب استرداد مفتوح ←</button>`
            : canRefund(p) && isAdmin() ? `<button class="bx-linkbtn" data-rf="${p.id}">استرداد</button>` : '';
          return [D.date(p.created_at), esc((p.profiles && p.profiles.full_name) || '—'), esc(itemOf(p)) + (p.receipt_no ? `<br><small class="bx-hint">إيصال ${p.receipt_no}</small>` : ''), (p.currency && p.currency !== 'EGP' ? `${paidTxt(p)}<br><small class="bx-hint">≈ ${D.money(p.amount_egp)}</small>` : D.money(p.amount_egp)) + (Number(p.discount_egp) ? `<br><small class="bx-hint">خصم ${D.money(p.discount_egp)}</small>` : ''), p.currency && p.currency !== 'EGP' ? paidTxt(p, 'fee') : D.money(p.fee_egp), (D.gw[p.gateway] || p.gateway) + (p.gateway === 'manual' ? `<br><small class="bx-hint">${({ instapay: 'إنستاباي', vodafone_cash: 'فودافون كاش', paypal: 'PayPal' })[p.manual_method] || ''} · <span class="bs-latin">${esc(p.manual_ref || '')}</span></small>${p.proof_path ? `<br><button class="bx-linkbtn" data-proof="${esc(p.proof_path)}">🧾 عرض سكرين التحويل</button>` : p.manual_method && p.manual_method !== 'paypal' ? '<br><small class="bx-hint">بدون سكرين (طلب قديم)</small>' : ''}` : ''), D.badge('pay', p.status), act];
        }), 'لا توجد مدفوعات بهذه التصفية');
      }
      function refCard(r) {
        const p = payById[r.payload && r.payload.payment_id], dl = daysLeft(p), pl = r.payload || {};
        const st = r.status === 'accepted' ? ['تم الاسترداد', 'ok'] : r.status === 'rejected' ? ['مرفوض', 'mute'] : r.status === 'in_review' ? ['قيد المراجعة', 'info'] : ['جديد', 'warn'];
        const window = !openRef(r) ? '' : !p ? '<span class="bx-st bx-st-mute">الدفعة غير موجودة</span>' : p.status === 'refunded' ? '<span class="bx-st bx-st-ok">اتردّت فعلًا</span>' : dl > 0 ? `<span class="bx-st ${dl <= 2 ? 'bx-st-danger' : 'bx-st-info'}">باقي ${dl} ${dl === 1 ? 'يوم' : dl === 2 ? 'يومين' : 'أيام'} في المهلة</span>` : '<span class="bx-st bx-st-danger">المهلة خلصت</span>';
        return `<article class="bx-reqcard bx-refcard" data-ref="${r.id}">
          <div class="bx-spread" style="gap:8px;flex-wrap:wrap"><div><b>${esc(r.name)}</b> <span class="bx-hint">· ${D.dateTime(r.created_at)}</span></div><span class="bx-btnrow" style="gap:6px">${window}<span class="bx-st bx-st-${st[1]}">${st[0]}</span></span></div>
          <dl>
            <div><dt>الدورة</dt><dd>${esc(pl.item || itemOf(p))}</dd></div>
            <div><dt>المبلغ</dt><dd>${D.money(p ? p.amount_egp : pl.amount_egp || 0)}${p && Number(p.fee_egp) ? ` <small class="bx-hint">+ ${D.money(p.fee_egp)} رسوم بوابة</small>` : ''}</dd></div>
            <div><dt>الدفع</dt><dd>${p ? `${esc(D.gw[p.gateway] || p.gateway)} · ${D.date(p.paid_at || p.created_at)}${p.receipt_no ? ` · إيصال ${p.receipt_no}` : ''}` : '—'}</dd></div>
            <div><dt>التواصل</dt><dd class="bx-kbd">${esc(r.email || '')}</dd></div>
            ${pl.reason ? `<div><dt>السبب</dt><dd>${esc(pl.reason)}</dd></div>` : ''}
            ${pl.note ? `<div><dt>ملاحظة الطالب</dt><dd style="white-space:pre-line">${esc(pl.note)}</dd></div>` : ''}
            ${pl.decision_note ? `<div><dt>ردّك</dt><dd style="white-space:pre-line">${esc(pl.decision_note)}</dd></div>` : ''}
          </dl>
          ${openRef(r) && isAdmin() ? `<div class="bx-btnrow">
            ${p && p.status === 'refunded' ? `<button class="bs-btn bs-btn-secondary bs-btn-sm" data-ract="close">قفل الطلب (اتردّت)</button>` : p && p.status === 'paid' ? `<button class="bs-btn bs-btn-primary bs-btn-sm" data-ract="refund">تنفيذ الاسترداد</button>` : ''}
            ${r.status === 'new' ? '<button class="bs-btn bs-btn-secondary bs-btn-sm" data-ract="in_review">قيد المراجعة</button>' : ''}
            <button class="bs-btn bs-btn-ghost bs-btn-sm" data-ract="reject">رفض</button>
            ${r.email ? `<a class="bs-btn bs-btn-ghost bs-btn-sm" href="mailto:${esc(r.email)}">مراسلة</a>` : ''}</div>` : ''}
        </article>`;
      }

      function draw() {
        views._payTab = F.tab;
        const pl = F.tab === 'pay' ? payList() : null, rl = F.tab === 'ref' ? refList() : null, nOpen = refs.filter(openRef).length;
        main.innerHTML = `${stats()}
          <div class="bx-paytabs" role="tablist" aria-label="المدفوعات والاسترداد">
            <button role="tab" data-tab="pay" aria-selected="${F.tab === 'pay'}">المدفوعات <span class="bx-hint">${rows.length}</span></button>
            <button role="tab" data-tab="ref" aria-selected="${F.tab === 'ref'}">طلبات الاسترداد ${nOpen ? `<span class="bx-nav-n">${nOpen}</span>` : `<span class="bx-hint">${refs.length}</span>`}</button>
          </div>
          <div class="bx-payfilters">${filters()}<div class="bx-field bx-pf-act"><span class="bx-hint">&nbsp;</span><span class="bx-btnrow"><button class="bs-btn bs-btn-ghost bs-btn-sm" id="pclr">مسح الفلاتر</button><button class="bs-btn bs-btn-secondary bs-btn-sm" id="pcsv">تحميل Excel</button></span></div></div>
          ${F.tab === 'pay'
            ? D.panel(`المدفوعات`, payTable(pl), `<span class="bx-hint">${pl.length} عملية · ${D.money(paidSum(pl.filter((p) => p.status === 'paid')))} مدفوع</span>`)
            : `<p class="bx-hint" style="margin:0 0 12px">الاسترداد متاح للدورات التفاعلية فقط، خلال 7 أيام من الدفع. يعيد التنفيذ المبلغ عبر البوابة ويلغي تسجيل الطالب، ويصل الطالب بريد إلكتروني بالقرار.</p>
               <div id="rl" style="display:grid;gap:12px">${rl.length ? rl.map(refCard).join('') : `<div class="bx-empty-big"><b>${F.rs === 'open' ? 'لا توجد طلبات استرداد معلّقة' : 'لا توجد طلبات بهذه التصفية'}</b></div>`}</div>`}`;
        wire();
      }
      function wire() {
        $$('[data-tab]', main).forEach((b) => (b.onclick = () => { F.tab = b.dataset.tab; draw(); }));
        const bind = (id, k, ev) => { const el = $('#' + id, main); if (el) el.addEventListener(ev || 'change', () => { F[k] = el.value.trim(); if (k === 'q') { const pos = el.selectionStart; draw(); const n = $('#pq', main); n.focus(); n.setSelectionRange(pos, pos); } else draw(); }); };
        bind('pq', 'q', 'input'); bind('pf', 'from'); bind('pt', 'to'); bind('ps', 'status'); bind('pk', 'kind'); bind('pg', 'gw'); bind('rs', 'rs');
        $('#pclr', main).onclick = () => { Object.assign(F, { q: '', status: '', kind: '', gw: '', from: '', to: '', rs: 'open' }); draw(); };
        $('#pcsv', main).onclick = () => F.tab === 'pay'
          ? csv('payments', ['التاريخ', 'العميل', 'البند', 'النوع', 'السعر', 'الخصم', 'رسوم البوابة', 'البوابة', 'الحالة', 'رقم الإيصال', 'المرجع'], payList().map((p) => [p.created_at.slice(0, 10), (p.profiles && p.profiles.full_name) || '', itemOf(p), ({ subscription: 'اشتراك', interactive_course: 'دورة تفاعلية', consultation: 'استشارة' })[p.purpose] || p.purpose, p.amount_egp, p.discount_egp || 0, p.fee_egp || 0, D.gw[p.gateway] || p.gateway, ({ paid: 'مدفوع', pending: 'بانتظار الدفع', failed: 'فشل', refunded: 'مسترد' })[p.status] || p.status, p.receipt_no || '', p.manual_ref || p.gateway_ref || '']))
          : csv('refunds', ['تاريخ الطلب', 'الطالب', 'البريد الإلكتروني', 'الدورة', 'المبلغ', 'السبب', 'ملاحظة الطالب', 'الحالة', 'ردّك'], refList().map((r) => { const p = payById[r.payload && r.payload.payment_id], pl = r.payload || {}; return [r.created_at.slice(0, 10), r.name, r.email, pl.item || itemOf(p), p ? p.amount_egp : pl.amount_egp || '', pl.reason || '', pl.note || '', { new: 'جديد', in_review: 'قيد المراجعة', accepted: 'تم الاسترداد', rejected: 'مرفوض' }[r.status] || r.status, pl.decision_note || '']; }));
        $$('[data-goref]', main).forEach((b) => (b.onclick = () => { F.tab = 'ref'; F.rs = 'open'; draw(); const c = $(`[data-ref="${b.dataset.goref}"]`, main); if (c) { c.scrollIntoView({ block: 'center' }); c.classList.add('bx-flash'); } }));
        $$('[data-proof]', main).forEach((b) => (b.onclick = async () => {
          const w = window.open('', '_blank');   // opened on click so the popup isn't blocked
          try { const u = await sb.storage.signedUrl('payment-proofs', b.dataset.proof, 600); if (w) w.location.href = u; else location.href = u; }
          catch (e) { if (w) w.close(); ui.toast(arErr(e), 'err'); }
        }));
        $$('[data-ma],[data-mr]', main).forEach((b) => (b.onclick = async () => {
          const ok = !!b.dataset.ma, id = b.dataset.ma || b.dataset.mr;
          if (!confirm(ok ? 'تأكيد وصول التحويل وتفعيل الاشتراك/التسجيل؟' : 'رفض هذا التحويل؟')) return;
          try { await sb.rpc('admin_review_manual', { p_payment: id, p_approve: ok }); ui.toast(ok ? 'تم التأكيد والتفعيل.' : 'تم الرفض.'); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); }
        }));
        $$('[data-rf]', main).forEach((b) => (b.onclick = async () => {
          if (!confirm('تنفيذ الاسترداد وإلغاء تسجيل الطالب في الدورة؟')) return;
          b.disabled = true;
          try { if (!(await runRefund(b.dataset.rf))) { b.disabled = false; return; } ui.toast('تم الاسترداد.'); D.reload(); }
          catch (e) { b.disabled = false; ui.toast((e.data && e.data.error) || arErr(e), 'err'); }
        }));
        $$('[data-ract]', main).forEach((b) => (b.onclick = async () => {
          const r = refs.find((x) => x.id === b.closest('[data-ref]').dataset.ref), act = b.dataset.ract, pid = r.payload.payment_id;
          if (act === 'reject') return rejectModal(r);
          b.disabled = true;
          try {
            if (act === 'refund') {
              if (!confirm(`تنفيذ استرداد ${D.money(payById[pid].amount_egp)} لـ ${r.name} وإلغاء تسجيله في الدورة؟`)) { b.disabled = false; return; }
              if (!(await runRefund(pid))) { b.disabled = false; return; }
              await setReqStatus(r.id, 'accepted'); ui.toast('تم الاسترداد وإلغاء التسجيل، وسيصل الطالب بريد إلكتروني.'); D.reload(); return;
            }
            if (act === 'close') { await setReqStatus(r.id, 'accepted'); r.status = 'accepted'; ui.toast('تم إغلاق الطلب.'); }
            else { await setReqStatus(r.id, act); r.status = act; }
            D.setBadge('payments', refs.filter(openRef).length); draw();
          } catch (e) { b.disabled = false; ui.toast((e.data && e.data.error) || arErr(e), 'err'); }
        }));
      }
      async function runRefund(pid) {
        const res = await doRefund(pid);
        if (res.manual) {
          if (!confirm('هذه البوابة لا تدعم الاسترداد الآلي. هل أعدت المبلغ للطالب من لوحة البوابة أو بتحويل؟')) return false;
          await sb.fn('refund-payment', { payment_id: pid, manual_confirmed: true });
        }
        const rq = refByPay[pid]; if (rq && openRef(rq)) await setReqStatus(rq.id, 'accepted').catch(() => {});
        return true;
      }
      function rejectModal(r) {
        ui.modal(`<h3>رفض طلب الاسترداد</h3><p class="bx-hint">${esc(r.name)} · ${esc((r.payload && r.payload.item) || '')}</p>
          <div class="bx-field"><label for="rjn">سبب الرفض (سيصل إلى الطالب في البريد الإلكتروني)</label><textarea id="rjn" class="bx-textarea" rows="3" placeholder="مثال: انتهت مهلة الأيام السبعة، أو حضر أكثر من نصف الدورة."></textarea></div>
          <div class="bx-formmsg" aria-live="polite"></div><div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-ok>رفض الطلب</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`, (m, close) => {
          $('[data-x]', m).onclick = close;
          $('[data-ok]', m).onclick = async (e) => {
            const note = $('#rjn', m).value.trim(); e.target.disabled = true;
            try {
              const payload = Object.assign({}, r.payload, note ? { decision_note: note } : {});
              await sb.update('requests', { id: 'eq.' + r.id }, { payload, status: 'rejected' });
              Object.assign(r, { payload, status: 'rejected' }); close(); ui.toast('تم رفض الطلب وأُرسل للطالب بريد إلكتروني.');
              D.setBadge('payments', refs.filter(openRef).length); draw();
            } catch (x) { e.target.disabled = false; say($('.bx-formmsg', m), arErr(x), 'err'); }
          };
        });
      }
      draw();
    },

    async payouts(main) {
      const [rows, pools] = await Promise.all([sb.get('payouts', { select: '*,profiles(full_name)', order: 'requested_at.desc' }), sb.get('month_pools', { select: '*', order: 'month.desc', limit: 12 })]);
      main.innerHTML = D.panel('طلبات سحب المحاضرين', D.table(['التاريخ', 'المحاضر', 'المبلغ', 'وسيلة الاستلام', 'الحالة', ''], rows.map((p) => [D.date(p.requested_at), esc((p.profiles && p.profiles.full_name) || '—'), D.money(p.amount_egp), `<span style="white-space:pre-wrap">${esc(p.method)}</span>`, D.badge('payout', p.status), isAdmin() ? (p.status === 'requested' ? `<button class="bx-linkbtn" data-po="${p.id}" data-s="approved">اعتماد</button> · <button class="bx-linkbtn" data-po="${p.id}" data-s="rejected">رفض</button>` : p.status === 'approved' ? `<button class="bx-linkbtn" data-po="${p.id}" data-s="paid">تم التحويل</button>` : '') : '']), 'لا توجد طلبات سحب'))
        + D.panel('إقفال الأرباح الشهرية', `<p class="bx-hint" style="margin-top:0">يحدث الإقفال تلقائيًا أول كل شهر (الشهر السابق). يمكنك تشغيله يدويًا لشهر محدد، ولا يكرر الحساب لشهر مُقفل.</p>
          ${isAdmin() ? `<div class="bx-btnrow"><input id="cm" class="bx-input" type="month" style="max-width:200px" aria-label="الشهر"><button class="bs-btn bs-btn-secondary bs-btn-sm" id="cmb">إقفال الشهر</button></div><div class="bx-formmsg" id="cmm" aria-live="polite"></div>` : ''}
          ${D.table(['الشهر', 'دخل الاشتراكات', 'المشاهدات المعتمدة', 'نسبة المحاضر'], pools.map((m) => [D.month(m.month), D.money(m.subscription_income), m.total_views, Number(m.instructor_pct) + '٪']), 'لم يُقفل أي شهر بعد')}`);
      $$('[data-po]', main).forEach((b) => (b.onclick = async () => {
        const patch = { status: b.dataset.s }; if (b.dataset.s === 'paid') patch.paid_at = new Date().toISOString();
        try {
          await sb.update('payouts', { id: 'eq.' + b.dataset.po }, patch);
          if (b.dataset.s === 'rejected') await sb.update('earnings', { payout_id: 'eq.' + b.dataset.po }, { payout_id: null });
          ui.toast('تم التحديث.'); D.reload();
        } catch (e) { ui.toast(arErr(e), 'err'); }
      }));
      const cb = $('#cmb', main); if (cb) cb.onclick = async () => {
        const v = $('#cm', main).value, m = $('#cmm', main); if (!v) return say(m, 'اختر الشهر.', 'err');
        if (new Date(v + '-01') >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)) return say(m, 'لا يمكن إقفال الشهر الحالي قبل انتهائه.', 'err');
        try { await sb.rpc('close_month', { p_month: v + '-01' }); say(m, 'تم إقفال الشهر.', 'ok'); D.reload(); } catch (e) { say(m, arErr(e), 'err'); }
      };
    },

    async coupons(main) {
      const [pend, rows, paid, insts] = await Promise.all([sb.get('requests', { select: '*', type: 'eq.promo_request', status: 'in.(new,in_review)', order: 'created_at.asc' }).catch(() => []), sb.get('coupons', { select: '*', order: 'created_at.desc' }).catch(() => []), sb.get('payments', { select: 'coupon_id', status: 'eq.paid', coupon_id: 'not.is.null' }).catch(() => []), sb.rpc('admin_users').then((u) => u.filter((x) => x.role === 'instructor')).catch(() => [])]);
      const iname = Object.fromEntries(insts.map((i) => [i.id, i.full_name || i.email]));
      const used = {}; paid.forEach((p) => (used[p.coupon_id] = (used[p.coupon_id] || 0) + 1));
      const scope = { any: 'الكل', subscription: 'الاشتراكات', interactive_course: 'الدورات التفاعلية' };
      const off = (c) => (c.percent_off ? c.percent_off + '٪' : D.money(c.amount_off_egp));
      main.innerHTML = (pend.length ? D.panel(`طلبات أكواد من المحاضرين (${pend.length})`, pend.map((q) => `<div class="bx-promoreq" data-q="${q.id}" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px"><b>${esc(q.name || q.email)}</b> <small class="bx-hint">${esc(q.email || '')} · ${D.date(q.created_at)}</small><div style="margin:6px 0">الكود المطلوب: <b class="bs-latin" style="font-size:18px">${esc((q.payload || {}).code || '')}</b>${(q.payload || {}).note ? `<br><small class="bx-hint">${esc(q.payload.note)}</small>` : ''}</div><div class="row2"><div class="bx-field"><label>خصم الطالب ٪</label><input class="bx-input" type="number" min="0" max="100" value="10" dir="ltr" data-po></div><div class="bx-field"><label>نسبة المحاضر ٪ (بدل 30٪ من المشاهدات)</label><input class="bx-input" type="number" min="0" max="100" value="50" dir="ltr" data-pi></div><div class="bx-field"><label>ملاحظة للمحاضر (اختياري)</label><input class="bx-input" data-pn maxlength="200"></div></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary bs-btn-sm" data-pd="1">اعتماد</button><button class="bs-btn bs-btn-secondary bs-btn-sm" data-pd="0">رفض</button></div></div>`).join('')) : '') + D.panel('كوبونات الخصم', `<p class="bx-hint" style="margin-top:0">الخصم يُحسب على سعر الباقة، وتُحسب أرباح المحاضرين على المبلغ بعد الخصم. كل عميل يستخدم الكود مرة واحدة.</p>` +
        (isAdmin() ? `<form class="bx-form2" id="cf" novalidate><div class="row2"><div class="bx-field"><label for="cc">الكود</label><input id="cc" class="bx-input" dir="ltr" placeholder="WELCOME20"></div><div class="bx-field"><label for="ct">النوع</label><select id="ct" class="bx-select"><option value="p">نسبة ٪</option><option value="a">مبلغ ثابت (ج.م)</option></select></div><div class="bx-field"><label for="cv">القيمة</label><input id="cv" class="bx-input" type="number" min="1" dir="ltr"></div></div><div class="row2"><div class="bx-field"><label for="cs">ينطبق على</label><select id="cs" class="bx-select"><option value="any">الكل</option><option value="subscription">الاشتراكات</option><option value="interactive_course">الدورات التفاعلية</option></select></div><div class="bx-field"><label for="cm">أقصى عدد استخدامات (اختياري)</label><input id="cm" class="bx-input" type="number" min="1" dir="ltr"></div><div class="bx-field"><label for="ce">ينتهي في (اختياري)</label><input id="ce" class="bx-input" type="date" dir="ltr"></div></div><div class="row2"><div class="bx-field"><label for="ci">كود محاضر؟ (اختياري)</label><select id="ci" class="bx-select"><option value="">لا، كود عام للمنصة</option>${insts.map((i) => `<option value="${i.id}">${esc(i.full_name || i.email)}</option>`).join('')}</select></div><div class="bx-field"><label for="cip">نسبة المحاضر (بدل الـ 30٪ من المشاهدات)</label><input id="cip" class="bx-input" type="number" min="0" max="100" value="50" dir="ltr"></div></div><p class="bx-hint" style="margin:0">كود المحاضر: في الوضع العادي يحصل المحاضر على 30٪ من قيمة المشاهدات. أما أي اشتراك في باقة بهذا الكود فيحصل المحاضر عنه على هذه النسبة (50٪ افتراضيًا) من قيمة الاشتراك بدلًا من الـ 30٪ من المشاهدات، ولا يدخل هذا الاشتراك في توزيع المشاهدات. يمكنك جعل الخصم للطالب صغيرًا (مثلًا 10٪) لتشجيعه.</p><div class="bx-formmsg" id="cmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">إضافة كوبون</button></div></form><hr style="border:none;border-top:1px solid var(--line);margin:20px 0">` : '') +
        D.table(['الكود', 'الخصم', 'ينطبق على', 'المحاضر', 'الاستخدام', 'ينتهي', 'مفعّل'], rows.map((c) => [`<b class="bs-latin">${esc(c.code)}</b>`, off(c), scope[c.applies_to], c.instructor_id ? `${esc(iname[c.instructor_id] || 'محاضر')}<br><small class="bx-hint">${Number(c.instructor_pct)}٪ بدل الـ 30٪ من المشاهدات</small>` : '—', `${used[c.id] || 0}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}`, c.expires_at ? D.date(c.expires_at) : '—', `<input type="checkbox" data-ca="${c.id}" ${c.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}>`]), 'لا توجد كوبونات بعد'));
      $$('[data-pd]', main).forEach((b) => (b.onclick = async () => {
        const box = b.closest('[data-q]'), ok = b.dataset.pd === '1';
        if (!ok && !confirm('رفض هذا الطلب؟')) return;
        $$('[data-pd]', box).forEach((x) => (x.disabled = true));
        try { await sb.rpc('decide_promo_request', { p_request: box.dataset.q, p_approve: ok, p_percent_off: Number($('[data-po]', box).value) || 0, p_instructor_pct: Number($('[data-pi]', box).value) || 0, p_note: $('[data-pn]', box).value.trim() || null }); ui.toast(ok ? 'تم اعتماد الكود وإنشاء الكوبون.' : 'تم رفض الطلب.'); D.reload(); }
        catch (err) { $$('[data-pd]', box).forEach((x) => (x.disabled = false)); ui.toast(/code taken/.test(err.message) ? 'هذا الكود موجود بالفعل ككوبون.' : arErr(err), 'err'); }
      }));
      const f = $('#cf', main);
      if (f) f.onsubmit = async (e) => {
        e.preventDefault(); const msg = $('#cmsg', main), code = $('#cc', f).value.trim().toUpperCase(), v = Number($('#cv', f).value), pct = $('#ct', f).value === 'p';
        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return say(msg, 'الكود: حروف إنجليزية وأرقام فقط (3 إلى 30).', 'err');
        if (!(v > 0) || (pct && v > 100)) return say(msg, 'قيمة الخصم غير صحيحة.', 'err');
        const row = { code, applies_to: $('#cs', f).value, [pct ? 'percent_off' : 'amount_off_egp']: v };
        if ($('#cm', f).value) row.max_redemptions = Number($('#cm', f).value);
        if ($('#ci', f).value) { const ip = Number($('#cip', f).value); if (!(ip >= 0 && ip <= 100)) return say(msg, 'يجب أن تكون نسبة المحاضر بين 0 و100.', 'err'); row.instructor_id = $('#ci', f).value; row.instructor_pct = ip; }
        if ($('#ce', f).value) row.expires_at = new Date($('#ce', f).value + 'T23:59:59+02:00').toISOString();
        try { await sb.insert('coupons', row); ui.toast('تمت إضافة الكوبون.'); D.reload(); } catch (err) { say(msg, /duplicate|unique/i.test(err.message) ? 'هذا الكود موجود بالفعل.' : arErr(err), 'err'); }
      };
      $$('[data-ca]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('coupons', { id: 'eq.' + i.dataset.ca }, { active: i.checked }); ui.toast('تم التحديث.'); } catch (err) { i.checked = !i.checked; ui.toast(arErr(err), 'err'); } }));
    },

    async instructors(main) {
      const rows = await sb.get('featured_instructors', { select: '*', order: 'sort.asc,created_at.asc' }).catch(() => []);
      const FAC = window.FACULTIES || [], fname = (id) => (FAC.find((f) => f.id === id) || {}).name || '—';
      const av = (i) => i.photo_url ? `<img src="${esc(i.photo_url)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : `<span style="width:36px;height:36px;border-radius:50%;display:inline-grid;place-items:center;background:var(--surface-raised);font-weight:700">${esc(window.instInitials ? window.instInitials(i.name) : '')}</span>`;
      main.innerHTML = D.panel('المحاضرين في الموقع', `<p class="bx-hint" style="margin-top:0">هؤلاء هم من يظهرون في الشريط المتحرك في الصفحة الرئيسية وفي صفحة المحاضرين، بالترتيب من الأصغر إلى الأكبر.</p>
        <div class="bx-btnrow" style="margin-bottom:12px">${isAdmin() ? '<button class="bs-btn bs-btn-primary" id="fi-new">إضافة محاضر</button>' : ''}<a class="bs-btn bs-btn-ghost" href="instructors.html" target="_blank" rel="noopener">عرض الصفحة</a></div>` +
        D.table(['', 'الاسم', 'الوصف', 'الكلية', 'الترتيب', 'ظاهر', ''], rows.map((i) => [av(i), `<b>${esc(i.name)}</b>`, `<small>${esc(i.title || '')}</small>`, esc(fname(i.faculty)), String(i.sort),
          `<input type="checkbox" data-fv="${i.id}" ${i.visible ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'} aria-label="ظاهر">`, isAdmin() ? `<button class="bx-linkbtn" data-fe="${i.id}">تعديل</button>` : ''])));
      const edit = (x) => {
        const isNew = !x; x = x || { name: '', title: '', photo_url: '', faculty: '', sort: (rows.length ? Math.max(...rows.map((r) => r.sort)) + 10 : 10), visible: true };
        ui.modal(`<h3>${isNew ? 'إضافة محاضر' : 'تعديل المحاضر'}</h3><form class="bx-form2" id="fif" novalidate>
          <div class="bx-field"><label for="fn">الاسم</label><input id="fn" class="bx-input" maxlength="80" value="${esc(x.name)}" placeholder="د. الاسم"></div>
          <div class="row2"><div class="bx-field"><label for="fne">الاسم بالإنجليزية</label><input id="fne" class="bx-input" dir="ltr" maxlength="80" value="${esc(x.name_en || '')}" placeholder="Dr. Name"></div>
          <div class="bx-field"><label for="fsl">رابط صفحته (slug)</label><input id="fsl" class="bx-input" dir="ltr" maxlength="60" value="${esc(x.slug || '')}" placeholder="ahmed-said"><small class="bx-hint">صفحته: teacher-<b>slug</b>.html</small></div></div>
          <div class="bx-field"><label for="ft">المسمى الوظيفي والجهة</label><textarea id="ft" class="bx-textarea" rows="2" maxlength="240">${esc(x.title || '')}</textarea></div>
          <div class="row2"><div class="bx-field"><label for="fdg">الدرجة العلمية</label><input id="fdg" class="bx-input" maxlength="120" value="${esc(x.degree || '')}" placeholder="دكتوراه الباثولوجيا الإكلينيكية"></div>
          <div class="bx-field"><label for="fsp">التخصص</label><input id="fsp" class="bx-input" maxlength="160" value="${esc(x.specialty || '')}"></div></div>
          <div class="bx-field"><label for="fbi">نبذة تعريفية</label><textarea id="fbi" class="bx-textarea" rows="3" maxlength="1500">${esc(x.bio || '')}</textarea></div>
          <div class="bx-field"><label for="fex">الخبرات والمؤهلات (سطر لكل خبرة)</label><textarea id="fex" class="bx-textarea" rows="4" maxlength="3000">${esc(x.experience || '')}</textarea></div>
          <div class="bx-field"><label for="fpb">الأبحاث والمنشورات (سطر لكل بحث، اختياري)</label><textarea id="fpb" class="bx-textarea" rows="2" maxlength="3000">${esc(x.publications || '')}</textarea></div>
          <div class="bx-field"><label for="flk">روابط الحسابات الأكاديمية (سطر لكل رابط https، اختياري)</label><textarea id="flk" class="bx-textarea" rows="2" dir="ltr" maxlength="1500" placeholder="https://scholar.google.com/…">${esc(x.links || '')}</textarea></div>
          <small class="bx-hint">تُنشأ له صفحة مستقلة قابلة للفهرسة عندما تكون له نبذة أو مسمى كامل ودورة منشورة واحدة على الأقل. اكتب البيانات الحقيقية فقط.</small>
          <div class="row2"><div class="bx-field"><label for="ff">الكلية</label><select id="ff" class="bx-select"><option value="">—</option>${FAC.map((f) => `<option value="${f.id}" ${f.id === x.faculty ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
          <div class="bx-field"><label for="fs">الترتيب</label><input id="fs" class="bx-input" type="number" dir="ltr" value="${x.sort}"></div></div>
          <div class="bx-field"><label for="fpf">الصورة (اختياري)</label>${x.photo_url ? `<img src="${esc(x.photo_url)}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover">` : ''}<input id="fpf" type="file" accept="image/png,image/jpeg,image/webp" class="bx-input"><small class="bx-hint">ستظهر أداة لقص الصورة مربعة (500 × 500). إذا لم توجد صورة فسيظهر أول حرفين من الاسم.</small>
            <div class="bx-field"><label for="fpa">النص البديل للصورة (Alt)</label><input id="fpa" class="bx-input" maxlength="160" value="${esc(x.photo_alt || '')}" placeholder="صورة ${esc(x.name || 'المحاضر')}"></div>
            <div class="bx-btnrow" style="margin-top:6px;align-items:center"><small class="bx-hint" style="margin:0">أو استخدم صورة رمزية:</small><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-av="male">رجل</button><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-av="female">امرأة</button></div>
            <input type="hidden" id="fpu" value="${esc(x.photo_url || '')}">${x.photo_url ? `<label class="bx-hint" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="fpr"> حذف الصورة الحالية</label>` : ''}</div>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fvv" ${x.visible ? 'checked' : ''}> ظاهر في الموقع</label>
          <div class="bx-formmsg" aria-live="polite"></div>
          <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button>${isNew ? '' : '<button type="button" class="bs-btn bs-btn-ghost" data-del style="color:var(--danger-text)">حذف</button>'}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
        (m, close) => {
          $('[data-x]', m).onclick = close;
          $$('[data-av]', m).forEach((b) => (b.onclick = () => { $('#fpu', m).value = `https://biosyneg.com/img/avatars/${b.dataset.av}.svg`; $('#fpf', m).value = ''; const r = $('#fpr', m); if (r) r.checked = false; ui.toast('تم اختيار الصورة الرمزية. اضغط «حفظ».'); }));
          const del = $('[data-del]', m); if (del) del.onclick = async () => { if (!confirm('حذف المحاضر من الموقع؟')) return; try { await sb.remove('featured_instructors', { id: 'eq.' + x.id }); close(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); } };
          $('#fif', m).onsubmit = async (e) => {
            e.preventDefault(); const msg = $('.bx-formmsg', m), btn = $('button[type=submit]', m);
            const name = $('#fn', m).value.trim(); if (name.length < 2) return say(msg, 'اكتب اسم المحاضر.', 'err');
            const tv = (id) => ($('#' + id, m).value || '').trim() || null;
            const slug = (tv('fsl') || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null;
            const links = (tv('flk') || '').split('\n').map((l) => l.trim()).filter(Boolean);
            if (links.some((l) => !/^https:\/\//.test(l))) return say(msg, 'كل رابط يجب أن يبدأ بـ https://', 'err');
            const row = { name, title: tv('ft'), faculty: $('#ff', m).value || null, sort: Number($('#fs', m).value) || 100, visible: $('#fvv', m).checked, photo_url: $('#fpu', m).value || null,
              name_en: tv('fne'), slug, degree: tv('fdg'), specialty: tv('fsp'), bio: tv('fbi'), experience: tv('fex'), publications: tv('fpb'), links: links.join('\n') || null, photo_alt: tv('fpa') };
            if ($('#fpr', m) && $('#fpr', m).checked) row.photo_url = null;
            const file = $('#fpf', m).files[0];
            btn.disabled = true;
            try {
              if (file) {
                if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('يجب أن تكون الصورة PNG أو JPG أو WebP.');
                const blob = window.cropImage ? await window.cropImage(file, { w: 500, h: 500 }) : file;
                if (!blob) { btn.disabled = false; return; }
                say(msg, 'جارٍ رفع الصورة…');
                row.photo_url = window.uploadCropped ? await window.uploadCropped(blob, 'instructors') : null;
              }
              if (isNew) await sb.insert('featured_instructors', row); else await sb.update('featured_instructors', { id: 'eq.' + x.id }, row);
              ui.toast('تم الحفظ.'); close(); D.reload();
            } catch (err) { btn.disabled = false; say(msg, err.message && /[\u0600-\u06FF]/.test(err.message) ? err.message : arErr(err), 'err'); }
          };
        });
      };
      const nb = $('#fi-new', main); if (nb) nb.onclick = () => edit(null);
      $$('[data-fe]', main).forEach((b) => (b.onclick = () => edit(rows.find((r) => r.id === b.dataset.fe))));
      $$('[data-fv]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('featured_instructors', { id: 'eq.' + i.dataset.fv }, { visible: i.checked }); ui.toast('تم التحديث.'); } catch (err) { i.checked = !i.checked; ui.toast(arErr(err), 'err'); } }));
    },

    async proposals(main) {
      const [ps, ls] = await Promise.all([sb.get('course_proposals', { select: '*', status: 'neq.draft', order: 'submitted_at.desc' }).catch(() => []), sb.get('proposal_lessons', { select: 'id,proposal_id,uploaded,video_url' }).catch(() => [])]);
      const ST = { submitted: ['جديد', 'warn'], in_review: ['قيد المراجعة', 'info'], accepted: ['مقبول', 'ok'], rejected: ['مرفوض', 'danger'] };
      const cnt = (id) => { const l = ls.filter((x) => x.proposal_id === id); return `${l.length} درس · ${l.filter((x) => x.uploaded || x.video_url).length} بفيديو`; };
      D.setBadge('proposals', ps.filter((p) => p.status === 'submitted').length);
      main.innerHTML = D.panel('دورات مسجلة مقدّمة من محاضرين', `<p class="bx-hint" style="margin-top:0">الدورات التي جهّزها المحاضرون من صفحة «انضم كمحاضر» ورفعوا فيديوهاتها على Bunny. افتح الطلب واطّلع على الفيديوهات، وإذا كان مناسبًا اضغط «قبول وتحويل إلى دورة» فتُنشأ دورة مسودة بالمحاضرات والفيديوهات جاهزة، ويتحوّل الحساب إلى حساب محاضر.</p>` +
        D.table(['الدورة', 'المحاضر', 'المحتوى', 'التاريخ', 'الحالة', ''], ps.map((p) => [`<b>${esc(p.title || '—')}</b><br><small class="bx-hint">${esc(p.specialty || '')}</small>`, `${esc(p.name || '')}<br><small class="bx-hint" dir="ltr">${esc(p.email || '')}</small>`, cnt(p.id), D.date(p.submitted_at || p.created_at), `<span class="bx-st bx-st-${(ST[p.status] || ['', 'mute'])[1]}">${(ST[p.status] || [p.status])[0]}</span>`, `<button class="bx-linkbtn" data-pp="${p.id}">فتح</button>`]), 'لا توجد دورات مقدّمة بعد.'));
      $$('[data-pp]', main).forEach((b) => (b.onclick = () => proposalModal(ps.find((p) => p.id === b.dataset.pp))));
    },

    async forms(main) {
      const [forms, subs, reqs] = await Promise.all([sb.get('forms', { select: '*', order: 'created_at.desc' }).catch(() => []), sb.get('form_submissions', { select: 'id,form_id,status' }).catch(() => []), sb.get('requests', { select: 'id,type,status' }).catch(() => [])]);
      const cnt = {}; subs.forEach((x) => { const c = (cnt[x.form_id] = cnt[x.form_id] || { all: 0, new: 0 }); c.all++; if (x.status === 'new') c.new++; });
      const base = location.href.replace(/admin(\.html)?([?#].*)?$/, '');
      const link = (f) => base + 'form.html?f=' + encodeURIComponent(f.slug);
      const rc = {}; reqs.forEach((r) => { const c = (rc[r.type] = rc[r.type] || { all: 0, new: 0 }); c.all++; if (r.status === 'new') c.new++; });
      const siteForms = SITE_FORMS.map((sf) => { const c = sf.types.reduce((a, t) => ({ all: a.all + ((rc[t] || {}).all || 0), new: a.new + ((rc[t] || {}).new || 0) }), { all: 0, new: 0 });
        return [`<b>${sf.title}</b><br><small class="bx-hint">نموذج ثابت في الموقع</small>`, `<a class="bx-linkbtn" href="${sf.page}" target="_blank" rel="noopener">فتح الصفحة</a>`, `${c.all}${c.new ? ` <span class="bx-st bx-st-warn">${c.new} جديد</span>` : ''}`, '<span class="bx-st bx-st-ok">يعمل</span>', `<button class="bx-linkbtn" data-sf="${sf.key}">الردود</button>`]; });
      main.innerHTML = D.panel('نماذج الموقع', D.table(['النموذج', 'الصفحة', 'الردود', 'الحالة', ''], siteForms)) + D.panel('النماذج والردود', `<p class="bx-hint" style="margin-top:0">أنشئ أي نموذج (تسجيل اهتمام، استبيان، طلب خدمة…) وخذ رابطه وانشره على وسائل التواصل أو واتساب. يصل كل رد إلى هنا وإلى بريد التنبيهات، وإذا تضمّن بريدًا إلكترونيًا أو رقم هاتف يُرسل إلى الـ CRM بوصفه Lead.</p>
        ${isAdmin() ? '<div class="bx-btnrow" style="margin-bottom:12px"><button class="bs-btn bs-btn-primary" id="fm-new">+ نموذج جديد</button></div>' : ''}` +
        D.table(['النموذج', 'الرابط', 'الردود', 'الحالة', ''], forms.map((f) => {
          const c = cnt[f.id] || { all: 0, new: 0 };
          return [`<b>${esc(f.title)}</b><br><small class="bx-hint">${(f.fields || []).length} حقل</small>`,
            `<button class="bx-linkbtn" data-copy="${esc(link(f))}">نسخ الرابط</button> · <a class="bx-linkbtn" href="${esc(link(f))}" target="_blank" rel="noopener">فتح</a>`,
            `${c.all}${c.new ? ` <span class="bx-st bx-st-warn">${c.new} جديد</span>` : ''}`,
            `<label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-fa="${f.id}" ${f.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> ${f.active ? 'مفتوح' : 'مقفول'}</label>`,
            `<button class="bx-linkbtn" data-fr="${f.id}">الردود</button>${isAdmin() ? ` · <button class="bx-linkbtn" data-fe="${f.id}">تعديل</button> · <button class="bx-linkbtn" data-fs="${f.id}">مشاركة</button>` : ''}`];
        }), 'لا توجد نماذج بعد. اضغط «نموذج جديد».'));
      $$('[data-copy]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); ui.toast('تم نسخ الرابط.'); } catch { prompt('انسخ الرابط:', b.dataset.copy); } }));
      $$('[data-fa]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('forms', { id: 'eq.' + i.dataset.fa }, { active: i.checked }); ui.toast(i.checked ? 'النموذج مفتوح.' : 'تم إغلاق النموذج.'); D.reload(); } catch (err) { i.checked = !i.checked; ui.toast(arErr(err), 'err'); } }));
      const nb = $('#fm-new', main); if (nb) nb.onclick = () => formBuilder(null);
      $$('[data-fe]', main).forEach((b) => (b.onclick = () => formBuilder(forms.find((f) => f.id === b.dataset.fe))));
      $$('[data-fr]', main).forEach((b) => (b.onclick = () => formResponses(forms.find((f) => f.id === b.dataset.fr))));
      $$('[data-fs]', main).forEach((b) => (b.onclick = () => window.FormsUI.share(forms.find((f) => f.id === b.dataset.fs))));
      $$('[data-sf]', main).forEach((b) => (b.onclick = () => siteFormResponses(SITE_FORMS.find((x) => x.key === b.dataset.sf))));
    },

    async blog(main) {
      const posts = await sb.get('posts', { select: '*', order: 'created_at.desc' }).catch(() => []);
      main.innerHTML = D.panel('المدونة', D.table(['العنوان', 'التصنيف', 'الحالة', 'التاريخ', ''], posts.map((x) => [esc(x.title), esc(x.tag || '—'), x.published ? 'منشور' : 'مسودة', D.date(x.published_at || x.created_at), `<button class="bx-linkbtn" data-pe="${x.id}">تعديل</button>${x.published ? ` · <a class="bx-link" href="article.html?p=${encodeURIComponent(x.slug)}" target="_blank">عرض</a>` : ''}`]), 'لا توجد مقالات بعد'), isAdmin() ? '<button class="bs-btn bs-btn-primary bs-btn-sm" id="newp">مقال جديد</button>' : '');
      const edit = (x) => {
        const isNew = !x; x = x || { title: '', slug: '', excerpt: '', body: '', tag: '', published: false };
        ui.modal(`<h3>${isNew ? 'مقال جديد' : 'تعديل المقال'}</h3><form class="bx-form2" id="pf2" novalidate>
          <div class="bx-field"><label for="pt">العنوان</label><input id="pt" class="bx-input" value="${esc(x.title)}"></div>
          <div class="row2"><div class="bx-field"><label for="ps">الرابط (slug)</label><input id="ps" class="bx-input" dir="ltr" value="${esc(x.slug)}"></div><div class="bx-field"><label for="pg">التصنيف</label><input id="pg" class="bx-input" value="${esc(x.tag || '')}" placeholder="أخبار، مقال علمي…"></div></div>
          <div class="bx-field"><label for="px">مقدمة قصيرة</label><textarea id="px" class="bx-textarea" rows="2">${esc(x.excerpt || '')}</textarea></div>
          <div class="bx-field"><label for="pb">المحتوى</label><textarea id="pb" class="bx-textarea" rows="12" placeholder="اكتب الفقرات مفصولة بسطر فارغ. ## للعنوان الفرعي، و - لبند في قائمة.">${esc(x.body || '')}</textarea></div>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pp2" ${x.published ? 'checked' : ''}> منشور</label>
          <div class="bx-formmsg" aria-live="polite"></div>
          <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button>${isNew ? '' : '<button type="button" class="bs-btn bs-btn-ghost" data-del style="color:var(--danger-text)">حذف</button>'}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
        (m, close) => {
          $('[data-x]', m).onclick = close;
          const t = $('#pt', m), s = $('#ps', m);
          if (isNew) t.oninput = () => (s.value = slugify(t.value));
          const del = $('[data-del]', m); if (del) del.onclick = async () => { if (!confirm('حذف المقال نهائيًا؟')) return; try { await sb.remove('posts', { id: 'eq.' + x.id }); close(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); } };
          $('#pf2', m).onsubmit = async (e) => {
            e.preventDefault(); const msg = $('.bx-formmsg', m);
            const row = { title: t.value.trim(), slug: s.value.trim(), tag: $('#pg', m).value.trim() || null, excerpt: $('#px', m).value.trim() || null, body: $('#pb', m).value, published: $('#pp2', m).checked };
            if (!row.title || !row.slug) return say(msg, 'العنوان والرابط مطلوبان.', 'err');
            if (!/^[a-z0-9\u0600-\u06ff-]+$/.test(row.slug)) return say(msg, 'الرابط: حروف صغيرة وأرقام وشرطات فقط.', 'err');
            try { if (isNew) await sb.insert('posts', { ...row, author_id: sb.user.id }); else await sb.update('posts', { id: 'eq.' + x.id }, row); close(); ui.toast('تم الحفظ.'); D.reload(); }
            catch (err) { say(msg, /duplicate|unique/i.test(err.message) ? 'هذا الرابط مستخدم لمقال آخر.' : arErr(err), 'err'); }
          };
        });
      };
      const np = $('#newp', main); if (np) np.onclick = () => edit(null);
      $$('[data-pe]', main).forEach((b) => (b.onclick = () => edit(posts.find((x) => x.id === b.dataset.pe))));
    },

    async integrations(main) {
      let st = { status: {}, crm: {}, crm_last: null, functions_base: BIOSYN.SUPABASE_URL + '/functions/v1' };
      try { st = await sb.fn('integrations'); } catch (e) { ui.toast(arErr(e), 'err'); }
      const S = st.status || {}, W = st.functions_base;
      const on = (keys) => keys.every((k) => S[k]);
      const badge = (keys) => on(keys) ? '<span class="bs-badge bs-badge-new">متصل</span>' : keys.some((k) => S[k]) ? '<span class="bs-badge bs-badge-neutral">ناقص</span>' : '<span class="bs-badge bs-badge-neutral">غير مفعّل</span>';
      const field = (k, label, ph, type) => `<div class="bx-field"><label for="ik-${k}">${label}${S[k] ? ` <small class="bx-hint">· ${S[k] === 'env' ? 'مضبوط في Supabase' : 'محفوظ ✓'}</small>` : ''}</label><input id="ik-${k}" data-key="${k}" class="bx-input" dir="ltr" type="${type || 'password'}" autocomplete="off" placeholder="${S[k] ? '•••••••• (اتركه فارغًا للإبقاء عليه)' : esc(ph || '')}"></div>`;
      const hook = (name) => `<div class="bx-field"><label>رابط الإشعارات (Webhook) — انسخه في لوحة البوابة</label><div style="display:flex;gap:8px"><input class="bx-input" dir="ltr" readonly value="${esc(W + '/' + name)}" style="flex:1"><button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" data-copy="${esc(W + '/' + name)}">نسخ</button></div></div>`;
      const card = (id, title, desc, required, body, extra) => `<section class="bx-panel bx-intg" data-intg="${id}"><div class="bx-panel-head"><h3>${title}</h3>${badge(required)}</div><p class="bx-hint" style="margin-top:0">${desc}</p><form class="bx-form2" novalidate>${body}<div class="bx-formmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary bs-btn-sm" type="submit">حفظ</button>${on(required) ? '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-clear>فصل الربط</button>' : ''}${extra || ''}</div></form></section>`;
      const fee = (g) => `<div class="row2">${field('FEE_' + g + '_PCT', 'رسوم البوابة ٪ (تُضاف على العميل)', 'مثال: 2.75', 'text')}${field('FEE_' + g + '_FIXED', 'رسوم ثابتة لكل عملية (ج.م)', 'مثال: 3', 'text')}</div>`;
      const crm = st.crm || {};
      main.innerHTML = `<p class="bx-hint" style="margin-top:0">اربط خدماتك من هنا مباشرة. المفاتيح تُحفظ مشفّرة في قاعدة بياناتك ولا يمكن قراءتها من المتصفح بعد الحفظ؛ يظهر فقط أنها محفوظة. لتغيير مفتاح اكتب الجديد واحفظ.</p>
        <div class="bx-intg-grid">
        ${card('paymob', 'Paymob — بطاقات ومحافظ (فودافون كاش وغيرها)', 'من لوحة Paymob: Settings ← Account Info (Secret / Public key)، وDevelopers ← HMAC، وأرقام الـIntegration لكل طريقة دفع (بطاقة، محفظة) مفصولة بفاصلة.', ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS'],
          `<div class="row2">${field('PAYMOB_SECRET_KEY', 'Secret key', 'egy_sk_live_…')}${field('PAYMOB_PUBLIC_KEY', 'Public key', 'egy_pk_live_…')}</div><div class="row2">${field('PAYMOB_HMAC_SECRET', 'HMAC secret', '')}${field('PAYMOB_INTEGRATION_IDS', 'Integration IDs', '123456, 234567', 'text')}</div>${fee('PAYMOB')}${hook('webhook-paymob')}`)}
        ${card('fawaterk', 'Fawaterk — فوري وبطاقات ومحافظ', 'من لوحة فواتيرك: Integrations ← API key. جرّب أولًا على حساب staging.', ['FAWATERK_API_KEY'],
          `<div class="row2">${field('FAWATERK_API_KEY', 'API key', '')}${field('FAWATERK_VENDOR_KEY', 'Vendor key (اختياري، للتوقيع)', '')}</div><div class="row2">${field('FAWATERK_BASE_URL', 'رابط الخادم (اختياري)', 'https://staging.fawaterk.com', 'text')}</div>${fee('FAWATERK')}${hook('webhook-fawaterk')}<p class="bx-hint">يُتحقق من كل دفعة مباشرةً لدى فواتيرك قبل التفعيل، فيعمل التفعيل حتى لو تأخر الـ webhook.</p>`)}
        ${card('stripe', 'Stripe — بطاقات دولية', 'من لوحة Stripe: Developers ← API keys (Secret key)، وWebhooks ← أضف الرابط بالأسفل مع حدث checkout.session.completed ثم انسخ Signing secret.', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
          `<div class="row2">${field('STRIPE_SECRET_KEY', 'Secret key', 'sk_live_…')}${field('STRIPE_WEBHOOK_SECRET', 'Webhook signing secret', 'whsec_…')}</div>${fee('STRIPE')}${hook('webhook-stripe')}`)}
        ${card('bunny', 'Bunny Stream — استضافة الفيديو', 'الأسهل: من Bunny افتح Account settings ← API وانسخ «API Key» الخاص بالحساب (Account API Key). يكفي هذا وحده لتتمكن المنصة من رؤية كل مكتباتك واستيراد الدورات منها ورفع فيديوهات جديدة. وفي Library ID اكتب رقم المكتبة التي تُرفع إليها الفيديوهات الجديدة (من المحاضرين ومنك).', ['BUNNY_ACCOUNT_KEY', 'BUNNY_LIBRARY_ID'],
          `<div class="row2">${field('BUNNY_ACCOUNT_KEY', 'Account API Key', '')}${field('BUNNY_LIBRARY_ID', 'Library ID (للرفع الجديد)', '614141', 'text')}</div><details><summary class="bx-hint">إعدادات اختيارية</summary><div class="row2">${field('BUNNY_API_KEY', 'API Key الخاص بالمكتبة (إذا لم تستخدم Account key)', '')}${field('BUNNY_TOKEN_KEY', 'Token authentication key (لو مفعّل في المكتبة)', '')}</div>${field('BUNNY_TOKEN_KEYS', 'مفاتيح حماية الفيديو لكل مكتبة بالشكل 614141=المفتاح. يمكنك إضافة مكتبة واحدة أو أكثر في كل مرة، وتبقى المفاتيح المحفوظة سابقًا كما هي (من Bunny ← المكتبة ← Security ← Token authentication key)', '614141=xxxxxxxx-xxxx')}</details>`)}
        ${card('resend', 'Resend — رسائل البريد في المنصة', 'من resend.com: API Keys، وفعّل دومين الإرسال من Domains. عنوان المرسل مثل: Biosyn Eg &lt;noreply@biosyneg.com&gt;', ['RESEND_API_KEY', 'MAIL_FROM'],
          `<div class="row2">${field('RESEND_API_KEY', 'API key', 're_…')}${field('MAIL_FROM', 'عنوان المرسل', 'Biosyn Eg <noreply@biosyneg.com>', 'text')}</div>`)}
        ${card('meta', 'Meta Pixel وGoogle Analytics — تتبع الإعلانات', 'رقم الـPixel من Events Manager، وتوكن Conversions API من إعدادات الـPixel (اختياري)، ومعرّف GA4 يبدأ بـ G-.', ['META_PIXEL_ID'],
          `<div class="row2">${field('META_PIXEL_ID', 'Pixel ID', '1234567890', 'text')}${field('META_CAPI_TOKEN', 'Conversions API token (اختياري)', '')}</div>${field('GA4_ID', 'Google Analytics 4 ID (اختياري)', 'G-XXXXXXX', 'text')}`)}
        ${card('claude', 'مساعد الدعم بالذكاء الاصطناعي (Claude)', 'مفتاح من console.anthropic.com. بمجرد الحفظ يظهر زر «مساعدة» للزوار ويرد من سياسات المنصة وباقاتها فقط.', ['ANTHROPIC_API_KEY'],
          `${field('ANTHROPIC_API_KEY', 'Anthropic API key', 'sk-ant-…')}`)}
        </div>
        <section class="bx-panel"><div class="bx-panel-head"><h3>Biosyn CRM</h3>${on(['CRM_URL', 'CRM_WOO_SECRET']) ? '<span class="bs-badge bs-badge-new">متصل</span>' : '<span class="bs-badge bs-badge-neutral">غير متصل</span>'}</div>
          <p class="bx-hint" style="margin-top:0">كل دفعة أو استرداد يدخل الـCRM تلقائيًا كعميل + عملية دخل، وكل طلب من نماذج الموقع يدخل كعميل محتمل مع مهمة متابعة. المزامنة كل 5 دقائق وفور كل دفعة.</p>
          <div class="bx-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">${D.stat('أُرسلت', crm.sent || 0)}${D.stat('في الانتظار', (crm.pending || 0) + (crm.sending || 0))}${D.stat('فشلت', crm.failed || 0)}</div>
          ${st.crm_last && st.crm_last.last_error ? `<p class="bx-formmsg err">آخر خطأ: ${esc(st.crm_last.last_error)}</p>` : ''}
          <div class="bx-btnrow" style="margin-top:12px"><button class="bs-btn bs-btn-secondary bs-btn-sm" id="crmsync" type="button">مزامنة الآن</button><a class="bs-btn bs-btn-ghost bs-btn-sm" href="https://abdomostafaramdan-ai.github.io/biosyn-crm/" target="_blank" rel="noopener">فتح الـCRM ↗</a></div></section>`;
      $$('[data-copy]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); ui.toast('تم النسخ.'); } catch { ui.toast(b.dataset.copy); } }));
      $$('.bx-intg form', main).forEach((f) => {
        f.onsubmit = async (e) => {
          e.preventDefault(); const msg = $('.bx-formmsg', f);
          const vals = $$('[data-key]', f).filter((i) => i.value.trim());
          if (!vals.length) return say(msg, 'اكتب قيمة واحدة على الأقل للحفظ.', 'err');
          try { for (const i of vals) await sb.rpc('set_integration_secret', { p_key: i.dataset.key, p_value: i.value.trim() }); ui.toast('تم الحفظ. التفعيل خلال دقيقة.'); D.reload(); }
          catch (err) { say(msg, arErr(err), 'err'); }
        };
        const clr = $('[data-clear]', f);
        if (clr) clr.onclick = async () => {
          if (!confirm('فصل هذا الربط وحذف المفاتيح المحفوظة له؟')) return;
          try { for (const i of $$('[data-key]', f)) await sb.rpc('set_integration_secret', { p_key: i.dataset.key, p_value: '' }); ui.toast('تم فصل الربط.'); D.reload(); } catch (err) { ui.toast(arErr(err), 'err'); }
        };
      });
      $('#crmsync', main).onclick = async (ev) => { ev.currentTarget.disabled = true; try { const r = await sb.fn('crm-sync'); ui.toast(r.skipped ? 'الـCRM غير متصل.' : `تمت المزامنة: ${r.sent} أُرسلت${r.failed ? '، ' + r.failed + ' فشلت' : ''}.`); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); ev.currentTarget.disabled = false; } };
    },

    async settings(main) {
      const [rows, mr] = await Promise.all([sb.get('app_settings', { select: '*' }).catch(() => []), sb.get('site_content', { select: 'data', key: 'eq.maintenance' }).catch(() => [])]); const v = Object.fromEntries(rows.map((r) => [r.key, r.value || '']));
      const mt = (mr[0] && mr[0].data) || {};
      main.innerHTML = D.panel('وضع الصيانة', `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;font-size:16px"><input type="checkbox" id="mton" ${mt.on ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'} style="width:22px;height:22px"> <span id="mtst">${mt.on ? '<span class="bx-st bx-st-warn">مفعّل: الزوار يرون صفحة الصيانة</span>' : '<span class="bx-st bx-st-ok">متوقف: المنصة تعمل طبيعيًا</span>'}</span></label></div><div class="bx-field" style="margin-top:12px"><label for="mtmsg">الرسالة التي تظهر للزوار (اختياري)</label><textarea id="mtmsg" class="bx-textarea" rows="2" maxlength="400" placeholder="نعمل حاليًا على تحسينات وإضافات جديدة، وسنعود خلال وقت قصير. شكرًا لصبرك.">${esc(mt.msg || '')}</textarea></div><p class="bx-hint" style="margin:0">أنت وفريق الدعم تظلون ترون الموقع كاملًا مع شريط صغير يذكّركم بأن الصيانة مفعّلة. صفحة تسجيل الدخول ولوحة الإدارة تبقى متاحة دائمًا.</p><div class="bx-formmsg" id="mtm" aria-live="polite"></div>`) + D.panel('الإعدادات', `<p class="bx-hint" style="margin-top:0">تنبيهات الفريق بالبريد تصلك عند كل دفعة وكل طلب جديد. رابط الموقع يُستخدم في أزرار رسائل البريد.</p><form class="bx-form2" id="sf" novalidate><div class="row2"><div class="bx-field"><label for="sn">بريد تنبيهات الفريق</label><input id="sn" class="bx-input" type="email" dir="ltr" value="${esc(v.notify_email || '')}"></div><div class="bx-field"><label for="su">رابط الموقع</label><input id="su" class="bx-input" type="url" dir="ltr" placeholder="https://biosyneg.com" value="${esc(v.site_url || '')}"></div></div><div class="row2"><div class="bx-field"><label for="si">حساب إنستاباي (للتحويل اليدوي)</label><input id="si" class="bx-input" dir="ltr" placeholder="name@instapay" value="${esc(v.instapay_handle || '')}"></div><div class="bx-field"><label for="sv">رقم فودافون كاش</label><input id="sv" class="bx-input" dir="ltr" placeholder="01xxxxxxxxx" value="${esc(v.vodafone_cash_number || '')}"></div></div><p class="bx-hint" style="margin:0">اترك الحقل فارغًا لإخفاء طريقة الدفع اليدوية من صفحة الدفع.</p><div class="bx-formmsg" id="smsg" aria-live="polite"></div>${isAdmin() ? '<div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button></div>' : ''}</form>` +
        '<hr style="border:none;border-top:1px solid var(--line);margin:20px 0"><h4 style="margin:0 0 8px">آخر رسائل البريد</h4><div id="ol"></div>');
      const out = await sb.get('email_outbox', { select: 'to_email,subject,status,created_at,last_error', order: 'created_at.desc', limit: 15 }).catch(() => []);
      $('#ol', main).innerHTML = D.table(['التاريخ', 'إلى', 'الموضوع', 'الحالة'], out.map((o) => [D.dateTime(o.created_at), `<span class="bs-latin">${esc(o.to_email)}</span>`, esc(o.subject), { sent: 'أُرسل', pending: 'في الانتظار', sending: 'جارٍ', failed: 'فشل' }[o.status] || o.status]), 'لا توجد رسائل بعد. (لن تُرسل الرسائل قبل ضبط مفاتيح خدمة البريد.)');
      const saveMt = async () => {
        const on = $('#mton', main).checked, data = { on, msg: $('#mtmsg', main).value.trim(), updated_at: new Date().toISOString() };
        if (on && !mt.on && !confirm('تفعيل وضع الصيانة؟ لن يتمكن الزوار والطلاب من استخدام المنصة حتى تُوقفه.')) { $('#mton', main).checked = false; return; }
        try {
          const r = await sb.update('site_content', { key: 'eq.maintenance' }, { data, updated_at: data.updated_at });
          if (!r.length) await sb.insert('site_content', { key: 'maintenance', data });
          mt.on = on; $('#mtst', main).innerHTML = on ? '<span class="bx-st bx-st-warn">مفعّل: الزوار يرون صفحة الصيانة</span>' : '<span class="bx-st bx-st-ok">متوقف: المنصة تعمل طبيعيًا</span>';
          try { localStorage.setItem('biosyn.maint', on ? '1' : '0'); } catch {}
          ui.toast(on ? 'تم تفعيل وضع الصيانة.' : 'تم إيقاف وضع الصيانة، المنصة متاحة للجميع.');
        } catch (err) { $('#mton', main).checked = !!mt.on; say($('#mtm', main), arErr(err), 'err'); }
      };
      $('#mton', main).onchange = saveMt;
      $('#mtmsg', main).onchange = () => { if (mt.on) saveMt(); };
      const f = $('#sf', main);
      f.onsubmit = async (e) => {
        e.preventDefault(); if (!isAdmin()) return; const msg = $('#smsg', main);
        try {
          await sb.update('app_settings', { key: 'eq.notify_email' }, { value: $('#sn', f).value.trim() || null });
          await sb.update('app_settings', { key: 'eq.site_url' }, { value: $('#su', f).value.trim().replace(/\/$/, '') || null });
          await sb.update('app_settings', { key: 'eq.instapay_handle' }, { value: $('#si', f).value.trim() || null });
          await sb.update('app_settings', { key: 'eq.vodafone_cash_number' }, { value: $('#sv', f).value.trim() || null });
          say(msg, 'تم الحفظ.', 'ok');
        } catch (err) { say(msg, arErr(err), 'err'); }
      };
    },

    async plans(main) {
      const plans = await sb.get('plans', { select: '*', order: 'duration_months' });
      main.innerHTML = D.panel('الباقات والأسعار', `<p class="bx-hint" style="margin-top:0">الأسعار تُقرأ من هنا في الموقع وصفحة الدفع. التغيير يسري على المدفوعات الجديدة فقط.</p>` + D.table(['الباقة', 'المدة', 'السعر (ج.م)', 'خارج مصر (بعملة البلد)', 'السعر السابق', 'مفعّلة', ''], plans.map((p) => [esc(p.name), p.duration_months + ' شهر', `<input class="bx-input" type="number" min="0" style="max-width:110px" value="${p.price_egp}" data-f="price_egp" data-p="${p.id}" ${isAdmin() ? '' : 'disabled'}>`, `<input class="bx-input" type="number" min="0" step="0.5" style="max-width:110px" value="${p.intl_price ?? ''}" placeholder="—" data-f="intl_price" data-p="${p.id}" ${isAdmin() ? '' : 'disabled'} aria-label="السعر خارج مصر">`, `<input class="bx-input" type="number" min="0" style="max-width:110px" value="${p.old_price_egp ?? ''}" data-f="old_price_egp" data-p="${p.id}" ${isAdmin() ? '' : 'disabled'}>`, `<input type="checkbox" data-f="active" data-p="${p.id}" ${p.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}>`, isAdmin() ? `<button class="bs-btn bs-btn-secondary bs-btn-sm" data-save="${p.id}">حفظ</button>` : '']), 'لا توجد باقات'));
      $$('[data-save]', main).forEach((b) => (b.onclick = async () => {
        const id = b.dataset.save, g = (f) => $(`[data-f="${f}"][data-p="${id}"]`, main);
        const price = Number(g('price_egp').value); if (!(price >= 0)) return ui.toast('سعر غير صحيح', 'err');
        try { await sb.update('plans', { id: 'eq.' + id }, { price_egp: price, intl_price: g('intl_price').value === '' ? null : Number(g('intl_price').value), old_price_egp: g('old_price_egp').value === '' ? null : Number(g('old_price_egp').value), active: g('active').checked }); ui.toast('تم حفظ الباقة.'); } catch (e) { ui.toast(arErr(e), 'err'); }
      }));
      await regionsPanel(main, plans);
    },
  };

  // ---------- prices outside Egypt: same number in local currency × factor ----------
  async function regionsPanel(main, plans) {
    const rows = await sb.get('price_regions', { select: '*', order: 'country' }).catch(() => []);
    rows.sort((a, b) => (a.country === '*') - (b.country === '*'));
    const monthly = (plans.find((p) => p.duration_months === 1) || plans[0] || { price_egp: 200 });
    const loc = (r) => (monthly.intl_price != null ? Number(monthly.intl_price) : Math.max(1, Math.round(Number(monthly.price_egp) * Number(r.factor))));
    const box = document.createElement('div');
    box.innerHTML = D.panel('الأسعار خارج مصر', `<p class="bx-hint" style="margin-top:0">يرى الزائر من خارج مصر السعر ويدفع بعملة بلده. <b>الباقات</b> تأخذ السعر الثابت الموجود في خانة «خارج مصر» أعلاه، بالرقم نفسه في كل العملات (مثلًا الشهري ${EGP(monthly.intl_price ?? 0)} ريال في السعودية و${EGP(monthly.intl_price ?? 0)} يورو في ألمانيا). <b>المعامل</b> يُطبَّق فقط على ما ليس له سعر ثابت خارج مصر (مثل دورة تفاعلية دون سعر دولي): السعر = سعر الجنيه × المعامل. و«سعر الصرف» يحوّل المبلغ المدفوع إلى الجنيه لحساب أرباح المحاضرين والتقارير. الدول غير الموجودة في الجدول تأخذ صف «باقي الدول». ويكون الدفع خارج مصر بالبطاقة عن طريق Stripe أو Fawaterk.</p>
      ${D.table(['الدولة', 'العملة', 'الرمز', 'المعامل', 'سعر الصرف (ج.م لكل وحدة)', 'الشهري بعملتهم', 'يساوي بالجنيه', 'مفعّل', ''], rows.map((r) => [
        `<b>${esc(r.name)}</b> <small class="bx-hint bs-latin">${r.country === '*' ? 'الباقي' : r.country}</small>`, `<span class="bs-latin">${esc(r.currency)}</span>`, esc(r.symbol),
        `<input class="bx-input" type="number" step="0.01" min="0.01" data-rf="factor" data-rc="${r.country}" value="${Number(r.factor)}" style="width:90px" aria-label="المعامل">`,
        `<input class="bx-input" type="number" step="0.01" min="0.01" data-rf="egp_rate" data-rc="${r.country}" value="${Number(r.egp_rate)}" style="width:110px" aria-label="سعر الصرف">`,
        `<b data-prev="${r.country}">${EGP(loc(r))} ${esc(r.symbol)}</b>`, `<span data-eq="${r.country}">${D.money(loc(r) * Number(r.egp_rate))}</span>`,
        `<input type="checkbox" data-rf="active" data-rc="${r.country}" ${r.active ? 'checked' : ''} aria-label="مفعّل">`,
        `<button class="bx-linkbtn" data-rsave="${r.country}">حفظ</button>`]), 'لا توجد دول مضافة')}
      <p class="bx-hint">إذا أغلقت دولة، يرى زوارها سعر «باقي الدول». وإذا أغلقت «باقي الدول» أيضًا يرون السعر بالجنيه المصري.</p>`);
    main.appendChild(box.firstElementChild);
    const v = (c, f) => $(`[data-rf="${f}"][data-rc="${CSS.escape(c)}"]`, main);
    $$('[data-rf="factor"],[data-rf="egp_rate"]', main).forEach((inp) => (inp.oninput = () => {
      const r = rows.find((x) => x.country === inp.dataset.rc), f = Number(v(r.country, 'factor').value) || 0, x = Number(v(r.country, 'egp_rate').value) || 0;
      const l = monthly.intl_price != null ? Number(monthly.intl_price) : Math.max(1, Math.round(Number(monthly.price_egp) * f));
      $(`[data-prev="${CSS.escape(r.country)}"]`, main).textContent = `${EGP(l)} ${r.symbol}`; $(`[data-eq="${CSS.escape(r.country)}"]`, main).textContent = D.money(l * x);
    }));
    $$('[data-rsave]', main).forEach((b) => (b.onclick = async () => {
      const c = b.dataset.rsave, factor = Number(v(c, 'factor').value), egp_rate = Number(v(c, 'egp_rate').value);
      if (!(factor > 0) || !(egp_rate > 0)) return ui.toast('يجب أن يكون المعامل وسعر الصرف أكبر من صفر.', 'err');
      try { await sb.update('price_regions', { country: 'eq.' + c }, { factor, egp_rate, active: v(c, 'active').checked, updated_at: new Date().toISOString() }); ui.toast('تم الحفظ. سيرى الزوار السعر الجديد خلال دقائق.'); } catch (e) { ui.toast(arErr(e), 'err'); }
    }));
  }



  // built-in website forms (stored in requests) shown on the forms page
  const SITE_FORMS = [
    { key: 'inst', title: 'حلول المؤسسات', page: 'institutions.html', types: ['institution'] },
    { key: 'teach', title: 'التقديم كمحاضر', page: 'teach.html', types: ['instructor_recorded', 'instructor_interactive'] },
    { key: 'cons', title: 'طلب استشارة', page: 'consultations.html', types: ['consultation'] },
  ];
  async function siteFormResponses(sf) {
    let rows = await sb.get('requests', { select: '*', type: 'in.(' + sf.types.join(',') + ')', order: 'created_at.desc' }).catch(() => []);
    const kind = { instructor_recorded: 'دورة مسجلة', instructor_interactive: 'دورة تفاعلية' };
    const base = ['الاسم', 'البريد الإلكتروني', 'الهاتف المحمول'];
    const val = (r, c) => c === 'الاسم' ? r.name : c === 'البريد الإلكتروني' ? r.email : c === 'الهاتف المحمول' ? r.phone : c === 'النوع' ? kind[r.type] || '' : (r.payload || {})[c];
    const extra = [...new Set(rows.flatMap((r) => Object.keys(r.payload || {})))].filter((k) => !/الاسم|البريد|الهاتف|الموبايل|اسم مسؤول|_id$/.test(k));
    const cols = [...(sf.types.length > 1 ? ['النوع'] : []), ...base, ...extra];
    const ST = { new: 'جديد', in_review: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };
    const csv = () => {
      const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['التاريخ', ...cols, 'الحالة'].map(q).join(','), ...rows.map((r) => [new Date(r.created_at).toLocaleString('en-GB'), ...cols.map((c) => val(r, c)), ST[r.status] || r.status].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `${sf.key}-responses.csv`; a.click();
    };
    ui.modal(`<h3>ردود: ${esc(sf.title)}</h3><p class="bx-hint" style="margin:0">${rows.length} رد</p>
      <div class="bx-btnrow" style="margin:8px 0 12px"><button class="bs-btn bs-btn-primary bs-btn-sm" id="frcsv" ${rows.length ? '' : 'disabled'}>تحميل Excel (CSV)</button><button class="bs-btn bs-btn-ghost bs-btn-sm" data-x>إغلاق</button></div>
      <div class="bx-scroll" style="max-height:60vh">${rows.length ? `<table class="bx-table"><thead><tr><th>التاريخ</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>الحالة</th></tr></thead><tbody>${rows.map((r) => `<tr><td style="white-space:nowrap">${D.date(r.created_at)}</td>${cols.map((c) => `<td>${esc(val(r, c) ?? '')}</td>`).join('')}
        <td><select class="bx-select" data-rq="${r.id}" style="min-width:110px;height:34px;padding:0 8px">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>` : '<p class="bx-hint">لا توجد ردود بعد.</p>'}</div>`,
    (m, close) => {
      $('[data-x]', m).onclick = () => { close(); D.reload(); };
      const cb = $('#frcsv', m); if (cb) cb.onclick = csv;
      $$('[data-rq]', m).forEach((sel) => (sel.onchange = async () => { try { await setReqStatus(sel.dataset.rq, sel.value); const r = rows.find((x) => x.id === sel.dataset.rq); if (r) r.status = sel.value; ui.toast('تم التحديث.'); } catch (e) { ui.toast(arErr(e), 'err'); } }));
    });
  }

  // ---------- recorded-course proposal review ----------
  async function proposalModal(p) {
    const ls = await sb.get('proposal_lessons', { select: '*', proposal_id: 'eq.' + p.id, order: 'position.asc,created_at.asc' }).catch(() => []);
    const done = p.status === 'accepted';
    ui.modal(`<h3>${esc(p.title || 'دورة')}</h3>
      <dl class="bx-kv"><dt>المحاضر</dt><dd>${esc(p.name || '')} · <span dir="ltr">${esc(p.email || '')}</span>${p.phone ? ` · <span dir="ltr">${esc(p.phone)}</span>` : ''}</dd><dt>التخصص</dt><dd>${esc(p.specialty || '—')}</dd><dt>المستوى</dt><dd>${esc(p.level || '—')}</dd><dt>الفئة</dt><dd>${esc(p.audience || '—')}</dd></dl>
      ${p.summary ? `<p class="bx-hint" style="white-space:pre-line">${esc(p.summary)}</p>` : ''}
      ${p.description ? `<details class="bx-hint"><summary>الوصف الكامل</summary><p style="white-space:pre-line;margin-top:6px">${esc(p.description)}</p></details>` : ''}
      <h4 style="margin:8px 0">الدروس (${ls.length})</h4>
      <ol class="bx-wzreview">${ls.map((l) => `<li><b>${esc(l.title)}</b> ${l.bunny_video_id ? `${l.uploaded ? '' : '<small class="bx-hint">(الرفع ما اكتملش)</small> '}<button class="bx-linkbtn" data-pv="${l.id}">مشاهدة</button>` : ''}${l.video_url ? ` <a class="bx-linkbtn" href="${esc(l.video_url)}" target="_blank" rel="noopener">فتح الرابط</a>` : ''}${!l.bunny_video_id && !l.video_url ? ' <small class="bx-hint">بدون فيديو</small>' : ''}</li>`).join('')}</ol>
      ${!done && ls.some((l) => l.video_url && !l.bunny_video_id) ? '<div class="bx-btnrow" style="margin:8px 0"><button class="bs-btn bs-btn-secondary bs-btn-sm" data-imp>نقل الفيديوهات من الرابطات لـ Bunny</button><small class="bx-hint" id="impst"></small></div>' : ''}
      <div id="pvbox"></div>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions">${done ? `<a class="bs-btn bs-btn-primary" href="admin.html#courses">تم إنشاء الدورة — انتقل إلى الدورات</a>` : isAdmin() ? `<button class="bs-btn bs-btn-primary" data-acc>قبول وتحويل إلى دورة</button><button class="bs-btn bs-btn-ghost" data-rev>قيد المراجعة</button><button class="bs-btn bs-btn-ghost" data-rej style="color:var(--danger-text)">رفض</button>` : ''}<button class="bs-btn bs-btn-ghost" data-x>إغلاق</button></div>`,
    (m, close) => {
      const msg = $('.bx-formmsg', m);
      $('[data-x]', m).onclick = () => { close(); D.reload(); };
      $$('[data-pv]', m).forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try { const r = await sb.fn('bunny-upload', { action: 'preview', lesson_id: b.dataset.pv }); $('#pvbox', m).innerHTML = `<div style="position:relative;padding-top:56.25%;margin-top:10px;border-radius:12px;overflow:hidden;background:#000"><iframe src="${esc(r.url)}" allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`; }
        catch (e) { say(msg, e.status === 503 ? 'اربط Bunny من «التكاملات» لعرض الفيديوهات.' : arErr(e), 'err'); }
        b.disabled = false;
      }));
      const importAll = async () => {
        const st = $('#impst', m); if (st) st.textContent = 'جارٍ نقل الفيديوهات… قد يستغرق ذلك دقيقة.';
        const r = await sb.fn('bunny-upload', { action: 'import_all', proposal_id: p.id });
        const res = Object.values(r.results || {}); const okN = res.filter((x) => x.video_id).length, q = res.filter((x) => x.queued).length, bad = res.filter((x) => x.error && x.error !== 'no link');
        const yt = bad.filter((x) => x.error === 'youtube').length;
        const txt = `تم نقل ${okN}${q ? ` · ${q} في الطريق` : ''}${bad.length ? ` · ${bad.length} فشل${yt ? ' (لا يمكن استخدام روابط YouTube)' : ' (تأكد من مشاركة الملفات بخيار Anyone with the link)'}` : ''}`;
        if (st) st.textContent = txt; return { okN, bad: bad.length };
      };
      const ib = $('[data-imp]', m); if (ib) ib.onclick = async () => { ib.disabled = true; try { await importAll(); } catch (e) { say(msg, e.status === 503 ? 'اربط Bunny من «التكاملات» الأول.' : arErr(e), 'err'); } ib.disabled = false; };
      const setSt = async (status) => { await sb.update('course_proposals', { id: 'eq.' + p.id }, { status, updated_at: new Date().toISOString() }); p.status = status; };
      const rev = $('[data-rev]', m); if (rev) rev.onclick = async () => { try { await setSt('in_review'); ui.toast('اتحوّل لقيد المراجعة.'); } catch (e) { say(msg, arErr(e), 'err'); } };
      const rej = $('[data-rej]', m); if (rej) rej.onclick = async () => { if (!confirm('رفض الدورة؟')) return; try { await setSt('rejected'); ui.toast('تم الرفض.'); close(); D.reload(); } catch (e) { say(msg, arErr(e), 'err'); } };
      const acc = $('[data-acc]', m); if (acc) acc.onclick = async () => {
        if (!confirm('ستُنشأ دورة مسودة بالمحاضرات والفيديوهات، وسيتحوّل الحساب إلى حساب محاضر. هل نتابع؟')) return;
        acc.disabled = true; say(msg, 'جارٍ إنشاء الدورة…');
        try { if (ls.some((l) => l.video_url && !l.bunny_video_id)) { say(msg, 'جارٍ نقل الفيديوهات من الروابط إلى Bunny أولًا…'); try { await importAll(); } catch (e) { /* create the course anyway */ } }
          await sb.rpc('accept_course_proposal', { p_id: p.id }); ui.toast('تم إنشاء الدورة مسودةً في «الدورات». راجعها ثم انشرها.'); close(); location.hash = '#courses'; }
        catch (e) { acc.disabled = false; say(msg, arErr(e), 'err'); }
      };
    });
  }
  const formBuilder = (f) => window.FormsUI.builder(f), formResponses = (f) => window.FormsUI.responses(f);

  // ---------- import lectures from a Bunny Stream library ----------
  const natural = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  async function pickLibrary(onPick) {
    let libs;
    try { const r = await sb.fn('bunny-upload', { action: 'libraries' }); libs = r.libraries || []; }
    catch (e) { ui.toast(e.status === 503 ? 'أضف «Account API Key» الخاص بـ Bunny في صفحة التكاملات أولًا.' : arErr(e), 'err'); return; }
    ui.modal(`<h3>اختر مكتبة من Bunny</h3><p class="bx-hint" style="margin-top:0">كل فيديو في المكتبة هيبقى محاضرة.</p>
      <div class="row2"><div class="bx-field"><label for="blsel">المكتبة</label><select id="blsel" class="bx-select">${libs.map((l) => `<option value="${esc(l.id)}" data-name="${esc(l.name)}">${esc(l.name)} (${l.videos} فيديو)</option>`).join('')}</select></div>
      <div class="bx-field"><label for="blord">ترتيب المحاضرات</label><select id="blord" class="bx-select"><option value="title">حسب اسم الفيديو (1، 2، 3…)</option><option value="date">حسب تاريخ الرفع</option></select></div></div>
      <div class="bx-formmsg" aria-live="polite"></div><div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" data-go>استيراد</button><button class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-go]', m).onclick = async (e) => {
        const sel = $('#blsel', m), lib = sel.value, name = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : '';
        e.target.disabled = true; say($('.bx-formmsg', m), 'جارٍ جلب الفيديوهات…');
        try { const r = await sb.fn('bunny-upload', { action: 'library_videos', library_id: lib }); let vids = r.videos || [];
          vids = $('#blord', m).value === 'date' ? vids.sort((a, b) => a.date.localeCompare(b.date)) : vids.sort(natural);
          await onPick({ id: lib, name, videos: vids }); close();
        } catch (err) { e.target.disabled = false; say($('.bx-formmsg', m), arErr(err), 'err'); }
      };
    });
  }
  async function addLibraryLectures(courseId, lib, existing) {
    const have = new Set((existing || []).map((l) => (l.lecture_videos && (l.lecture_videos.bunny_video_id || (l.lecture_videos[0] && l.lecture_videos[0].bunny_video_id))) || '').filter(Boolean));
    let pos = existing && existing.length ? Math.max(...existing.map((l) => l.position)) : 0, n = 0;
    for (const v of lib.videos) {
      if (have.has(v.guid)) continue;
      pos++;
      const [row] = await sb.insert('lectures', { course_id: courseId, position: pos, title: (v.title || 'محاضرة ' + pos).replace(/\.(mp4|mov|mkv|webm|avi|m4v)$/i, '').slice(0, 200), duration_seconds: v.length || null });
      await sb.insert('lecture_videos', { lecture_id: row.id, bunny_video_id: v.guid, bunny_library_id: lib.id });
      n++;
    }
    return n;
  }

  // ---------- course editor (modal) ----------
  async function courseForm(c, insts) {
    const isNew = !c; c = c || { kind: 'recorded', status: 'draft', level: 'beginner' };
    const feats = await sb.get('featured_instructors', { select: 'id,name,title,profile_id,visible', order: 'sort.asc,created_at.asc' }).catch(() => []);
    const curIds = (c.featured_instructor_ids && c.featured_instructor_ids.length ? c.featured_instructor_ids : c.featured_instructor_id ? [c.featured_instructor_id] : []);
    const curInsts = curIds.map((id) => 'f:' + id);
    if (c.instructor_id && !feats.some((f) => f.profile_id === c.instructor_id && curIds.includes(f.id))) curInsts.unshift('p:' + c.instructor_id);
    const LV = { beginner: 'مبتدئ', beginner_intermediate: 'مبتدئ ومتوسط', intermediate: 'متوسط فقط', intermediate_advanced: 'متوسط ومتقدم', all_levels: 'مبتدئ ومتوسط ومتقدم (كل المستويات)' };
    if (c.level === 'advanced') LV.advanced = 'متقدم';
    let lects = [];
    if (!isNew) {
      lects = await sb.get('lectures', { select: '*,lecture_videos(bunny_video_id)', course_id: 'eq.' + c.id, order: 'position' });
    }
    const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
    const facsCur = window.CourseExtras ? await CourseExtras.load(c) : [];
    const close = ui.modal(`<h3>${isNew ? 'دورة جديدة' : 'تعديل: ' + esc(c.title)}</h3>
      <form class="bx-form2" id="cf" novalidate>
        <div class="row2"><div class="bx-field"><label for="ct">العنوان</label><input id="ct" class="bx-input" value="${esc(c.title || '')}"></div><div class="bx-field"><label for="cs">الرابط (slug)</label><input id="cs" class="bx-input" dir="ltr" value="${esc(c.slug || '')}"></div></div>
        <div class="row2"><div class="bx-field"><label for="ck">النوع</label><select id="ck" class="bx-select" ${isNew ? '' : 'disabled'}>${opt({ recorded: 'مسجل', interactive: 'تفاعلي' }, c.kind)}</select></div><div class="bx-field"><label for="cst">الحالة</label><select id="cst" class="bx-select">${opt({ draft: 'مسودة', review: 'قيد المراجعة', published: 'منشور', archived: 'مؤرشف' }, c.status)}</select></div><div class="bx-field"><label for="cl">المستوى</label><select id="cl" class="bx-select">${opt(LV, c.level)}</select></div></div>
        <div class="bx-field"><label>المحاضرين</label><div id="cinsts" class="bx-fbfields"></div><button type="button" class="bs-btn bs-btn-ghost" id="ciadd" style="justify-self:start">+ إضافة محاضر آخر</button>
          <small class="bx-hint">أول محاضر له حساب على المنصة هو من تُحتسب له أرباح المشاهدات.</small></div>
        <div class="bx-field"><label for="cimg">صورة الغلاف</label>
          <div id="cimg-prev" style="width:100%;max-width:360px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--surface-raised);display:grid;place-items:center;border:1px dashed var(--line);margin-bottom:8px">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '<small class="bx-hint" style="margin:0">لا توجد صورة · يظهر الاختصار بدلًا منها</small>'}</div>
          <input id="cimg" type="file" accept="image/png,image/jpeg,image/webp" class="bx-input"><input type="hidden" id="cimgu" value="${esc(c.cover_url || '')}">
          <small class="bx-hint"><b>المقاس المناسب: 1280 × 720 بكسل (نسبة 16:9)</b>، بصيغة JPG أو WebP وبحجم أقل من 1 ميجابايت. اترك هامشًا حول النص المهم لأن الصورة تُقص قليلًا في بعض الشاشات.</small>
          ${c.cover_url ? '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" id="cimg-rm" style="justify-self:start">إزالة الصورة</button>' : ''}</div>
        <div class="bx-field"><label for="cc">اختصار الغلاف (اختياري)</label><input id="cc" class="bx-input" dir="ltr" maxlength="3" value="${esc(c.cover_code || '')}" placeholder="مثلًا BD"><small class="bx-hint">حرفان يظهران بخط كبير على غلاف الدورة إذا لم توجد صورة، مثل MB لـ Molecular Biology. إذا تركته فارغًا يُنشأ تلقائيًا من أول حرفين في العنوان.</small></div>
        <div class="row2"><div class="bx-field"><label for="cfa">الكلية</label><select id="cfa" class="bx-select"><option value="">—</option><option value="all" ${c.faculty === 'all' ? 'selected' : ''}>كل الكليات</option>${(window.FACULTIES || []).map((f) => `<option value="${f.id}" ${f.id === (c.faculty || (window.facultyOf ? window.facultyOf(c) : '')) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div><div class="bx-field"><label for="csp">التخصص</label><input id="csp" class="bx-input" list="csp-l" value="${esc(c.specialty || '')}" placeholder="اختر من القائمة أو اكتب تخصصًا"><datalist id="csp-l"></datalist></div></div>
        <div class="bx-field"><label for="csu">وصف مختصر</label><input id="csu" class="bx-input" value="${esc(c.summary || '')}"></div>
        <div class="bx-field"><label for="cd">الوصف الكامل</label><textarea id="cd" class="bx-textarea">${esc(c.description || '')}</textarea></div>
        <div class="bx-field"><label for="cout">مخرجات التعلم — ماذا سيتعلم الطالب؟ (سطر لكل مخرج)</label><textarea id="cout" class="bx-textarea" rows="5">${esc(c.outcomes || '')}</textarea><small class="bx-hint">تظهر في صفحة الدورة كقائمة «ماذا ستتعلم»، وتُضاف للبيانات المنظمة لجوجل.</small></div>
        <div class="row2" id="ia" ${c.kind === 'interactive' ? '' : 'hidden'}><div class="bx-field"><label for="cp">سعر الدورة (ج.م)</label><input id="cp" class="bx-input" type="number" min="0" value="${c.price_egp ?? ''}"></div><div class="bx-field"><label for="cpi">السعر خارج مصر (بعملة البلد)</label><input id="cpi" class="bx-input" type="number" min="0" step="0.5" value="${c.intl_price ?? ''}" placeholder="فارغ = سعر الجنيه × المعامل"></div><div class="bx-field"><label for="cse">المقاعد</label><input id="cse" class="bx-input" type="number" min="1" value="${c.seats ?? ''}"></div><div class="bx-field"><label for="cdt">تاريخ البدء</label><input id="cdt" class="bx-input" type="date" value="${c.starts_at ? String(c.starts_at).slice(0, 10) : ''}"></div><div class="bx-field"><label for="cde">تاريخ الانتهاء (تصدر فيه الشهادات تلقائيًا)</label><input id="cde" class="bx-input" type="date" value="${c.ends_at ? String(c.ends_at).slice(0, 10) : ''}"></div><div class="bx-field"><label for="chr">عدد ساعات التدريب (يُطبع على الشهادة)</label><input id="chr" class="bx-input" type="number" min="0" step="0.5" value="${c.hours ?? ''}"></div></div>
        ${window.CourseExtras ? CourseExtras.html(c, facsCur) : ''}
        <div class="bx-formmsg" id="cm" aria-live="polite"></div>
        <div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">${isNew ? 'إنشاء' : 'حفظ'}</button>${isNew ? '' : `<a class="bs-btn bs-btn-secondary" href="course.html?c=${encodeURIComponent(c.slug)}" target="_blank" rel="noopener">معاينة الصفحة</a>`}<button class="bs-btn bs-btn-ghost" type="button" data-x>إغلاق</button>${isNew ? '' : '<button class="bs-btn bs-btn-ghost" type="button" id="cdel" style="color:var(--danger-text);margin-inline-start:auto">حذف الدورة</button>'}</div>
      </form>
      ${isNew ? '<p class="bx-hint">بعد الإنشاء يمكنك إضافة المحاضرات.</p>' : `<hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="bx-spread"><h3>المحاضرات</h3><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" id="lbimp">استيراد من مكتبة Bunny</button></div><div id="ll"></div><div id="lfiles" style="margin-top:12px"></div>
      <form class="bx-form2" id="lf" novalidate><div class="row2"><div class="bx-field"><label for="lt">عنوان المحاضرة</label><input id="lt" class="bx-input"></div><div class="bx-field"><label for="lv">فيديو المحاضرة (Bunny)</label><input id="lv" class="bx-input" dir="ltr" placeholder="ارفع فيديو أو الصق GUID"><span class="bx-btnrow" style="margin-top:6px;align-items:center"><label class="bs-btn bs-btn-ghost bs-btn-sm" style="cursor:pointer">رفع فيديو من جهازك<input type="file" id="lfile" accept="video/*" hidden></label><small class="bx-hint" id="lup"></small></span></div><div class="bx-field"><label for="ld">المدة (دقائق:ثواني)</label><input id="ld" class="bx-input" dir="ltr" placeholder="12:30"></div></div><label class="bx-hint" style="display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="lpv"> محاضرة معاينة مجانية (يشاهدها أي زائر مسجّل دخوله)</label><div class="bx-formmsg" id="lm" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-secondary" type="submit">+ إضافة محاضرة</button></div></form>`}`,
    (m, cl) => {
      $('[data-x]', m).onclick = cl;
      $('#ck', m).onchange = (e) => ($('#ia', m).hidden = e.target.value !== 'interactive');
      $('#ct', m).addEventListener('input', (e) => { if (isNew && !$('#cs', m).dataset.touched) $('#cs', m).value = slugify(e.target.value); });
      $('#cs', m).addEventListener('input', (e) => (e.target.dataset.touched = '1'));
      const fillSp = () => { const f = (window.FACULTIES || []).find((x) => x.id === $('#cfa', m).value); $('#csp-l', m).innerHTML = ['كل التخصصات', ...(f ? f.specs : (window.FACULTIES || []).flatMap((x) => x.specs))].map((s) => `<option value="${esc(s)}">`).join(''); };
      $('#cfa', m).addEventListener('change', fillSp); fillSp();
      const rowsBox = $('#cinsts', m);
      const optsHtml = (cur) => `<option value="">— اختر محاضر —</option>
          ${feats.length ? `<optgroup label="محاضرين الموقع">${feats.map((f) => `<option value="f:${f.id}" ${'f:' + f.id === cur ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>` : ''}
          ${insts.length ? `<optgroup label="حسابات المحاضرين (لهم لوحة وأرباح)">${insts.map((i) => `<option value="p:${i.id}" ${'p:' + i.id === cur ? 'selected' : ''}>${esc(i.full_name || i.email)}</option>`).join('')}</optgroup>` : ''}
          <option value="new" ${cur === 'new' ? 'selected' : ''}>+ إضافة محاضر جديد</option>`;
      const fill = (row) => {
        const v = $('[data-ci]', row).value, box = $('.bx-instbox', row); box.hidden = !v;
        if (!v) return;
        if (v === 'new') { $('[data-cin]', row).value = ''; $('[data-cib]', row).value = ''; $('[data-civ]', row).checked = true; return; }
        const [k, id] = v.split(':');
        const f = k === 'f' ? feats.find((x) => x.id === id) : feats.find((x) => x.profile_id === id);
        const p = k === 'p' ? insts.find((x) => x.id === id) : null;
        $('[data-cin]', row).value = (f && f.name) || (p && p.full_name) || '';
        $('[data-cib]', row).value = (f && f.title) || '';
        $('[data-civ]', row).checked = f ? f.visible !== false : true;
      };
      const addRow = (cur) => {
        const row = document.createElement('div'); row.className = 'bx-fbrow';
        row.innerHTML = `<div class="bx-fbmain" style="grid-template-columns:minmax(0,1fr) auto"><select class="bx-select" data-ci aria-label="المحاضر">${optsHtml(cur || '')}</select><button type="button" class="bx-linkbtn" data-cirm style="color:var(--danger-text)" aria-label="حذف">✕</button></div>
          <div class="bx-instbox" hidden><div class="row2"><div class="bx-field"><label>اسم المحاضر</label><input class="bx-input" data-cin maxlength="80" placeholder="د. الاسم"></div>
          <div class="bx-field"><label>نبذة عن المحاضر</label><textarea class="bx-textarea" data-cib rows="2" maxlength="240" placeholder="الدرجة العلمية والجهة، مثلًا: أستاذ مساعد، كلية العلوم، جامعة القاهرة"></textarea></div></div>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-civ checked> إظهاره أيضًا في صفحة المحاضرين والشريط المتحرك</label></div>`;
        rowsBox.appendChild(row);
        $('[data-ci]', row).onchange = () => fill(row);
        $('[data-cirm]', row).onclick = () => { row.remove(); if (!rowsBox.children.length) addRow(''); };
        fill(row);
      };
      (curInsts.length ? curInsts : ['']).forEach(addRow);
      $('#ciadd', m).onclick = () => addRow('');
      // several instructors only for interactive courses; recorded courses keep one
      const syncMulti = () => {
        const multi = $('#ck', m).value === 'interactive';
        $('#ciadd', m).hidden = !multi;
        if (!multi) $$('.bx-fbrow', rowsBox).slice(1).forEach((r) => r.remove());
        $$('[data-cirm]', rowsBox).forEach((x) => (x.hidden = !multi));
        const lab = $('#cinsts', m).previousElementSibling; if (lab) lab.textContent = multi ? 'المحاضرين' : 'المحاضر';
      };
      $('#ck', m).addEventListener('change', syncMulti); syncMulti();
      const instFields = async () => {
        const ids = []; let account = null;
        for (const row of $$('.bx-fbrow', rowsBox).slice(0, $('#ck', m).value === 'interactive' ? 99 : 1)) {
          const v = $('[data-ci]', row).value; if (!v) continue;
          const name = $('[data-cin]', row).value.trim(), title = $('[data-cib]', row).value.trim() || null, visible = $('[data-civ]', row).checked;
          if (name.length < 2) throw new Error('اكتب اسم كل محاضر.');
          const [k, id] = v.split(':');
          let f = v === 'new' ? null : k === 'f' ? feats.find((x) => x.id === id) : feats.find((x) => x.profile_id === id);
          if (f) { if (f.name !== name || (f.title || null) !== title || f.visible !== visible) await sb.update('featured_instructors', { id: 'eq.' + f.id }, { name, title, visible }); }
          else { const r = await sb.insert('featured_instructors', { name, title, visible, profile_id: k === 'p' ? id : null, sort: 1000 }); f = Array.isArray(r) ? r[0] : r; if (f) feats.push(f); }
          if (f && f.id && !ids.includes(f.id)) ids.push(f.id);
          const acc = k === 'p' ? id : f && f.profile_id; if (!account && acc) account = acc;
        }
        return { instructor_id: account, featured_instructor_id: ids[0] || null, featured_instructor_ids: ids };
      };
      const autoCode = (t) => { const w = String(t || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '').slice(0, 2)).toUpperCase(); };
      $('#cimg', m).onchange = async (ev) => {
        const f = ev.target.files[0], msg = $('#cm', m); if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return say(msg, 'يجب أن تكون الصورة PNG أو JPG أو WebP.', 'err');
        if (f.size > 3 * 1024 * 1024) return say(msg, 'حجم الصورة أكبر من 3 ميجابايت.', 'err');
        const dims = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([0, 0]); im.src = URL.createObjectURL(f); });
        try {
          say(msg, 'جارٍ رفع الصورة…');
          const path = `courses/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`;
          await sb.storage.upload('site-media', path, f);
          const url = `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-media/${path}`;
          $('#cimgu', m).value = url; $('#cimg-prev', m).innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`;
          const r = dims[0] && dims[1] ? dims[0] / dims[1] : 0;
          say(msg, `تم رفع الصورة (${dims[0]} × ${dims[1]}). ` + (r && Math.abs(r - 16 / 9) > 0.08 ? 'تنبيه: النسبة ليست 16:9 وسيتم قص الصورة. المقاس المناسب 1280 × 720.' : dims[0] && dims[0] < 960 ? 'تنبيه: الصورة صغيرة وقد تظهر غير واضحة؛ يُفضّل 1280 × 720.' : 'اضغط «حفظ» لتثبيتها.'), r && Math.abs(r - 16 / 9) > 0.08 ? 'err' : 'ok');
        } catch (err) { say(msg, arErr(err), 'err'); }
      };
      if ($('#cimg-rm', m)) $('#cimg-rm', m).onclick = () => { $('#cimgu', m).value = ''; $('#cimg-prev', m).innerHTML = '<small class="bx-hint" style="margin:0">ستُزال الصورة عند الحفظ</small>'; };
      if (window.CourseExtras) CourseExtras.bind(m, c);
      const cdel = $('#cdel', m);
      if (cdel) cdel.onclick = async () => {
        const typed = prompt(`حذف الدورة نهائيًا مع محاضراتها لا يمكن التراجع عنه.\nللتأكيد اكتب رابط الدورة: ${c.slug}\n(لإخفائها فقط اختر الحالة «مؤرشف» بدلًا من الحذف)`);
        if (typed === null) return; if (typed.trim() !== c.slug) return ui.toast('لم يتطابق الرابط، لم يُحذف شيء.', 'err');
        try { await sb.remove('courses', { id: 'eq.' + c.id }); ui.toast('تم حذف الدورة.'); cl(); D.reload(); }
        catch (err) { ui.toast(/foreign|violates|23503/i.test(err.message || '') ? 'لا يمكن حذف دورة لها اشتراكات أو مدفوعات أو شهادات. غيّر حالتها إلى «مؤرشف» بدلًا من ذلك.' : arErr(err), 'err'); }
      };
      $('#cf', m).onsubmit = async (e) => {
        e.preventDefault(); const msg = $('#cm', m), g = (id) => $('#' + id, m).value.trim();
        if (!g('ct') || !g('cs')) return say(msg, 'اكتب العنوان والرابط.', 'err');
        const kind = g('ck'), row = { title: g('ct'), slug: g('cs'), kind, status: g('cst'), level: g('cl'), cover_code: g('cc') || autoCode(g('ct')) || null, cover_url: $('#cimgu', m).value || null, specialty: g('csp') || null, faculty: g('cfa') || null, summary: g('csu') || null, description: g('cd') || null, outcomes: $('#cout', m).value.split('\n').map((x) => x.trim()).filter(Boolean).join('\n') || null,
          price_egp: kind === 'interactive' && g('cp') !== '' ? Number(g('cp')) : null, intl_price: kind === 'interactive' && g('cpi') !== '' ? Number(g('cpi')) : null, seats: kind === 'interactive' && g('cse') !== '' ? Number(g('cse')) : null, starts_at: kind === 'interactive' && g('cdt') ? new Date(g('cdt')).toISOString() : null,
          ends_at: kind === 'interactive' && g('cde') ? new Date(g('cde') + 'T20:00:00Z').toISOString() : null, hours: kind === 'interactive' && g('chr') !== '' ? Number(g('chr')) : null };
        if (row.starts_at && row.ends_at && row.ends_at < row.starts_at) return say(msg, 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.', 'err');
        if (kind === 'interactive' && row.status === 'published' && row.price_egp === null) return say(msg, 'حدّد سعر الدورة التفاعلية قبل النشر.', 'err');
        if (kind === 'recorded' && row.status === 'published' && !lects.length) return say(msg, 'أضف محاضرة واحدة على الأقل قبل نشر الدورة.', 'err');
        try {
          const X = window.CourseExtras ? CourseExtras.collect(m) : null; if (X) Object.assign(row, X.row);
          Object.assign(row, await instFields());
          let id = c.id;
          if (isNew) { const r = await sb.insert('courses', row); id = (Array.isArray(r) ? r[0] : r || {}).id; } else await sb.update('courses', { id: 'eq.' + c.id }, row);
          if (X && id) await CourseExtras.saveFacs(id, X.facs);
          ui.toast('تم الحفظ. تتحدث صفحات البحث خلال 15 دقيقة.'); cl(); D.reload();
        }
        catch (err) { say(msg, /duplicate/.test(err.message) ? 'هذا الرابط مستخدم لدورة أخرى.' : /[\u0600-\u06FF]/.test(err.message || '') ? err.message : arErr(err), 'err'); }
      };
      if (!isNew) {
        const draw = () => {
          $('#ll', m).innerHTML = lects.length ? `<ol style="margin:0;padding:0;list-style:none;display:grid;gap:6px">${lects.map((l, i) => `<li class="bx-spread" style="gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px"><span><b>${i + 1}.</b> ${esc(l.title)} <small class="bx-hint">${l.duration_seconds ? mmss(l.duration_seconds) : ''} ${l.lecture_videos && (l.lecture_videos.bunny_video_id || (l.lecture_videos[0] && l.lecture_videos[0].bunny_video_id)) ? '· فيديو مضاف' : '· بدون فيديو'}</small></span><span class="bx-btnrow"><label class="bx-hint" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-pv="${l.id}" ${l.is_preview ? 'checked' : ''}> معاينة مجانية</label><button class="bx-linkbtn" data-up="${l.id}" ${i === 0 ? 'disabled' : ''} aria-label="أعلى">↑</button><button class="bx-linkbtn" data-dn="${l.id}" ${i === lects.length - 1 ? 'disabled' : ''} aria-label="أسفل">↓</button><button class="bx-linkbtn" data-rm="${l.id}" style="color:var(--danger-text)">حذف</button></span></li>`).join('')}</ol>` : '<p class="bx-hint">لا توجد محاضرات بعد.</p>';
        };
        const drawFiles = async () => {
          const box = $('#lfiles', m); if (!box || !lects.length) { if (box) box.innerHTML = ''; return; }
          let files = []; try { files = await sb.get('lecture_files', { select: '*', lecture_id: 'in.(' + lects.map((l) => l.id).join(',') + ')', order: 'created_at' }); } catch {}
          box.innerHTML = `<details><summary class="bx-hint" style="cursor:pointer">ملفات المحاضرات (PDF / سلايدات) · ${files.length}</summary><div style="display:grid;gap:8px;margin-top:8px">
            ${files.map((f) => `<div class="bx-spread" style="gap:8px"><span>📄 ${esc(f.name)} <small class="bx-hint">· ${esc((lects.find((l) => l.id === f.lecture_id) || {}).title || '')}</small></span><button class="bx-linkbtn" data-fdel="${f.id}" data-fpath="${esc(f.path)}" style="color:var(--danger-text)">حذف</button></div>`).join('')}
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="flec" class="bx-select" aria-label="المحاضرة">${lects.map((l, i) => `<option value="${l.id}">${i + 1}. ${esc(l.title)}</option>`).join('')}</select><input type="file" id="ffile" accept=".pdf,.ppt,.pptx,.doc,.docx,.zip,.png,.jpg"><button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" id="fup">رفع</button></div><small class="bx-hint">الحد الأقصى 50 ميجابايت للملف. يظهر الملف للطلاب الذين يمكنهم مشاهدة المحاضرة فقط.</small></div></details>`;
          $('#fup', box).onclick = async () => {
            const file = $('#ffile', box).files[0], lid = $('#flec', box).value; if (!file) return ui.toast('اختر ملفًا أولًا.', 'err');
            if (file.size > 52428800) return ui.toast('الملف أكبر من 50 ميجابايت.', 'err');
            const path = `${lid}/${Date.now().toString(36)}-${file.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`;
            try { await sb.storage.upload('lecture-files', path, file); await sb.insert('lecture_files', { lecture_id: lid, name: file.name, path, size_bytes: file.size }); ui.toast('تم رفع الملف.'); await drawFiles(); $('details', box).open = true; }
            catch (e) { ui.toast(arErr(e), 'err'); }
          };
          $$('[data-fdel]', box).forEach((b) => (b.onclick = async () => { if (!confirm('حذف الملف؟')) return; try { await sb.storage.remove('lecture-files', b.dataset.fpath).catch(() => {}); await sb.remove('lecture_files', { id: 'eq.' + b.dataset.fdel }); drawFiles(); } catch (e) { ui.toast(arErr(e), 'err'); } }));
        };
        const reload = async () => { lects = await sb.get('lectures', { select: '*,lecture_videos(bunny_video_id)', course_id: 'eq.' + c.id, order: 'position' }); draw(); drawFiles(); };
        draw(); drawFiles();
        $('#ll', m).addEventListener('change', async (e) => {
          const pv = e.target.closest('[data-pv]'); if (!pv) return;
          try { await sb.update('lectures', { id: 'eq.' + pv.dataset.pv }, { is_preview: pv.checked }); const l = lects.find((x) => x.id === pv.dataset.pv); if (l) l.is_preview = pv.checked; ui.toast(pv.checked ? 'المحاضرة أصبحت معاينة مجانية.' : 'أُلغيت المعاينة.'); } catch (err) { pv.checked = !pv.checked; ui.toast(arErr(err), 'err'); }
        });
        $('#ll', m).addEventListener('click', async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          try {
            if (b.dataset.rm) { if (!confirm('حذف هذه المحاضرة؟')) return; await sb.remove('lectures', { id: 'eq.' + b.dataset.rm }); }
            const mv = b.dataset.up || b.dataset.dn;
            if (mv) { // swap positions through a temporary slot because (course_id, position) is unique
              const i = lects.findIndex((l) => l.id === mv), j = b.dataset.up ? i - 1 : i + 1, a = lects[i], o = lects[j];
              await sb.update('lectures', { id: 'eq.' + a.id }, { position: -1 }); await sb.update('lectures', { id: 'eq.' + o.id }, { position: a.position }); await sb.update('lectures', { id: 'eq.' + a.id }, { position: o.position });
            }
            await reload();
          } catch (err) { ui.toast(arErr(err), 'err'); }
        });
        $('#lbimp', m).onclick = () => pickLibrary(async (lib) => { const n = await addLibraryLectures(c.id, lib, lects); ui.toast(n ? `تمت إضافة ${n} محاضرة من «${lib.name}».` : 'كل فيديوهات هذه المكتبة موجودة بالفعل.'); await reload(); });
        $('#lfile', m).onchange = async (ev) => {
          const f = ev.target.files[0]; if (!f) return; const st = $('#lup', m), sub = $('#lf button[type=submit]', m);
          sub.disabled = true; st.textContent = 'جارٍ تجهيز الرفع…';
          try {
            const d = await window.videoDuration(f); if (d && !$('#ld', m).value) $('#ld', m).value = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
            if (!$('#lt', m).value.trim()) $('#lt', m).value = f.name.replace(/\.[^.]+$/, '');
            const a = await sb.fn('bunny-upload', { action: 'create_admin', title: `${c.title} — ${$('#lt', m).value.trim()}` });
            const guid = await window.bunnyUpload(f, a, (x, y) => (st.textContent = `جارٍ الرفع ${Math.floor((x / y) * 100)}%`));
            $('#lv', m).value = guid; st.textContent = 'اتّرفع ✓ اضغط «إضافة محاضرة»';
          } catch (err) { st.textContent = /not configured/.test(err.message || '') ? 'اربط Bunny من «التكاملات» الأول (Library ID وAPI Key).' : 'توقف الرفع: ' + (err.message || ''); }
          sub.disabled = false; ev.target.value = '';
        };
        $('#lf', m).onsubmit = async (e) => {
          e.preventDefault(); const msg = $('#lm', m), t = $('#lt', m).value.trim(), v = $('#lv', m).value.trim(), d = parseDur($('#ld', m).value);
          if (!t) return say(msg, 'اكتب عنوان المحاضرة.', 'err');
          try {
            const pos = lects.length ? Math.max(...lects.map((l) => l.position)) + 1 : 1;
            const [row] = await sb.insert('lectures', { course_id: c.id, position: pos, title: t, duration_seconds: d, is_preview: $('#lpv', m).checked });
            if (v) await sb.insert('lecture_videos', { lecture_id: row.id, bunny_video_id: v });
            $('#lt', m).value = $('#lv', m).value = $('#ld', m).value = ''; say(msg, 'تمت الإضافة.', 'ok'); await reload();
          } catch (err) { say(msg, arErr(err), 'err'); }
        };
      }
    });
  }

  window.BiosynPages.admin = async () => {
    me = await D.guard(['admin', 'support']); if (!me) return;
    const items = [{ id: 'home', label: 'اليوم', icon: 'home' }, { id: 'insights', label: 'مركز التحليلات', icon: 'chart' }, { id: 'requests', label: 'صندوق الطلبات', icon: 'inbox' }, { id: 'proposals', label: 'دورات مقدّمة', icon: 'book' }, { id: 'courses', label: 'الدورات', icon: 'book' }, { id: 'faculties', label: 'الكليات والتخصصات', icon: 'list' }, { id: 'traffic', label: 'زيارات المنصة', icon: 'chart' }, { id: 'seo', label: 'السيو والظهور', icon: 'chart' }, { id: 'about', label: 'صفحة من نحن', icon: 'book' }, { id: 'social', label: 'السوشيال والنشرة البريدية', icon: 'users' }, { id: 'texts', label: 'نصوص الموقع', icon: 'book' }, { id: 'news', label: 'الأخبار والفعاليات', icon: 'book' }, { id: 'testimonials', label: 'آراء الطلاب', icon: 'chat' }, { id: 'analytics', label: 'تحليلات الدورات', icon: 'chart' }, { id: 'users', label: 'المستخدمون', icon: 'users' }, { id: 'campaign', label: 'حملة إعادة التفعيل', icon: 'inbox' }, { id: 'mailcampaigns', label: 'حملات البريد', icon: 'inbox' }, { id: 'emails', label: 'رسائل البريد', icon: 'inbox' }, { id: 'payments', label: 'المدفوعات', icon: 'card' }, { id: 'tickets', label: 'التذاكر والشكاوى', icon: 'ticket' }, { id: 'questions', label: 'أسئلة الطلاب', icon: 'chat' }, { id: 'payouts', label: 'سحوبات المحاضرين', icon: 'coin' }, { id: 'contracts', label: 'عقود المحاضرين', icon: 'list' }, { id: 'plans', label: 'الباقات والأسعار', icon: 'list' }, { id: 'coupons', label: 'كوبونات الخصم', icon: 'card' }, { id: 'forms', label: 'النماذج والردود', icon: 'inbox' }, { id: 'instructors', label: 'المحاضرون في الموقع', icon: 'users' }, { id: 'blog', label: 'المدونة', icon: 'book' }, { id: 'integrations', label: 'التكاملات', icon: 'card' }, { id: 'settings', label: 'الإعدادات', icon: 'list' }];
    await D.shell({ title: 'لوحة الإدارة', who: me.full_name || sb.user.email, sub: D.roleAr[me.role], items, views });
    // live counters: new requests + open refund requests (refreshes every minute and when the tab regains focus)
    let lastRef = -1;
    const pulse = async () => {
      try {
        const open = await sb.get('requests', { select: 'id,type,status', status: 'in.(new,in_review)', limit: 500 });
        const nRef = open.filter((r) => r.type === 'refund').length;
        D.setBadge('payments', nRef); D.setBadge('requests', open.filter((r) => r.type !== 'refund' && r.status === 'new').length);
        if (window.Chat) Chat.unreadCounts().then((u) => { D.setBadge('tickets', (u && u.tickets) || 0); D.setBadge('questions', (u && u.course_unanswered) || 0); });
        if (lastRef >= 0 && nRef > lastRef) ui.toast(`وصل طلب استرداد جديد (${nRef} مفتوح).`);
        lastRef = nRef;
      } catch (e) { /* offline: try next tick */ }
    };
    pulse(); setInterval(pulse, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
  };
})();
