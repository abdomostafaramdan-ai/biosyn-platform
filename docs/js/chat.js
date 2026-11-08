/* Messages: student <-> instructor course Q&A, and complaint/support tickets with the team.
   Tables: threads + thread_messages (read via RLS); writes go through RPCs (post_message, ask_instructor, open_ticket…). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const err = (e) => {
    const m = (e && e.message) || '';
    return /slow down/.test(m) ? 'رسائل كثيرة متتالية، انتظر دقيقة.' : /thread closed/.test(m) ? 'أُغلقت هذه المحادثة. افتح تذكرة جديدة إذا احتجت إلى شيء.'
      : /subscription required/.test(m) ? 'يجب أن تكون مشتركًا في الدورة لتسأل المحاضر.' : /too many tickets/.test(m) ? 'فتحت تذاكر كثيرة اليوم، انتظر رد الفريق.'
      : window.arErr ? window.arErr(e) : m;
  };
  const CAT = { payment: 'الدفع والاشتراك', technical: 'مشكلة تقنية', content: 'محتوى الدورة', instructor: 'شكوى من محاضر', account: 'الحساب', request: 'طلب مقدّم', other: 'أخرى' };
  const ST = { open: ['مفتوحة', 'warn'], pending: ['بانتظار ردّك', 'info'], resolved: ['تم الحل', 'ok'], closed: ['مغلقة', 'mute'] };
  const ROLE = { student: 'الطالب', instructor: 'المحاضر', staff: 'فريق Biosyn' };
  const when = (d) => new Date(d).toLocaleString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const badge = (s) => `<span class="bx-st bx-st-${(ST[s] || ['', 'mute'])[1]}">${(ST[s] || [s])[0]}</span>`;
  const unread = (t, me) => (me === 'student' ? t.last_sender !== 'student' && t.last_message_at > t.student_read_at : t.last_sender === 'student' && t.last_message_at > t.other_read_at);

  // one conversation in a modal; polls every 8s while open
  function openThread(id, opt) {
    opt = opt || {};
    let msgs = [], t = null, timer = null;
    ui.modal(`<div class="bx-conv"><div class="bx-conv-head"><div><h3 data-title>…</h3><small class="bx-hint" data-sub></small></div><span data-st></span></div>
      <div class="bx-conv-log" aria-live="polite"><div class="bx-loading">جارٍ التحميل…</div></div>
      <form class="bx-conv-form"><textarea class="bx-textarea" rows="2" maxlength="4000" placeholder="اكتب رسالتك…" aria-label="رسالتك" required></textarea><button type="submit" class="bs-btn bs-btn-primary">إرسال</button></form>
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-modal-actions" data-acts></div></div>`, (m, close) => {
      const log = $('.bx-conv-log', m), f = $('form', m), ta = $('textarea', m), say = (x, k) => { const e = $('.bx-formmsg', m); e.className = 'bx-formmsg' + (k ? ' ' + k : ''); e.textContent = x; };
      const myRole = () => (t && sb.user && t.student_id === sb.user.id ? 'student' : t && t.instructor_id === (sb.user && sb.user.id) ? 'instructor' : 'staff');
      const paint = () => {
        const mine = myRole();
        $('[data-title]', m).textContent = t ? (t.kind === 'ticket' ? t.subject : 'سؤال في: ' + t.subject) : '';
        $('[data-sub]', m).textContent = t ? (t.kind === 'ticket' ? `تذكرة · ${CAT[t.category] || ''}` : mine === 'student' ? 'يرد عليك المحاضر هنا' : `الطالب: ${t.student_name || '—'}`) : '';
        $('[data-st]', m).innerHTML = t ? badge(t.status) : '';
        log.innerHTML = msgs.length ? msgs.map((x) => `<div class="bx-msg ${x.sender_id === sb.user.id ? 'me' : ''}"><small>${x.sender_id === sb.user.id ? 'أنت' : ROLE[x.role] || ''} · ${when(x.created_at)}</small><p>${esc(x.body)}</p></div>`).join('')
          : '<p class="bx-hint" style="text-align:center;margin:24px 0">لا توجد رسائل بعد. اكتب سؤالك بالأسفل.</p>';
        log.scrollTop = log.scrollHeight;
        const acts = $('[data-acts]', m);
        acts.innerHTML = (t && t.kind === 'ticket' && t.status !== 'closed' ? (mine === 'staff' ? '<button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" data-s="resolved">تم الحل</button><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-s="closed">قفل التذكرة</button>' : '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-s="closed">المشكلة اتحلت، اقفل التذكرة</button>') : '')
          + '<button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-x>إغلاق</button>';
        $$('[data-s]', acts).forEach((b) => (b.onclick = async () => { try { await sb.rpc('set_thread_status', { p_thread: id, p_status: b.dataset.s }); t.status = b.dataset.s; paint(); opt.onChange && opt.onChange(); } catch (e) { say(err(e), 'err'); } }));
        $('[data-x]', acts).onclick = () => { clearInterval(timer); close(); };
        f.hidden = !!(t && t.status === 'closed' && mine === 'student');
      };
      const load = async () => {
        const [th, ms] = await Promise.all([sb.one('threads', { select: '*', id: 'eq.' + id }), sb.get('thread_messages', { select: '*', thread_id: 'eq.' + id, order: 'created_at.asc', limit: 500 })]);
        const changed = !t || ms.length !== msgs.length || (th && th.status !== t.status);
        t = th; msgs = ms; if (changed) paint();
        sb.rpc('mark_thread_read', { p_thread: id }).catch(() => {});
      };
      load().catch((e) => (log.innerHTML = `<div class="bx-formmsg err">${esc(err(e))}</div>`));
      timer = setInterval(() => { if (!m.isConnected) return clearInterval(timer); if (!document.hidden) load().catch(() => {}); }, 8000);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
      f.onsubmit = async (e) => {
        e.preventDefault(); const body = ta.value.trim(); if (!body) return;
        const b = $('button', f); b.disabled = true; say('');
        try { await sb.rpc('post_message', { p_thread: id, p_body: body }); ta.value = ''; await load(); opt.onChange && opt.onChange(); } catch (x) { say(err(x), 'err'); }
        b.disabled = false; ta.focus();
      };
      setTimeout(() => ta.focus(), 50);
    });
  }

  // student: "ask the instructor" from a course / watch page
  async function askCourse(courseId) {
    if (!sb.user) { location.href = 'login.html?next=' + encodeURIComponent((window.pageFile ? window.pageFile() : location.pathname.split('/').pop()) + location.search); return; }
    try { const id = await sb.rpc('ask_instructor', { p_course: courseId, p_body: null }); openThread(id); } catch (e) { ui.toast(err(e), 'err'); }
  }

  function newTicket(onDone) {
    ui.modal(`<h3>تذكرة دعم أو شكوى</h3><p class="bx-hint" style="margin-top:0">اكتب المشكلة بالتفصيل وسيرد عليك فريق Biosyn هنا وعلى بريدك الإلكتروني.</p>
      <form class="bx-form" style="gap:14px" novalidate>
        <div class="bx-field"><label for="tk-c">النوع</label><select id="tk-c" class="bx-select">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="bx-field"><label for="tk-s">العنوان *</label><input id="tk-s" class="bx-input" maxlength="160" placeholder="مثال: خُصم المبلغ ولم يُفعَّل الاشتراك"></div>
        <div class="bx-field"><label for="tk-b">التفاصيل *</label><textarea id="tk-b" class="bx-textarea" rows="5" maxlength="4000" placeholder="ماذا حدث؟ ومتى؟ وإذا كان لديك رقم عملية أو إيصال فاكتبه."></textarea></div>
        <div class="bx-formmsg" aria-live="polite"></div>
        <div class="bx-modal-actions"><button type="submit" class="bs-btn bs-btn-primary">إرسال التذكرة</button><button type="button" class="bs-btn bs-btn-ghost" data-x>إلغاء</button></div></form>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('form', m).onsubmit = async (e) => {
        e.preventDefault(); const s = $('#tk-s', m).value.trim(), b = $('#tk-b', m).value.trim(), msg = $('.bx-formmsg', m);
        if (!s || b.length < 10) { msg.className = 'bx-formmsg err'; msg.textContent = 'اكتب عنوان وتفاصيل المشكلة (10 حروف على الأقل).'; return; }
        const btn = $('button[type=submit]', m); btn.disabled = true;
        try { const id = await sb.rpc('open_ticket', { p_subject: s, p_category: $('#tk-c', m).value, p_body: b }); close(); ui.toast('وصلت تذكرتك، وسنرد عليك في أقرب وقت.'); onDone && onDone(id); }
        catch (x) { btn.disabled = false; msg.className = 'bx-formmsg err'; msg.textContent = err(x); }
      };
    });
  }

  // inbox list. mode: 'student' | 'instructor' | 'staff'; kind: 'course' | 'ticket' | undefined (both)
  async function inbox(box, opt) {
    const mode = opt.mode, F = { status: opt.status || '', q: '' };
    const q = { select: '*', order: 'last_message_at.desc', limit: 300 };
    if (opt.kind) q.kind = 'eq.' + opt.kind;
    if (mode === 'student') q.student_id = 'eq.' + sb.user.id;
    if (mode === 'instructor') q.instructor_id = 'eq.' + sb.user.id;
    let rows = [];
    const load = async () => { rows = await sb.get('threads', q); };
    const draw = () => {
      const list = rows.filter((t) => (!F.status || t.status === F.status) && (!F.q || `${t.subject} ${t.student_name || ''}`.toLowerCase().includes(F.q.toLowerCase())));
      const me = mode === 'student' ? 'student' : 'other';
      $('[data-list]', box).innerHTML = list.length ? list.map((t) => `<button type="button" class="bx-thread ${unread(t, me) ? 'unread' : ''}" data-t="${t.id}">
          <span class="bx-thread-ic" aria-hidden="true">${t.kind === 'ticket' ? '🎫' : '💬'}</span>
          <span class="bx-thread-main"><b>${esc(t.kind === 'ticket' ? t.subject : t.subject)}</b><small class="bx-hint">${t.kind === 'ticket' ? 'تذكرة · ' + (CAT[t.category] || '') : 'سؤال في دورة'}${mode !== 'student' && t.student_name ? ' · ' + esc(t.student_name) : ''}${mode === 'staff' && t.kind === 'course' && !t.instructor_id ? ' · <span class="bx-st bx-st-warn">لا يوجد محاضر مرتبط</span>' : ''}</small></span>
          <span class="bx-thread-side">${badge(t.status)}<small class="bx-hint">${when(t.last_message_at)}</small>${unread(t, me) ? '<i class="bx-dot" aria-label="غير مقروءة"></i>' : ''}</span></button>`).join('')
        : `<div class="bx-empty-big"><b>${opt.empty || 'لا توجد رسائل'}</b></div>`;
      $$('[data-t]', box).forEach((b) => (b.onclick = () => openThread(b.dataset.t, { onChange: () => load().then(draw) })));
    };
    box.innerHTML = `<div class="bx-btnrow" style="margin-bottom:12px;align-items:end">
        ${opt.newTicket ? '<button type="button" class="bs-btn bs-btn-primary bs-btn-sm" data-new>+ تذكرة جديدة</button>' : ''}
        <div class="bx-field" style="margin:0"><label class="bx-hint" for="ib-q">بحث</label><input id="ib-q" class="bx-input" type="search" placeholder="الموضوع أو اسم الطالب"></div>
        <div class="bx-field" style="margin:0"><label class="bx-hint" for="ib-s">الحالة</label><select id="ib-s" class="bx-select"><option value="">الكل</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === F.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      </div><div data-list style="display:grid;gap:8px"><div class="bx-loading">جارٍ التحميل…</div></div>`;
    $('#ib-q', box).oninput = (e) => { F.q = e.target.value; draw(); };
    $('#ib-s', box).onchange = (e) => { F.status = e.target.value; draw(); };
    const nb = $('[data-new]', box); if (nb) nb.onclick = () => newTicket((id) => load().then(draw).then(() => openThread(id, { onChange: () => load().then(draw) })));
    await load(); draw();
    const t = setInterval(async () => { if (!box.isConnected) return clearInterval(t); if (!document.hidden) { try { await load(); draw(); } catch {} } }, 20000);
  }

  async function unreadCounts() { try { return await sb.rpc('my_unread'); } catch { return {}; } }

  window.Chat = { openThread, askCourse, newTicket, inbox, unreadCounts, CAT };
})();
