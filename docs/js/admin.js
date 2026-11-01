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
  function reqCard(r, usersById) {
    const f = r.payload && typeof r.payload === 'object' ? Object.entries(r.payload).filter(([, v]) => v !== '' && v !== null) : [];
    const isRefund = r.type === 'refund';
    return `<article class="bx-reqcard" data-r="${r.id}"><div class="bx-spread" style="gap:8px;flex-wrap:wrap"><div><b>${esc(r.name)}</b> <span class="bx-hint">· ${esc(D.reqType[r.type] || r.type)} · ${D.dateTime(r.created_at)}</span></div>${D.badge('req', r.status)}</div>
      <dl><div><dt>التواصل</dt><dd class="bx-kbd">${esc(r.email || '')}${r.phone ? ' · ' + esc(r.phone) : ''}</dd></div>${f.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`).join('')}</dl>
      <div class="bx-btnrow">
        ${isRefund && isAdmin() && ['new', 'in_review'].includes(r.status) ? `<button class="bs-btn bs-btn-primary bs-btn-sm" data-act="refund" data-pay="${esc(r.payload.payment_id)}">تنفيذ الاسترداد</button>` : ''}
        ${r.status === 'new' ? '<button class="bs-btn bs-btn-secondary bs-btn-sm" data-act="in_review">قيد المراجعة</button>' : ''}
        ${['new', 'in_review'].includes(r.status) && !isRefund ? '<button class="bs-btn bs-btn-secondary bs-btn-sm" data-act="accepted">قبول</button>' : ''}
        ${['new', 'in_review'].includes(r.status) ? '<button class="bs-btn bs-btn-ghost bs-btn-sm" data-act="rejected">رفض</button>' : ''}
        ${r.type.startsWith('instructor') && r.user_id && isAdmin() && usersById[r.user_id] && usersById[r.user_id].role === 'student' ? '<button class="bs-btn bs-btn-ghost bs-btn-sm" data-act="promote">ترقية الحساب لمحاضر</button>' : ''}
        ${r.email ? `<a class="bs-btn bs-btn-ghost bs-btn-sm" href="mailto:${esc(r.email)}">مراسلة</a>` : ''}
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
      D.setBadge('requests', newReq.length);
      main.innerHTML = `<div class="bx-stats">
          ${D.stat('اشتراكات سارية', subs.length)}
          ${D.stat('إيراد هذا الشهر', D.money(rev), 'مدفوعات مؤكدة (قبل رسوم البوابة)')}
          ${D.stat('طلبات جديدة', newReq.length, reqs.length + ' بانتظار إجراء')}
          ${D.stat('سحوبات معلّقة', pouts.length, pouts.length ? D.money(pouts.reduce((s, p) => s + Number(p.amount_egp), 0)) : '')}
        </div>
        ${D.panel('ما يحتاج إجراءك اليوم', reqs.length || pouts.length ? `<ol class="bx-focus">${reqs.slice(0, 6).map((r) => `<li><div class="bx-date bx-date-sm"><small>${esc(D.reqType[r.type] || '')}</small><b>•</b></div><div><b>${esc(r.name)}</b><span>${D.dateTime(r.created_at)}</span></div><a class="bs-btn bs-btn-secondary bs-btn-sm" href="#requests">افتح</a></li>`).join('')}${pouts.length ? `<li><div class="bx-date bx-date-sm"><small>سحب</small><b>•</b></div><div><b>${pouts.length} طلب سحب أرباح</b><span>${D.money(pouts.reduce((s, p) => s + Number(p.amount_egp), 0))}</span></div><a class="bs-btn bs-btn-secondary bs-btn-sm" href="#payouts">افتح</a></li>` : ''}</ol>` : '<div class="bx-empty-big"><b>لا شيء ينتظرك الآن</b></div>')}
        ${courses.filter((c) => c.status === 'draft').length ? `<p class="bx-hint">${courses.filter((c) => c.status === 'draft').length} دورة ما زالت مسودة. أضف محاضراتها من «الدورات» ثم انشرها.</p>` : ''}`;
    },

    async requests(main) {
      const [reqs, users] = await Promise.all([sb.get('requests', { select: '*', order: 'created_at.desc', limit: 200 }), sb.rpc('admin_users').catch(() => [])]);
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      D.setBadge('requests', reqs.filter((r) => r.status === 'new').length);
      let type = '', status = 'open';
      const draw = () => {
        const list = reqs.filter((r) => (!type || r.type === type) && (status === 'all' || (status === 'open' ? ['new', 'in_review'].includes(r.status) : r.status === status)));
        $('#rl').innerHTML = list.length ? list.map((r) => reqCard(r, byId)).join('') : '<div class="bx-empty-big"><b>لا توجد طلبات</b></div>';
      };
      main.innerHTML = `<div class="bx-btnrow" style="margin-bottom:16px"><div class="bx-field"><label for="ft" class="bx-hint">النوع</label><select id="ft" class="bx-select"><option value="">كل الأنواع</option>${Object.entries(D.reqType).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="bx-field"><label for="fs" class="bx-hint">الحالة</label><select id="fs" class="bx-select"><option value="open">مفتوحة</option><option value="all">الكل</option><option value="accepted">مقبولة</option><option value="rejected">مرفوضة</option></select></div></div><div id="rl" style="display:grid;gap:12px"></div>`;
      $('#ft').onchange = (e) => { type = e.target.value; draw(); };
      $('#fs').onchange = (e) => { status = e.target.value; draw(); };
      $('#rl').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const card = b.closest('[data-r]'), id = card.dataset.r, r = reqs.find((x) => x.id === id), act = b.dataset.act;
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
      main.innerHTML = D.panel('الدورات', D.table(['الدورة', 'النوع', 'المحاضر', 'المحاضرات', 'الحالة', ''], courses.map((c) => [`<b class="bs-latin">${esc(c.title)}</b>`, c.kind === 'interactive' ? 'تفاعلي' : 'مسجل', esc((c.featured_instructor_ids || []).map((id) => fName[id]).filter(Boolean).join('، ') || fName[c.featured_instructor_id] || nameOf[c.instructor_id] || '—'), (c.lectures || []).length, D.badge('course', c.status), isAdmin() ? `<button class="bx-linkbtn" data-edit="${c.id}">تعديل</button>` : '']), 'لا توجد دورات'),
        isAdmin() ? '<button class="bs-btn bs-btn-primary bs-btn-sm" id="newc">+ دورة جديدة</button>' : '');
      const open = (c) => courseForm(c, insts);
      const nc = $('#newc', main); if (nc) nc.onclick = () => open(null);
      $$('[data-edit]', main).forEach((b) => (b.onclick = () => open(courses.find((c) => c.id === b.dataset.edit))));
    },

    async users(main) {
      const users = await sb.rpc('admin_users');
      const draw = (t) => {
        const list = users.filter((u) => !t || (u.full_name + ' ' + u.email + ' ' + (u.phone || '')).toLowerCase().includes(t.toLowerCase()));
        $('#ul').innerHTML = D.table(['الاسم', 'البريد', 'الهاتف', 'التسجيل', 'الدور', ''], list.map((u) => [esc(u.full_name || '—'), `<span class="bx-kbd">${esc(u.email)}</span>`, `<span class="bx-kbd">${esc(u.phone || '—')}</span>`, D.date(u.created_at), isAdmin() && u.id !== sb.user.id ? `<select class="bx-select" data-u="${u.id}" aria-label="دور ${esc(u.full_name || u.email)}">${Object.entries(D.roleAr).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select>` : D.roleAr[u.role], isAdmin() ? `<button class="bx-linkbtn" data-dev="${u.id}">مسح الأجهزة</button>` : '']), 'لا يوجد مستخدمون');
      };
      main.innerHTML = D.panel('المستخدمون', `<div class="bx-search" style="margin-bottom:12px"><input id="us" class="bx-input" type="search" placeholder="ابحث بالاسم أو البريد أو الهاتف" aria-label="بحث"></div><div id="ul"></div>`, `<span class="bx-hint">${users.length} مستخدم</span>`);
      $('#us').oninput = (e) => draw(e.target.value); draw('');
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
      const rows = await sb.get('payments', { select: '*,profiles(full_name),plans(name),courses(title)', order: 'created_at.desc', limit: 200 });
      main.innerHTML = D.panel('المدفوعات', D.table(['التاريخ', 'العميل', 'البند', 'السعر', 'الرسوم', 'البوابة', 'الحالة', ''], rows.map((p) => {
        const ref = p.purpose === 'interactive_course' && p.status === 'paid' && p.paid_at && Date.now() <= new Date(p.paid_at).getTime() + 7 * 864e5;
        const manual = p.gateway === 'manual' && p.status === 'pending' && isAdmin();
        return [D.date(p.created_at), esc((p.profiles && p.profiles.full_name) || '—'), esc(p.plans ? p.plans.name : p.courses ? p.courses.title : '—') + (p.receipt_no ? `<br><small class="bx-hint">إيصال ${p.receipt_no}</small>` : ''), D.money(p.amount_egp) + (Number(p.discount_egp) ? `<br><small class="bx-hint">خصم ${D.money(p.discount_egp)}</small>` : ''), D.money(p.fee_egp), (D.gw[p.gateway] || p.gateway) + (p.gateway === 'manual' ? `<br><small class="bx-hint">${p.manual_method === 'instapay' ? 'إنستاباي' : 'فودافون كاش'} · <span class="bs-latin">${esc(p.manual_ref || '')}</span></small>` : ''), D.badge('pay', p.status), manual ? `<button class="bx-linkbtn" data-ma="${p.id}">تأكيد الاستلام</button> · <button class="bx-linkbtn" data-mr="${p.id}" style="color:var(--danger-text)">رفض</button>` : ref && isAdmin() ? `<button class="bx-linkbtn" data-rf="${p.id}">استرداد</button>` : ''];
      }), 'لا توجد مدفوعات'));
      $$('[data-ma],[data-mr]', main).forEach((b) => (b.onclick = async () => {
        const ok = !!b.dataset.ma, id = b.dataset.ma || b.dataset.mr;
        if (!confirm(ok ? 'تأكيد وصول التحويل وتفعيل الاشتراك/التسجيل؟' : 'رفض هذا التحويل؟')) return;
        try { await sb.rpc('admin_review_manual', { p_payment: id, p_approve: ok }); ui.toast(ok ? 'تم التأكيد والتفعيل.' : 'تم الرفض.'); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); }
      }));
      $$('[data-rf]', main).forEach((b) => (b.onclick = async () => {
        if (!confirm('تنفيذ الاسترداد وإلغاء تسجيل الطالب في الكورس؟')) return;
        try { const r = await doRefund(b.dataset.rf); if (r.manual) { if (!confirm('هذه البوابة لا تدعم الاسترداد الآلي. هل نفّذته من لوحة البوابة؟')) return; await sb.fn('refund-payment', { payment_id: b.dataset.rf, manual_confirmed: true }); } ui.toast('تم الاسترداد.'); D.reload(); }
        catch (e) { ui.toast((e.data && e.data.error) || arErr(e), 'err'); }
      }));
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
      const [rows, paid] = await Promise.all([sb.get('coupons', { select: '*', order: 'created_at.desc' }).catch(() => []), sb.get('payments', { select: 'coupon_id', status: 'eq.paid', coupon_id: 'not.is.null' }).catch(() => [])]);
      const used = {}; paid.forEach((p) => (used[p.coupon_id] = (used[p.coupon_id] || 0) + 1));
      const scope = { any: 'الكل', subscription: 'الاشتراكات', interactive_course: 'الدورات التفاعلية' };
      const off = (c) => (c.percent_off ? c.percent_off + '٪' : D.money(c.amount_off_egp));
      main.innerHTML = D.panel('كوبونات الخصم', `<p class="bx-hint" style="margin-top:0">الخصم يُحسب على سعر الباقة، وتُحسب أرباح المحاضرين على المبلغ بعد الخصم. كل عميل يستخدم الكود مرة واحدة.</p>` +
        (isAdmin() ? `<form class="bx-form2" id="cf" novalidate><div class="row2"><div class="bx-field"><label for="cc">الكود</label><input id="cc" class="bx-input" dir="ltr" placeholder="WELCOME20"></div><div class="bx-field"><label for="ct">النوع</label><select id="ct" class="bx-select"><option value="p">نسبة ٪</option><option value="a">مبلغ ثابت (ج.م)</option></select></div><div class="bx-field"><label for="cv">القيمة</label><input id="cv" class="bx-input" type="number" min="1" dir="ltr"></div></div><div class="row2"><div class="bx-field"><label for="cs">ينطبق على</label><select id="cs" class="bx-select"><option value="any">الكل</option><option value="subscription">الاشتراكات</option><option value="interactive_course">الدورات التفاعلية</option></select></div><div class="bx-field"><label for="cm">أقصى عدد استخدامات (اختياري)</label><input id="cm" class="bx-input" type="number" min="1" dir="ltr"></div><div class="bx-field"><label for="ce">ينتهي في (اختياري)</label><input id="ce" class="bx-input" type="date" dir="ltr"></div></div><div class="bx-formmsg" id="cmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">إضافة كوبون</button></div></form><hr style="border:none;border-top:1px solid var(--line);margin:20px 0">` : '') +
        D.table(['الكود', 'الخصم', 'ينطبق على', 'الاستخدام', 'ينتهي', 'مفعّل'], rows.map((c) => [`<b class="bs-latin">${esc(c.code)}</b>`, off(c), scope[c.applies_to], `${used[c.id] || 0}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}`, c.expires_at ? D.date(c.expires_at) : '—', `<input type="checkbox" data-ca="${c.id}" ${c.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}>`]), 'لا توجد كوبونات بعد'));
      const f = $('#cf', main);
      if (f) f.onsubmit = async (e) => {
        e.preventDefault(); const msg = $('#cmsg', main), code = $('#cc', f).value.trim().toUpperCase(), v = Number($('#cv', f).value), pct = $('#ct', f).value === 'p';
        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return say(msg, 'الكود: حروف إنجليزية وأرقام فقط (3 إلى 30).', 'err');
        if (!(v > 0) || (pct && v > 100)) return say(msg, 'قيمة الخصم غير صحيحة.', 'err');
        const row = { code, applies_to: $('#cs', f).value, [pct ? 'percent_off' : 'amount_off_egp']: v };
        if ($('#cm', f).value) row.max_redemptions = Number($('#cm', f).value);
        if ($('#ce', f).value) row.expires_at = new Date($('#ce', f).value + 'T23:59:59+02:00').toISOString();
        try { await sb.insert('coupons', row); ui.toast('تمت إضافة الكوبون.'); D.reload(); } catch (err) { say(msg, /duplicate|unique/i.test(err.message) ? 'هذا الكود موجود بالفعل.' : arErr(err), 'err'); }
      };
      $$('[data-ca]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('coupons', { id: 'eq.' + i.dataset.ca }, { active: i.checked }); ui.toast('تم التحديث.'); } catch (err) { i.checked = !i.checked; ui.toast(arErr(err), 'err'); } }));
    },

    async instructors(main) {
      const rows = await sb.get('featured_instructors', { select: '*', order: 'sort.asc,created_at.asc' }).catch(() => []);
      const FAC = window.FACULTIES || [], fname = (id) => (FAC.find((f) => f.id === id) || {}).name || '—';
      const av = (i) => i.photo_url ? `<img src="${esc(i.photo_url)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : `<span style="width:36px;height:36px;border-radius:50%;display:inline-grid;place-items:center;background:var(--surface-raised);font-weight:700">${esc(window.instInitials ? window.instInitials(i.name) : '')}</span>`;
      main.innerHTML = D.panel('المحاضرين في الموقع', `<p class="bx-hint" style="margin-top:0">دول اللي بيظهروا في الشريط المتحرك في الصفحة الرئيسية وفي صفحة المحاضرين، بالترتيب من الأصغر للأكبر.</p>
        <div class="bx-btnrow" style="margin-bottom:12px">${isAdmin() ? '<button class="bs-btn bs-btn-primary" id="fi-new">إضافة محاضر</button>' : ''}<a class="bs-btn bs-btn-ghost" href="instructors.html" target="_blank" rel="noopener">عرض الصفحة</a></div>` +
        D.table(['', 'الاسم', 'الوصف', 'الكلية', 'الترتيب', 'ظاهر', ''], rows.map((i) => [av(i), `<b>${esc(i.name)}</b>`, `<small>${esc(i.title || '')}</small>`, esc(fname(i.faculty)), String(i.sort),
          `<input type="checkbox" data-fv="${i.id}" ${i.visible ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'} aria-label="ظاهر">`, isAdmin() ? `<button class="bx-linkbtn" data-fe="${i.id}">تعديل</button>` : ''])));
      const edit = (x) => {
        const isNew = !x; x = x || { name: '', title: '', photo_url: '', faculty: '', sort: (rows.length ? Math.max(...rows.map((r) => r.sort)) + 10 : 10), visible: true };
        ui.modal(`<h3>${isNew ? 'إضافة محاضر' : 'تعديل المحاضر'}</h3><form class="bx-form2" id="fif" novalidate>
          <div class="bx-field"><label for="fn">الاسم</label><input id="fn" class="bx-input" maxlength="80" value="${esc(x.name)}" placeholder="د. الاسم"></div>
          <div class="bx-field"><label for="ft">الوصف (الدرجة والجهة)</label><textarea id="ft" class="bx-textarea" rows="2" maxlength="240">${esc(x.title || '')}</textarea></div>
          <div class="row2"><div class="bx-field"><label for="ff">الكلية</label><select id="ff" class="bx-select"><option value="">—</option>${FAC.map((f) => `<option value="${f.id}" ${f.id === x.faculty ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
          <div class="bx-field"><label for="fs">الترتيب</label><input id="fs" class="bx-input" type="number" dir="ltr" value="${x.sort}"></div></div>
          <div class="bx-field"><label for="fpf">الصورة (اختياري)</label><input id="fpf" type="file" accept="image/png,image/jpeg,image/webp" class="bx-input"><small class="bx-hint">صورة مربعة أحسن، أقل من 2 ميجا. لو مفيش صورة هيظهر أول حرفين من الاسم.</small>
            <input type="hidden" id="fpu" value="${esc(x.photo_url || '')}">${x.photo_url ? `<label class="bx-hint" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="fpr"> حذف الصورة الحالية</label>` : ''}</div>
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fvv" ${x.visible ? 'checked' : ''}> ظاهر في الموقع</label>
          <div class="bx-formmsg" aria-live="polite"></div>
          <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button>${isNew ? '' : '<button type="button" class="bs-btn bs-btn-ghost" data-del style="color:var(--danger-text)">حذف</button>'}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
        (m, close) => {
          $('[data-x]', m).onclick = close;
          const del = $('[data-del]', m); if (del) del.onclick = async () => { if (!confirm('حذف المحاضر من الموقع؟')) return; try { await sb.remove('featured_instructors', { id: 'eq.' + x.id }); close(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); } };
          $('#fif', m).onsubmit = async (e) => {
            e.preventDefault(); const msg = $('.bx-formmsg', m), btn = $('button[type=submit]', m);
            const name = $('#fn', m).value.trim(); if (name.length < 2) return say(msg, 'اكتب اسم المحاضر.', 'err');
            const row = { name, title: $('#ft', m).value.trim() || null, faculty: $('#ff', m).value || null, sort: Number($('#fs', m).value) || 100, visible: $('#fvv', m).checked, photo_url: $('#fpu', m).value || null };
            if ($('#fpr', m) && $('#fpr', m).checked) row.photo_url = null;
            const file = $('#fpf', m).files[0];
            btn.disabled = true;
            try {
              if (file) {
                if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('الصورة لازم تكون PNG أو JPG أو WebP.');
                if (file.size > 2 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 2 ميجا.');
                say(msg, 'جارٍ رفع الصورة…');
                const path = `instructors/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
                await sb.storage.upload('site-media', path, file);
                row.photo_url = `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-media/${path}`;
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

    async forms(main) {
      const [forms, subs] = await Promise.all([sb.get('forms', { select: '*', order: 'created_at.desc' }).catch(() => []), sb.get('form_submissions', { select: 'id,form_id,status' }).catch(() => [])]);
      const cnt = {}; subs.forEach((x) => { const c = (cnt[x.form_id] = cnt[x.form_id] || { all: 0, new: 0 }); c.all++; if (x.status === 'new') c.new++; });
      const base = location.href.replace(/admin\.html.*$/, '');
      const link = (f) => base + 'form.html?f=' + encodeURIComponent(f.slug);
      main.innerHTML = D.panel('الفورمز والردود', `<p class="bx-hint" style="margin-top:0">اعمل أي فورم (تسجيل اهتمام، استبيان، طلب خدمة…) وخد رابطه شيره على السوشيال أو واتساب. كل رد بيوصل هنا وعلى إيميل التنبيهات، ولو فيه إيميل أو موبايل بيتبعت للـ CRM كـ Lead. طلبات فورمز الموقع الأساسية (المؤسسات، الاستشارات، المحاضرين) لسه بتوصل في «صندوق الطلبات».</p>
        ${isAdmin() ? '<div class="bx-btnrow" style="margin-bottom:12px"><button class="bs-btn bs-btn-primary" id="fm-new">+ فورم جديد</button></div>' : ''}` +
        D.table(['الفورم', 'الرابط', 'الردود', 'الحالة', ''], forms.map((f) => {
          const c = cnt[f.id] || { all: 0, new: 0 };
          return [`<b>${esc(f.title)}</b><br><small class="bx-hint">${(f.fields || []).length} حقل</small>`,
            `<button class="bx-linkbtn" data-copy="${esc(link(f))}">نسخ الرابط</button> · <a class="bx-linkbtn" href="${esc(link(f))}" target="_blank" rel="noopener">فتح</a>`,
            `${c.all}${c.new ? ` <span class="bx-st bx-st-warn">${c.new} جديد</span>` : ''}`,
            `<label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-fa="${f.id}" ${f.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> ${f.active ? 'مفتوح' : 'مقفول'}</label>`,
            `<button class="bx-linkbtn" data-fr="${f.id}">الردود</button>${isAdmin() ? ` · <button class="bx-linkbtn" data-fe="${f.id}">تعديل</button>` : ''}`];
        }), 'لسه مفيش فورمز. اضغط «فورم جديد».'));
      $$('[data-copy]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); ui.toast('اتنسخ الرابط.'); } catch { prompt('انسخ الرابط:', b.dataset.copy); } }));
      $$('[data-fa]', main).forEach((i) => (i.onchange = async () => { try { await sb.update('forms', { id: 'eq.' + i.dataset.fa }, { active: i.checked }); ui.toast(i.checked ? 'الفورم مفتوح.' : 'الفورم اتقفل.'); D.reload(); } catch (err) { i.checked = !i.checked; ui.toast(arErr(err), 'err'); } }));
      const nb = $('#fm-new', main); if (nb) nb.onclick = () => formBuilder(null);
      $$('[data-fe]', main).forEach((b) => (b.onclick = () => formBuilder(forms.find((f) => f.id === b.dataset.fe))));
      $$('[data-fr]', main).forEach((b) => (b.onclick = () => formResponses(forms.find((f) => f.id === b.dataset.fr))));
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
          `<div class="row2">${field('FAWATERK_API_KEY', 'API key', '')}${field('FAWATERK_BASE_URL', 'رابط الخادم (اختياري)', 'https://staging.fawaterk.com', 'text')}</div>${fee('FAWATERK')}${hook('webhook-fawaterk')}`)}
        ${card('stripe', 'Stripe — بطاقات دولية', 'من لوحة Stripe: Developers ← API keys (Secret key)، وWebhooks ← أضف الرابط بالأسفل مع حدث checkout.session.completed ثم انسخ Signing secret.', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
          `<div class="row2">${field('STRIPE_SECRET_KEY', 'Secret key', 'sk_live_…')}${field('STRIPE_WEBHOOK_SECRET', 'Webhook signing secret', 'whsec_…')}</div>${fee('STRIPE')}${hook('webhook-stripe')}`)}
        ${card('bunny', 'Bunny Stream — استضافة الفيديو', 'من Bunny: Stream ← مكتبتك ← API (Library ID)، وSecurity ← فعّل Token Authentication وانسخ المفتاح.', ['BUNNY_LIBRARY_ID', 'BUNNY_TOKEN_KEY'],
          `<div class="row2">${field('BUNNY_LIBRARY_ID', 'Library ID', '123456', 'text')}${field('BUNNY_TOKEN_KEY', 'Token authentication key', '')}</div>`)}
        ${card('resend', 'Resend — إيميلات المنصة', 'من resend.com: API Keys، وفعّل دومين الإرسال من Domains. عنوان المرسل مثل: Biosyn &lt;no-reply@biosynegypt.com&gt;', ['RESEND_API_KEY', 'MAIL_FROM'],
          `<div class="row2">${field('RESEND_API_KEY', 'API key', 're_…')}${field('MAIL_FROM', 'عنوان المرسل', 'Biosyn <no-reply@biosynegypt.com>', 'text')}</div>`)}
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
      const rows = await sb.get('app_settings', { select: '*' }).catch(() => []); const v = Object.fromEntries(rows.map((r) => [r.key, r.value || '']));
      main.innerHTML = D.panel('الإعدادات', `<p class="bx-hint" style="margin-top:0">تنبيهات الفريق بالبريد تصلك عند كل دفعة وكل طلب جديد. رابط الموقع يُستخدم في أزرار الإيميلات.</p><form class="bx-form2" id="sf" novalidate><div class="row2"><div class="bx-field"><label for="sn">بريد تنبيهات الفريق</label><input id="sn" class="bx-input" type="email" dir="ltr" value="${esc(v.notify_email || '')}"></div><div class="bx-field"><label for="su">رابط الموقع</label><input id="su" class="bx-input" type="url" dir="ltr" placeholder="https://biosynegypt.com" value="${esc(v.site_url || '')}"></div></div><div class="row2"><div class="bx-field"><label for="si">حساب إنستاباي (للتحويل اليدوي)</label><input id="si" class="bx-input" dir="ltr" placeholder="name@instapay" value="${esc(v.instapay_handle || '')}"></div><div class="bx-field"><label for="sv">رقم فودافون كاش</label><input id="sv" class="bx-input" dir="ltr" placeholder="01xxxxxxxxx" value="${esc(v.vodafone_cash_number || '')}"></div></div><p class="bx-hint" style="margin:0">اترك الحقل فارغًا لإخفاء طريقة الدفع اليدوية من صفحة الدفع.</p><div class="bx-formmsg" id="smsg" aria-live="polite"></div>${isAdmin() ? '<div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button></div>' : ''}</form>` +
        '<hr style="border:none;border-top:1px solid var(--line);margin:20px 0"><h4 style="margin:0 0 8px">آخر الإيميلات</h4><div id="ol"></div>');
      const out = await sb.get('email_outbox', { select: 'to_email,subject,status,created_at,last_error', order: 'created_at.desc', limit: 15 }).catch(() => []);
      $('#ol', main).innerHTML = D.table(['التاريخ', 'إلى', 'الموضوع', 'الحالة'], out.map((o) => [D.dateTime(o.created_at), `<span class="bs-latin">${esc(o.to_email)}</span>`, esc(o.subject), { sent: 'أُرسل', pending: 'في الانتظار', sending: 'جارٍ', failed: 'فشل' }[o.status] || o.status]), 'لا توجد رسائل بعد. (لن تُرسل الرسائل قبل ضبط مفاتيح خدمة البريد.)');
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
      main.innerHTML = D.panel('الباقات والأسعار', `<p class="bx-hint" style="margin-top:0">الأسعار تُقرأ من هنا في الموقع وصفحة الدفع. التغيير يسري على المدفوعات الجديدة فقط.</p>` + D.table(['الباقة', 'المدة', 'السعر (ج.م)', 'السعر السابق', 'مفعّلة', ''], plans.map((p) => [esc(p.name), p.duration_months + ' شهر', `<input class="bx-input" type="number" min="0" style="max-width:110px" value="${p.price_egp}" data-f="price_egp" data-p="${p.id}" ${isAdmin() ? '' : 'disabled'}>`, `<input class="bx-input" type="number" min="0" style="max-width:110px" value="${p.old_price_egp ?? ''}" data-f="old_price_egp" data-p="${p.id}" ${isAdmin() ? '' : 'disabled'}>`, `<input type="checkbox" data-f="active" data-p="${p.id}" ${p.active ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}>`, isAdmin() ? `<button class="bs-btn bs-btn-secondary bs-btn-sm" data-save="${p.id}">حفظ</button>` : '']), 'لا توجد باقات'));
      $$('[data-save]', main).forEach((b) => (b.onclick = async () => {
        const id = b.dataset.save, g = (f) => $(`[data-f="${f}"][data-p="${id}"]`, main);
        const price = Number(g('price_egp').value); if (!(price >= 0)) return ui.toast('سعر غير صحيح', 'err');
        try { await sb.update('plans', { id: 'eq.' + id }, { price_egp: price, old_price_egp: g('old_price_egp').value === '' ? null : Number(g('old_price_egp').value), active: g('active').checked }); ui.toast('تم حفظ الباقة.'); } catch (e) { ui.toast(arErr(e), 'err'); }
      }));
    },
  };


  // ---------- form builder + responses ----------
  const FTYPES = { text: 'نص قصير', textarea: 'نص طويل', email: 'إيميل', phone: 'موبايل', number: 'رقم', date: 'تاريخ', select: 'قائمة اختيار', radio: 'اختيار واحد', checkbox: 'اختيارات متعددة' };
  const hasOpts = (t) => t === 'select' || t === 'radio' || t === 'checkbox';
  const rid = () => Math.random().toString(36).slice(2, 9);
  function formBuilder(f) {
    const isNew = !f;
    f = f ? JSON.parse(JSON.stringify(f)) : { title: '', slug: '', description: '', submit_label: '', success_message: '', active: true, notify: true,
      fields: [{ id: rid(), label: 'الاسم', type: 'text', required: true }, { id: rid(), label: 'رقم الموبايل (واتساب)', type: 'phone', required: true }, { id: rid(), label: 'الإيميل', type: 'email', required: false }] };
    ui.modal(`<h3>${isNew ? 'فورم جديد' : 'تعديل الفورم'}</h3><form class="bx-form2" id="fbf" novalidate>
      <div class="row2"><div class="bx-field"><label for="fbt">عنوان الفورم</label><input id="fbt" class="bx-input" maxlength="120" value="${esc(f.title)}" placeholder="مثلًا: سجّل اهتمامك بدبلومة المعلوماتية الحيوية"></div>
      <div class="bx-field"><label for="fbs">الرابط (بالإنجليزي)</label><input id="fbs" class="bx-input" dir="ltr" maxlength="60" value="${esc(f.slug)}" placeholder="bioinformatics-interest"></div></div>
      <div class="bx-field"><label for="fbd">وصف يظهر فوق الفورم (اختياري)</label><textarea id="fbd" class="bx-textarea" rows="2">${esc(f.description || '')}</textarea></div>
      <div class="bx-field"><label>الحقول</label><div id="fbfields" class="bx-fbfields"></div><button type="button" class="bs-btn bs-btn-ghost" id="fbadd" style="justify-self:start">+ إضافة حقل</button></div>
      <div class="row2"><div class="bx-field"><label for="fbb">كلمة زرار الإرسال</label><input id="fbb" class="bx-input" value="${esc(f.submit_label || '')}" placeholder="إرسال"></div>
      <div class="bx-field"><label for="fbm">رسالة بعد الإرسال</label><input id="fbm" class="bx-input" value="${esc(f.success_message || '')}" placeholder="شكرًا! وصلنا ردك وهنتواصل معاك قريبًا."></div></div>
      <div class="bx-row" style="gap:18px"><label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fba" ${f.active ? 'checked' : ''}> الفورم مفتوح لاستقبال ردود</label><label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fbn" ${f.notify ? 'checked' : ''}> ابعتلي إيميل مع كل رد</label></div>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button>${isNew ? '' : '<button type="button" class="bs-btn bs-btn-ghost" data-del style="color:var(--danger-text)">حذف الفورم</button>'}<button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`,
    (m, close) => {
      $('[data-x]', m).onclick = close;
      const t = $('#fbt', m), sl = $('#fbs', m);
      if (isNew) t.oninput = () => { if (!sl.dataset.touched) sl.value = t.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ''; };
      sl.oninput = () => (sl.dataset.touched = '1');
      const box = $('#fbfields', m);
      const read = () => { $$('.bx-fbrow', box).forEach((r, i) => { const x = f.fields[i]; x.label = $('[data-l]', r).value.trim(); x.type = $('[data-t]', r).value; x.required = $('[data-r]', r).checked; const o = $('[data-o]', r); x.options = o ? o.value.split('\n').map((v) => v.trim()).filter(Boolean) : []; }); };
      const draw = () => {
        box.innerHTML = f.fields.map((x, i) => `<div class="bx-fbrow"><div class="bx-fbmain"><input class="bx-input" data-l value="${esc(x.label)}" placeholder="اسم الحقل (السؤال)" aria-label="اسم الحقل"><select class="bx-select" data-t aria-label="نوع الحقل">${Object.entries(FTYPES).map(([k, v]) => `<option value="${k}" ${k === x.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label class="bx-hint" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-r ${x.required ? 'checked' : ''}> إجباري</label>
          <span class="bx-btnrow" style="gap:2px"><button type="button" class="bx-linkbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="لفوق">↑</button><button type="button" class="bx-linkbtn" data-dn="${i}" ${i < f.fields.length - 1 ? '' : 'disabled'} aria-label="لتحت">↓</button><button type="button" class="bx-linkbtn" data-rm="${i}" style="color:var(--danger-text)" aria-label="حذف">✕</button></span></div>
          ${hasOpts(x.type) ? `<textarea class="bx-textarea" data-o rows="3" placeholder="كل اختيار في سطر">${esc((x.options || []).join('\n'))}</textarea>` : ''}</div>`).join('') || '<p class="bx-hint">مفيش حقول. ضيف حقل.</p>';
        $$('[data-t]', box).forEach((sel) => (sel.onchange = () => { read(); draw(); }));
        $$('[data-up]', box).forEach((b) => (b.onclick = () => { read(); const i = +b.dataset.up; [f.fields[i - 1], f.fields[i]] = [f.fields[i], f.fields[i - 1]]; draw(); }));
        $$('[data-dn]', box).forEach((b) => (b.onclick = () => { read(); const i = +b.dataset.dn; [f.fields[i + 1], f.fields[i]] = [f.fields[i], f.fields[i + 1]]; draw(); }));
        $$('[data-rm]', box).forEach((b) => (b.onclick = () => { read(); f.fields.splice(+b.dataset.rm, 1); draw(); }));
      };
      draw();
      $('#fbadd', m).onclick = () => { read(); f.fields.push({ id: rid(), label: '', type: 'text', required: false }); draw(); const ls = $$('[data-l]', box); ls[ls.length - 1].focus(); };
      const del = $('[data-del]', m); if (del) del.onclick = async () => { if (!confirm('حذف الفورم وكل الردود عليه نهائيًا؟')) return; try { await sb.remove('forms', { id: 'eq.' + f.id }); close(); D.reload(); } catch (e) { ui.toast(arErr(e), 'err'); } };
      $('#fbf', m).onsubmit = async (e) => {
        e.preventDefault(); read(); const msg = $('.bx-formmsg', m);
        const row = { title: t.value.trim(), slug: sl.value.trim().toLowerCase(), description: $('#fbd', m).value.trim() || null, submit_label: $('#fbb', m).value.trim() || null, success_message: $('#fbm', m).value.trim() || null, active: $('#fba', m).checked, notify: $('#fbn', m).checked, updated_at: new Date().toISOString() };
        if (row.title.length < 2) return say(msg, 'اكتب عنوان الفورم.', 'err');
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(row.slug)) return say(msg, 'الرابط لازم يكون حروف إنجليزي صغيرة وأرقام وشرطة (-) بس.', 'err');
        const fields = f.fields.filter((x) => x.label);
        if (!fields.length) return say(msg, 'ضيف حقل واحد على الأقل.', 'err');
        const bad = fields.find((x) => hasOpts(x.type) && !(x.options || []).length); if (bad) return say(msg, `اكتب اختيارات الحقل "${bad.label}".`, 'err');
        row.fields = fields.map((x) => ({ id: x.id, label: x.label, type: x.type, required: !!x.required, ...(hasOpts(x.type) ? { options: x.options } : {}) }));
        try { if (isNew) await sb.insert('forms', row); else await sb.update('forms', { id: 'eq.' + f.id }, row); ui.toast('تم حفظ الفورم.'); close(); D.reload(); }
        catch (err) { say(msg, /duplicate|unique/i.test(err.message) ? 'الرابط ده مستخدم لفورم تاني.' : arErr(err), 'err'); }
      };
    });
  }
  async function formResponses(f) {
    let rows = await sb.get('form_submissions', { select: '*', form_id: 'eq.' + f.id, order: 'created_at.desc' }).catch(() => []);
    const cols = [...new Set([...(f.fields || []).map((x) => x.label), ...rows.flatMap((r) => Object.keys(r.data || {}))])];
    const ST = { new: ['جديد', 'warn'], read: ['اتشاف', 'info'], done: ['تم', 'ok'] };
    const csv = () => {
      const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['التاريخ', ...cols, 'الحالة'].map(q).join(','), ...rows.map((r) => [new Date(r.created_at).toLocaleString('en-GB'), ...cols.map((c) => r.data[c]), (ST[r.status] || [r.status])[0]].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `${f.slug}-responses.csv`; a.click();
    };
    ui.modal(`<h3>ردود: ${esc(f.title)}</h3><p class="bx-hint" style="margin:0">${rows.length} رد</p>
      <div class="bx-btnrow" style="margin:8px 0 12px"><button class="bs-btn bs-btn-primary bs-btn-sm" id="frcsv" ${rows.length ? '' : 'disabled'}>تحميل Excel (CSV)</button><button class="bs-btn bs-btn-ghost bs-btn-sm" data-x>إغلاق</button></div>
      <div class="bx-scroll" style="max-height:60vh">${rows.length ? `<table class="bx-table"><thead><tr><th>التاريخ</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>الحالة</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr><td style="white-space:nowrap">${D.date(r.created_at)}</td>${cols.map((c) => `<td>${esc(r.data[c] ?? '')}</td>`).join('')}
        <td><select class="bx-select" data-rs="${r.id}" style="min-width:90px;height:34px;padding:0 8px">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></td>${isAdmin() ? `<td><button class="bx-linkbtn" data-rd="${r.id}" style="color:var(--danger-text)">حذف</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="bx-hint">لسه مفيش ردود. شير رابط الفورم.</p>'}</div>`,
    (m, close) => {
      $('[data-x]', m).onclick = () => { close(); D.reload(); };
      const cb = $('#frcsv', m); if (cb) cb.onclick = csv;
      $$('[data-rs]', m).forEach((sel) => (sel.onchange = async () => { try { await sb.update('form_submissions', { id: 'eq.' + sel.dataset.rs }, { status: sel.value }); const r = rows.find((x) => x.id === sel.dataset.rs); if (r) r.status = sel.value; ui.toast('تم التحديث.'); } catch (e) { ui.toast(arErr(e), 'err'); } }));
      $$('[data-rd]', m).forEach((b) => (b.onclick = async () => { if (!confirm('حذف الرد ده؟')) return; try { await sb.remove('form_submissions', { id: 'eq.' + b.dataset.rd }); rows = rows.filter((x) => x.id !== b.dataset.rd); b.closest('tr').remove(); } catch (e) { ui.toast(arErr(e), 'err'); } }));
      // opening the list marks new responses as seen
      const fresh = rows.filter((r) => r.status === 'new').map((r) => r.id);
      if (fresh.length) sb.update('form_submissions', { id: 'in.(' + fresh.join(',') + ')' }, { status: 'read' }).catch(() => {});
    });
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
    const close = ui.modal(`<h3>${isNew ? 'دورة جديدة' : 'تعديل: ' + esc(c.title)}</h3>
      <form class="bx-form2" id="cf" novalidate>
        <div class="row2"><div class="bx-field"><label for="ct">العنوان</label><input id="ct" class="bx-input" value="${esc(c.title || '')}"></div><div class="bx-field"><label for="cs">الرابط (slug)</label><input id="cs" class="bx-input" dir="ltr" value="${esc(c.slug || '')}"></div></div>
        <div class="row2"><div class="bx-field"><label for="ck">النوع</label><select id="ck" class="bx-select" ${isNew ? '' : 'disabled'}>${opt({ recorded: 'مسجل', interactive: 'تفاعلي' }, c.kind)}</select></div><div class="bx-field"><label for="cst">الحالة</label><select id="cst" class="bx-select">${opt({ draft: 'مسودة', review: 'قيد المراجعة', published: 'منشور', archived: 'مؤرشف' }, c.status)}</select></div><div class="bx-field"><label for="cl">المستوى</label><select id="cl" class="bx-select">${opt(LV, c.level)}</select></div></div>
        <div class="bx-field"><label>المحاضرين</label><div id="cinsts" class="bx-fbfields"></div><button type="button" class="bs-btn bs-btn-ghost" id="ciadd" style="justify-self:start">+ إضافة محاضر آخر</button>
          <small class="bx-hint">أول محاضر له حساب على المنصة هو اللي بتتحسب له أرباح المشاهدات.</small></div>
        <div class="bx-field"><label for="cc">اختصار الغلاف (اختياري)</label><input id="cc" class="bx-input" dir="ltr" maxlength="3" value="${esc(c.cover_code || '')}" placeholder="مثلًا BD"><small class="bx-hint">حرفين بيظهروا كبار على غلاف الكورس لو مفيش صورة، زي MB لـ Molecular Biology. لو سبته فاضي بيتعمل تلقائي من أول حرفين في العنوان.</small></div>
        <div class="row2"><div class="bx-field"><label for="cfa">الكلية</label><select id="cfa" class="bx-select"><option value="">—</option><option value="all" ${c.faculty === 'all' ? 'selected' : ''}>كل الكليات</option>${(window.FACULTIES || []).map((f) => `<option value="${f.id}" ${f.id === (c.faculty || (window.facultyOf ? window.facultyOf(c) : '')) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div><div class="bx-field"><label for="csp">التخصص</label><input id="csp" class="bx-input" list="csp-l" value="${esc(c.specialty || '')}" placeholder="اختر من القائمة أو اكتب تخصصًا"><datalist id="csp-l"></datalist></div></div>
        <div class="bx-field"><label for="csu">وصف مختصر</label><input id="csu" class="bx-input" value="${esc(c.summary || '')}"></div>
        <div class="bx-field"><label for="cd">الوصف الكامل</label><textarea id="cd" class="bx-textarea">${esc(c.description || '')}</textarea></div>
        <div class="row2" id="ia" ${c.kind === 'interactive' ? '' : 'hidden'}><div class="bx-field"><label for="cp">سعر الكورس (ج.م)</label><input id="cp" class="bx-input" type="number" min="0" value="${c.price_egp ?? ''}"></div><div class="bx-field"><label for="cse">المقاعد</label><input id="cse" class="bx-input" type="number" min="1" value="${c.seats ?? ''}"></div><div class="bx-field"><label for="cdt">تاريخ البدء</label><input id="cdt" class="bx-input" type="date" value="${c.starts_at ? String(c.starts_at).slice(0, 10) : ''}"></div></div>
        <div class="bx-formmsg" id="cm" aria-live="polite"></div>
        <div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="submit">${isNew ? 'إنشاء' : 'حفظ'}</button><button class="bs-btn bs-btn-ghost" type="button" data-x>إغلاق</button></div>
      </form>
      ${isNew ? '<p class="bx-hint">بعد الإنشاء يمكنك إضافة المحاضرات.</p>' : `<hr style="border:0;border-top:1px solid var(--line);width:100%"><h3>المحاضرات</h3><div id="ll"></div><div id="lfiles" style="margin-top:12px"></div>
      <form class="bx-form2" id="lf" novalidate><div class="row2"><div class="bx-field"><label for="lt">عنوان المحاضرة</label><input id="lt" class="bx-input"></div><div class="bx-field"><label for="lv">معرّف الفيديو في Bunny (GUID)</label><input id="lv" class="bx-input" dir="ltr" placeholder="xxxxxxxx-xxxx-…"></div><div class="bx-field"><label for="ld">المدة (دقائق:ثواني)</label><input id="ld" class="bx-input" dir="ltr" placeholder="12:30"></div></div><label class="bx-hint" style="display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="lpv"> محاضرة معاينة مجانية (يشاهدها أي زائر مسجّل دخوله)</label><div class="bx-formmsg" id="lm" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-secondary" type="submit">+ إضافة محاضرة</button></div></form>`}`,
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
          <label class="bx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-civ checked> إظهاره كمان في صفحة المحاضرين والشريط المتحرك</label></div>`;
        rowsBox.appendChild(row);
        $('[data-ci]', row).onchange = () => fill(row);
        $('[data-cirm]', row).onclick = () => { row.remove(); if (!rowsBox.children.length) addRow(''); };
        fill(row);
      };
      (curInsts.length ? curInsts : ['']).forEach(addRow);
      $('#ciadd', m).onclick = () => addRow('');
      const instFields = async () => {
        const ids = []; let account = null;
        for (const row of $$('.bx-fbrow', rowsBox)) {
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
      $('#cf', m).onsubmit = async (e) => {
        e.preventDefault(); const msg = $('#cm', m), g = (id) => $('#' + id, m).value.trim();
        if (!g('ct') || !g('cs')) return say(msg, 'اكتب العنوان والرابط.', 'err');
        const kind = g('ck'), row = { title: g('ct'), slug: g('cs'), kind, status: g('cst'), level: g('cl'), cover_code: g('cc') || autoCode(g('ct')) || null, specialty: g('csp') || null, faculty: g('cfa') || null, summary: g('csu') || null, description: g('cd') || null,
          price_egp: kind === 'interactive' && g('cp') !== '' ? Number(g('cp')) : null, seats: kind === 'interactive' && g('cse') !== '' ? Number(g('cse')) : null, starts_at: kind === 'interactive' && g('cdt') ? new Date(g('cdt')).toISOString() : null };
        if (kind === 'interactive' && row.status === 'published' && row.price_egp === null) return say(msg, 'حدّد سعر الكورس التفاعلي قبل النشر.', 'err');
        if (kind === 'recorded' && row.status === 'published' && !lects.length) return say(msg, 'أضف محاضرة واحدة على الأقل قبل نشر الدورة.', 'err');
        try { Object.assign(row, await instFields()); isNew ? await sb.insert('courses', row) : await sb.update('courses', { id: 'eq.' + c.id }, row); ui.toast('تم الحفظ.'); cl(); D.reload(); }
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
    const items = [{ id: 'home', label: 'اليوم', icon: 'home' }, { id: 'requests', label: 'صندوق الطلبات', icon: 'inbox' }, { id: 'courses', label: 'الدورات', icon: 'book' }, { id: 'users', label: 'المستخدمون', icon: 'users' }, { id: 'payments', label: 'المدفوعات', icon: 'card' }, { id: 'payouts', label: 'سحوبات المحاضرين', icon: 'coin' }, { id: 'plans', label: 'الباقات والأسعار', icon: 'list' }, { id: 'coupons', label: 'كوبونات الخصم', icon: 'card' }, { id: 'forms', label: 'الفورمز والردود', icon: 'inbox' }, { id: 'instructors', label: 'المحاضرين في الموقع', icon: 'users' }, { id: 'blog', label: 'المدونة', icon: 'book' }, { id: 'integrations', label: 'التكاملات', icon: 'card' }, { id: 'settings', label: 'الإعدادات', icon: 'list' }];
    await D.shell({ title: 'لوحة الإدارة', who: me.full_name || sb.user.email, sub: D.roleAr[me.role], items, views });
  };
})();
