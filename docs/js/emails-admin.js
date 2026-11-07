/* Admin → «رسائل البريد» (wording + design of every automated email, on/off per type, latest copy)
   and «حملات البريد» (compose a campaign, pick an audience, test, send gradually within the daily limit). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const say = (m, t, k) => { m.className = 'bx-formmsg' + (k ? ' ' + k : ''); m.textContent = t; };
  const frame = (html) => `<iframe title="معاينة الرسالة" sandbox="" style="width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#eef0f8" srcdoc="${esc(html || '')}"></iframe>`;

  const KINDS = [
    { fn: 'email_html', name: 'التصميم العام للرسائل', desc: 'الرأس والتذييل المشتركان بين كل الرسائل.' },
    { fn: 'trg_welcome_user', name: 'الترحيب بعد إنشاء الحساب', types: ['welcome'] },
    { fn: 'trg_mail_subscription', name: 'تأكيد الاشتراك وهدايا الدعوات', types: ['pay', 'ref'], core: ['pay'] },
    { fn: 'enqueue_expiry_reminders', name: 'تذكير انتهاء الاشتراك', desc: 'قبل أسبوع، وقبل 3 أيام، وقبل يوم، وبعد الانتهاء.', types: ['exp'] },
    { fn: 'trg_mail_certificate', name: 'الشهادة جاهزة', types: ['cert'] },
    { fn: 'trg_mail_enrollment', name: 'تأكيد التسجيل في دورة تفاعلية', types: ['pay'], core: ['pay'] },
    { fn: 'trg_notify_misc', name: 'التحويلات اليدوية والاستشارات', types: ['mrecv', 'mrej', 'pay'], core: ['pay'] },
    { fn: 'trg_mail_refund_decision', name: 'قرار الاسترداد', types: ['refund'], core: ['refund'] },
    { fn: 'trg_mail_thread_message', name: 'الرسائل والتذاكر', types: ['thr'] },
    { fn: 'trg_mail_earning', name: 'أرباح المحاضر الشهرية', types: ['earn'] },
    { fn: 'sign_contract', name: 'نسخة اتفاقية المحاضر', types: ['contract'] },
    { fn: 'reactivation_mail', name: 'حملة إعادة التفعيل', types: ['reactivation'] },
    { fn: 'campaign_mail', name: 'حملات البريد (سطر إلغاء الاشتراك)', types: ['campaign'] },
    { fn: 'trg_mail_request', name: 'تنبيه الفريق بطلب جديد', desc: 'تصل إلى بريد التنبيهات فقط.' },
    { fn: 'trg_form_submission', name: 'تنبيه الفريق برد على نموذج', desc: 'تصل إلى بريد التنبيهات فقط.' },
    { fn: 'fulfil_payment', name: 'تنبيه الفريق بدفع استشارة', desc: 'تصل إلى بريد التنبيهات فقط.' },
    { fn: 'alert_stuck_webhooks', name: 'تنبيه الفريق بإشعار دفع متأخر', desc: 'تصل إلى بريد التنبيهات فقط.' },
  ];

  window.emailsAdmin = async function (main) {
    const [cat, ovs, cfgRow] = await Promise.all([
      sb.rpc('email_catalog').catch(() => null),
      sb.get('text_overrides', { select: '*', scope: 'eq.email' }).catch(() => []),
      sb.one('site_content', { select: 'data', key: 'eq.email_settings' }).catch(() => null),
    ]);
    const cfg = Object.assign({ header_color: '#010232', accent_color: '#c6f84a', disabled: [] }, (cfgRow && cfgRow.data) || {});
    const byFn = Object.fromEntries((cat || []).map((c) => [c.fn, c]));
    const ov = Object.fromEntries(ovs.map((o) => [o.original, o]));
    const off = new Set(cfg.disabled || []);
    main.innerHTML = `${D.panel('التصميم العام', `<div class="row2"><div class="bx-field"><label for="em-hc">لون رأس الرسالة</label><input id="em-hc" type="color" value="${esc(cfg.header_color)}" class="bx-input" style="height:44px;padding:4px"></div>
        <div class="bx-field"><label for="em-ac">لون الزر والشريط</label><input id="em-ac" type="color" value="${esc(cfg.accent_color)}" class="bx-input" style="height:44px;padding:4px"></div></div>
        <p class="bx-hint">لتغيير نص التذييل أو أي جملة مشتركة افتح «التصميم العام للرسائل» بالأسفل. تُطبَّق التعديلات على الرسائل الجديدة فقط.</p>
        <div class="bx-formmsg" id="em-dmsg" aria-live="polite"></div><div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="button" id="em-dsave">حفظ الألوان</button></div>`)}
      ${D.panel('الرسائل التلقائية', `<p class="bx-hint" style="margin-top:0">كل رسالة ترسلها المنصة تلقائيًا. افتح أي رسالة لتعديل جملها أو إيقافها أو معاينة آخر نسخة أُرسلت. الأجزاء المتغيرة (مثل الاسم والتاريخ والمبلغ) تُضاف تلقائيًا ولا تظهر هنا.</p>
        <div style="display:grid;gap:10px">${KINDS.filter((k) => byFn[k.fn]).map((k) => {
          const n = (byFn[k.fn].texts || []).filter((t) => ov[t]).length, isOff = (k.types || []).length && (k.types || []).every((t) => off.has(t));
          return `<div class="bx-panel" style="margin:0;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><b>${esc(k.name)}</b>${k.desc ? `<br><small class="bx-hint">${esc(k.desc)}</small>` : ''}</div>
            ${n ? `<span class="bx-st bx-st-info">${n} تعديل</span>` : ''}${isOff ? '<span class="bx-st bx-st-mute">متوقفة</span>' : ''}<button class="bs-btn bs-btn-secondary bs-btn-sm" data-k="${k.fn}">فتح</button></div>`; }).join('')}</div>`)}`;

    $('#em-dsave', main).onclick = async () => {
      const m = $('#em-dmsg', main);
      try { await sb.update('site_content', { key: 'eq.email_settings' }, { data: { ...cfg, header_color: $('#em-hc', main).value, accent_color: $('#em-ac', main).value }, updated_at: new Date().toISOString() }); say(m, 'تم الحفظ ✓ وستظهر الألوان في الرسائل الجديدة.', 'ok'); }
      catch (e) { say(m, arErr(e), 'err'); }
    };
    $$('[data-k]', main).forEach((b) => (b.onclick = () => open(KINDS.find((k) => k.fn === b.dataset.k))));

    async function open(k) {
      const texts = (byFn[k.fn].texts || []).filter((t) => !/^(\s*<\/?[a-z][^>]*>\s*)+$/i.test(t)).sort((a, b) => b.length - a.length);
      const latest = (k.types || []).length ? await Promise.all(k.types.map((t) => sb.rpc('email_latest', { p_type: t }).catch(() => null))).then((l) => l.filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1))[0]) : null;
      ui.modal(`<h3>${esc(k.name)}</h3>
        ${(k.types || []).length ? `<label class="bx-check"><input type="checkbox" id="em-on" ${(k.types || []).every((t) => off.has(t)) ? '' : 'checked'}> الرسالة مفعّلة</label>${(k.core || []).length ? '<p class="bx-hint" style="margin:0 0 10px">⚠️ هذه الرسالة مهمة للمستخدمين (تأكيد دفع أو قرار)، ولا يُنصح بإيقافها.</p>' : ''}` : ''}
        <div class="bx-tabs" role="tablist" style="margin:10px 0"><button class="bx-chip" aria-pressed="true" data-tab="t">النصوص (${texts.length})</button><button class="bx-chip" aria-pressed="false" data-tab="p">آخر نسخة أُرسلت</button></div>
        <div data-pane="t"><p class="bx-hint" style="margin-top:0">اكتب الصيغة الجديدة في الخانة تحت الجملة الأصلية، واتركها فارغة لاستخدام الأصل. لا تغيّر رموز HTML مثل &lt;b&gt; إن وُجدت.</p>
          <input class="bx-input" id="em-q" placeholder="ابحث في نصوص هذه الرسالة" style="margin-bottom:10px">
          <div id="em-list" style="display:grid;gap:12px;max-height:52vh;overflow:auto;padding-inline-end:4px">${texts.map((t, i) => `<div class="bx-field" data-row="${i}" style="margin:0"><small class="bx-hint" dir="auto" style="white-space:pre-wrap">${esc(t)}</small><textarea class="bx-textarea" rows="${Math.min(5, Math.ceil(t.length / 70) + 1)}" data-i="${i}" dir="auto" placeholder="الصيغة الجديدة (اختياري)">${esc(ov[t] ? ov[t].replacement : '')}</textarea></div>`).join('') || '<p class="bx-hint">لا توجد نصوص قابلة للتعديل.</p>'}</div></div>
        <div data-pane="p" hidden>${latest ? `<p class="bx-hint" style="margin-top:0">${esc(latest.subject)} · ${D.dateTime(latest.at)}</p>${frame(latest.html)}` : '<p class="bx-hint">لم تُرسل هذه الرسالة بعد، أو لا توجد نسخة محفوظة.</p>'}</div>
        <div class="bx-formmsg" aria-live="polite"></div>
        <div class="bx-modal-actions"><button type="button" class="bs-btn bs-btn-ghost" data-x>إغلاق</button><button type="button" class="bs-btn bs-btn-primary" data-save>حفظ</button></div>`, (m, close) => {
        $('[data-x]', m).onclick = close;
        $$('[data-tab]', m).forEach((b) => (b.onclick = () => { $$('[data-tab]', m).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $$('[data-pane]', m).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab)); }));
        $('#em-q', m).oninput = (e) => { const q = e.target.value.trim(); $$('[data-row]', m).forEach((r) => (r.hidden = !!q && !texts[+r.dataset.row].includes(q) && !$('textarea', r).value.includes(q))); };
        $('[data-save]', m).onclick = async (ev) => {
          const msg = $('.bx-formmsg', m); ev.target.disabled = true;
          try {
            for (const ta of $$('[data-i]', m)) {
              const t = texts[+ta.dataset.i], v = ta.value.trim(), cur = ov[t];
              if (!v || v === t) { if (cur) { await sb.remove('text_overrides', { id: 'eq.' + cur.id }); delete ov[t]; } continue; }
              if (cur && cur.replacement === v) continue;
              if (cur) await sb.update('text_overrides', { id: 'eq.' + cur.id }, { replacement: v, updated_at: new Date().toISOString() });
              else { const [row] = await sb.insert('text_overrides', { scope: 'email', original: t, replacement: v, page: k.fn }); ov[t] = row; }
            }
            if ((k.types || []).length && $('#em-on', m)) {
              const on = $('#em-on', m).checked; k.types.forEach((t) => (on ? off.delete(t) : off.add(t)));
              await sb.update('site_content', { key: 'eq.email_settings' }, { data: { ...cfg, disabled: [...off] }, updated_at: new Date().toISOString() });
            }
            ui.toast('تم الحفظ ✓'); close(); D.reload();
          } catch (e) { ev.target.disabled = false; say(msg, arErr(e), 'err'); }
        };
      });
    }
  };

  // ---------------- campaigns ----------------
  const AUD = { all_users: 'كل المستخدمين المسجلين', subscribers: 'المشتركون حاليًا', non_subscribers: 'الطلاب غير المشتركين', instructors: 'المحاضرون', legacy_all: 'كل مستخدمي المنصة القديمة', legacy_pending: 'مستخدمو المنصة القديمة الذين لم يفعّلوا حساباتهم', newsletter: 'مشتركو النشرة البريدية' };
  const ST = { draft: ['مسودة', 'mute'], sending: ['جارٍ الإرسال', 'info'], paused: ['متوقفة مؤقتًا', 'warn'], done: ['اكتملت', 'ok'] };
  window.campaignsAdmin = async function (main) {
    const list = await sb.get('email_campaigns', { select: '*', order: 'created_at.desc', limit: 200 }).catch(() => []);
    main.innerHTML = D.panel('حملات البريد', `<p class="bx-hint" style="margin-top:0">اكتب رسالة واختر الجمهور ثم أرسلها. تُرسل الحملات بالتدريج يوميًا مع المهمة المجدولة (الساعة 10:13 صباحًا)، ولا يتجاوز مجموع رسائل المنصة <b>95 رسالة خلال 24 ساعة</b> للبقاء ضمن الباقة المجانية. حملة إعادة التفعيل لها الأولوية، وتأخذ الحملات ما يتبقى. يُستبعد تلقائيًا كل من ألغى الاشتراك في الرسائل، وفي كل رسالة رابط لإلغاء الاشتراك.</p>
      ${D.table(['الحملة', 'الجمهور', 'الحالة', 'التقدم', ''], list.map((c) => [`<b dir="auto">${esc(c.name)}</b><br><small class="bx-hint" dir="auto">${esc(c.subject)}</small>`, AUD[c.audience] || c.audience,
        `<span class="bx-st bx-st-${(ST[c.status] || ['', 'mute'])[1]}">${(ST[c.status] || [c.status])[0]}</span>`, c.total ? `${c.sent} / ${c.total}` : '—', `<button class="bs-btn bs-btn-secondary bs-btn-sm" data-c="${c.id}">فتح</button>`]), 'لا توجد حملات بعد.')}`,
      '<button class="bs-btn bs-btn-primary bs-btn-sm" type="button" id="cp-new">+ حملة جديدة</button>');
    $('#cp-new', main).onclick = () => edit(null);
    $$('[data-c]', main).forEach((b) => (b.onclick = () => edit(list.find((c) => c.id === b.dataset.c))));

    function edit(c) {
      const x = c || { name: '', subject: '', heading: 'مرحبًا {name} 👋', body: '', cta_label: '', cta_url: '', audience: 'all_users', status: 'draft' };
      const ro = x.status !== 'draft';
      ui.modal(`<h3>${c ? esc(c.name) : 'حملة جديدة'}</h3>${c ? `<p class="bx-hint" style="margin-top:0"><span class="bx-st bx-st-${ST[c.status][1]}">${ST[c.status][0]}</span> ${c.total ? `· أُرسلت ${c.sent} من ${c.total}` : ''}</p>` : ''}
        <form class="bx-form2" id="cpf" novalidate>
          <div class="bx-field"><label for="cp-n">اسم الحملة (للإدارة فقط)</label><input id="cp-n" class="bx-input" value="${esc(x.name)}" maxlength="100" ${ro ? 'disabled' : ''} placeholder="مثال: عرض الباقة السنوية – نوفمبر"></div>
          <div class="bx-field"><label for="cp-a">الجمهور</label><select id="cp-a" class="bx-select" ${ro ? 'disabled' : ''}>${Object.entries(AUD).map(([k, v]) => `<option value="${k}" ${k === x.audience ? 'selected' : ''}>${v}</option>`).join('')}</select><small class="bx-hint" id="cp-cnt"></small></div>
          <div class="bx-field"><label for="cp-s">عنوان الرسالة *</label><input id="cp-s" class="bx-input" value="${esc(x.subject)}" maxlength="150" ${ro ? 'disabled' : ''}></div>
          <div class="bx-field"><label for="cp-h">العنوان داخل الرسالة *</label><input id="cp-h" class="bx-input" value="${esc(x.heading)}" maxlength="150" ${ro ? 'disabled' : ''}></div>
          <div class="bx-field"><label for="cp-b">نص الرسالة *</label><textarea id="cp-b" class="bx-textarea" rows="9" dir="rtl" ${ro ? 'disabled' : ''}>${esc(x.body)}</textarea>
            <small class="bx-hint">كل سطر فقرة. اكتب <b dir="ltr">{name}</b> ليُستبدل بالاسم الأول، وضع الكلام بين <b dir="ltr">**نجمتين**</b> ليظهر بخط عريض.</small></div>
          <div class="row2"><div class="bx-field"><label for="cp-cl">نص الزر (اختياري)</label><input id="cp-cl" class="bx-input" value="${esc(x.cta_label || '')}" maxlength="60" ${ro ? 'disabled' : ''} placeholder="مثال: اشترك الآن"></div>
            <div class="bx-field"><label for="cp-cu">رابط الزر</label><input id="cp-cu" class="bx-input" dir="ltr" value="${esc(x.cta_url || '')}" ${ro ? 'disabled' : ''} placeholder="pricing.html أو https://…"></div></div>
          <div class="bx-formmsg" aria-live="polite"></div>
          <div id="cp-prev"></div>
          <div class="bx-modal-actions">
            ${c && x.status === 'draft' ? '<button type="button" class="bs-btn bs-btn-ghost" data-del style="margin-inline-end:auto">حذف</button>' : ''}
            <button type="button" class="bs-btn bs-btn-ghost" data-x>إغلاق</button>
            ${!ro ? '<button type="submit" class="bs-btn bs-btn-secondary">حفظ ومعاينة</button>' : ''}
            ${c ? '<button type="button" class="bs-btn bs-btn-ghost" data-test>إرسال تجربة إلى بريدي</button>' : ''}
            ${c && (x.status === 'draft' || x.status === 'paused') ? `<button type="button" class="bs-btn bs-btn-primary" data-go>${x.status === 'paused' ? 'استئناف الإرسال' : 'بدء الإرسال'}</button>` : ''}
            ${c && x.status === 'sending' ? '<button type="button" class="bs-btn bs-btn-ghost" data-pause>إيقاف مؤقت</button>' : ''}
          </div></form>`, (m, close) => {
        const msg = $('.bx-formmsg', m);
        $('[data-x]', m).onclick = close;
        const count = async () => { const n = await sb.rpc('campaign_audience_count', { p_audience: $('#cp-a', m).value }).catch(() => null); $('#cp-cnt', m).textContent = n == null ? '' : `سيصل إلى ${n} شخص تقريبًا (بعد استبعاد من ألغوا الاشتراك) · يستغرق الإرسال ${Math.max(1, Math.ceil(n / 80))} يوم أو أكثر`; };
        $('#cp-a', m).onchange = count; count();
        const preview = async (id) => { try { const p = await sb.rpc('campaign_preview', { p_id: id }); $('#cp-prev', m).innerHTML = `<p class="bx-hint">معاينة: <b>${esc(p.subject)}</b></p>${frame(p.html)}`; } catch (e) { /* ignore */ } };
        if (c) preview(c.id);
        $('#cpf', m).onsubmit = async (e) => {
          e.preventDefault(); if (ro) return;
          const row = { name: $('#cp-n', m).value.trim(), audience: $('#cp-a', m).value, subject: $('#cp-s', m).value.trim(), heading: $('#cp-h', m).value.trim(), body: $('#cp-b', m).value.trim(), cta_label: $('#cp-cl', m).value.trim() || null, cta_url: $('#cp-cu', m).value.trim() || null };
          if (!row.name || row.subject.length < 4 || row.heading.length < 2 || row.body.length < 10) return say(msg, 'اكتب اسم الحملة والعنوانين ونص الرسالة.', 'err');
          if (row.cta_label && !row.cta_url) return say(msg, 'اكتب رابط الزر.', 'err');
          if (row.cta_url && !/^(https:\/\/|[a-z0-9-]+\.html)/i.test(row.cta_url)) return say(msg, 'يجب أن يبدأ الرابط بـ https:// أو يكون صفحة من الموقع مثل pricing.html.', 'err');
          try {
            if (c) { await sb.update('email_campaigns', { id: 'eq.' + c.id }, row); Object.assign(c, row); } else { const [n] = await sb.insert('email_campaigns', row); c = n; }
            say(msg, 'تم الحفظ ✓', 'ok'); await preview(c.id);
            if (!$('[data-go]', m)) { close(); D.reload(); setTimeout(() => edit(c), 400); }
          } catch (err) { say(msg, arErr(err), 'err'); }
        };
        const t = $('[data-test]', m); if (t) t.onclick = async () => { t.disabled = true; try { await sb.rpc('campaign_send_test', { p_id: c.id, p_email: sb.user.email }); say(msg, `أُرسلت رسالة تجريبية إلى ${sb.user.email} وستصل خلال 5 دقائق.`, 'ok'); } catch (e) { say(msg, arErr(e), 'err'); } t.disabled = false; };
        const go = $('[data-go]', m); if (go) go.onclick = async () => {
          if (go.dataset.sure !== '1') { go.dataset.sure = '1'; go.textContent = 'اضغط مرة أخرى للتأكيد'; say(msg, 'بعد البدء لا يمكن تعديل نص الحملة. أرسل تجربة إلى بريدك أولًا إذا لم تفعل.'); return; }
          go.disabled = true;
          try { const r = await sb.rpc('campaign_start', { p_id: c.id }); ui.toast(`بدأ الإرسال إلى ${r.total} شخص`); close(); D.reload(); }
          catch (e) { go.disabled = false; say(msg, /empty audience/.test(e.message || '') ? 'لا يوجد أحد في هذا الجمهور.' : arErr(e), 'err'); }
        };
        const pz = $('[data-pause]', m); if (pz) pz.onclick = async () => { try { await sb.update('email_campaigns', { id: 'eq.' + c.id }, { status: 'paused' }); ui.toast('تم الإيقاف المؤقت'); close(); D.reload(); } catch (e) { say(msg, arErr(e), 'err'); } };
        const del = $('[data-del]', m); if (del) del.onclick = async () => { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'تأكيد الحذف'; return; } try { await sb.remove('email_campaigns', { id: 'eq.' + c.id }); close(); D.reload(); } catch (e) { say(msg, arErr(e), 'err'); } };
      });
    }
  };
})();
