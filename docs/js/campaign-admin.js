/* Admin → «حملة إعادة التفعيل»: users of the old platform get one email each, at most N a day
   (Resend free plan = 100 emails/day for everything). The daily batch is sent by a scheduled task. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const D = window.Dash;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '٪' : '—');
  const ST = { queued: ['في الانتظار', 'mute'], sent: ['أُرسلت', 'info'], activated: ['فعّل حسابه', 'ok'], unsubscribed: ['ألغى الاشتراك', 'warn'], skipped: ['بريد غير صالح', 'danger'], failed: ['فشل', 'danger'] };

  // CSV → rows. Header names are matched loosely (email / البريد, name / الاسم, phone / الهاتف, created_at / تاريخ).
  function parseCsv(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (!lines.length) return [];
    const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
    const head = split(lines[0]).map((h) => h.toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    let ie = find(/mail|بريد|ايميل|إيميل/), iname = find(/name|اسم/), ip = find(/phone|mobile|tel|هاتف|موبايل|جوال/), ic = find(/created|registered|date|تاريخ/), ia = find(/last|active|login|آخر/);
    let start = 1;
    if (ie < 0) { ie = split(lines[0]).findIndex((x) => x.includes('@')); start = 0; if (ie < 0) return []; }
    return lines.slice(start).map(split).map((c) => ({ email: c[ie] || '', name: iname >= 0 ? c[iname] : '', phone: ip >= 0 ? c[ip] : '', created_at: ic >= 0 ? c[ic] : '', last_active_at: ia >= 0 ? c[ia] : '' })).filter((r) => r.email.includes('@'));
  }

  window.campaignAdmin = async function (main) {
    const [st, cfgRow, recent] = await Promise.all([
      sb.rpc('reactivation_stats').catch(() => null),
      sb.one('site_content', { select: 'data', key: 'eq.reactivation' }).catch(() => null),
      sb.get('legacy_users', { select: 'email,full_name,status,variant,sent_at,activated_at,founding', order: 'sent_at.desc.nullslast,created_at.desc', limit: 60 }).catch(() => []),
    ]);
    const s = st || {}, cfg = (cfgRow && cfgRow.data) || {};
    const limit = Number(cfg.daily_limit || 80), days = s.queued ? Math.ceil(s.queued / Math.max(limit, 1)) : 0;
    main.innerHTML = `<div class="bx-stats">
        ${D.stat('مستخدمو المنصة القديمة', s.total || 0, s.invalid ? s.invalid + ' بريد غير صالح' : 'في قائمة الحملة')}
        ${D.stat('أُرسلت لهم الرسالة', s.sent || 0, 'اليوم: ' + (s.today || 0) + ' من ' + limit)}
        ${D.stat('فعّلوا حساباتهم', s.activated || 0, 'نسبة التفعيل ' + pct(s.activated || 0, s.sent || 0))}
        ${D.stat('عضو مؤسس', s.founding || 0, 'فعّلوا خلال ' + (cfg.founder_days || 14) + ' يومًا')}
        ${D.stat('في الانتظار', s.queued || 0, s.queued ? 'تنتهي خلال ~' + days + ' يومًا' : '—')}
        ${D.stat('ألغوا الاشتراك', s.unsubscribed || 0, pct(s.unsubscribed || 0, s.sent || 0))}
      </div>
      ${D.panel('حالة الحملة', `<p class="bx-hint" style="margin-top:0">تُرسل دفعة واحدة يوميًا تلقائيًا (مهمة مجدولة في Claude). الحد الأقصى للحملة <b>${limit}</b> رسالة يوميًا، ولا يتجاوز مجموع رسائل المنصة كلها <b>${cfg.total_daily_cap || 95}</b> رسالة خلال 24 ساعة حتى تبقى ضمن الباقة المجانية لـ Resend (100 رسالة يوميًا). لا تُنشأ حسابات مسبقًا ولا تُفعَّل أي اشتراكات؛ المستخدم ينشئ حسابه بنفسه بالبريد نفسه فيُربط تلقائيًا.</p>
        <div class="bx-formmsg ${cfg.enabled ? 'ok' : 'err'}" style="display:block">${cfg.enabled ? '● الحملة تعمل' : '○ الحملة متوقفة — لن تُرسل أي رسالة حتى تشغّلها'}</div>
        <div class="bx-grid2" style="margin-top:14px">
          <div class="bx-field"><label for="cp-lim">عدد الرسائل يوميًا</label><input id="cp-lim" class="bx-input" type="number" min="1" max="95" value="${limit}" dir="ltr"></div>
          <div class="bx-field"><label for="cp-days">مدة شارة «عضو مؤسس» (أيام)</label><input id="cp-days" class="bx-input" type="number" min="1" max="60" value="${cfg.founder_days || 14}" dir="ltr"></div>
          <div class="bx-field"><label for="cp-sa">عنوان الرسالة (أ)</label><input id="cp-sa" class="bx-input" value="${esc(cfg.subject_a || '')}"></div>
          <div class="bx-field"><label for="cp-sb">عنوان الرسالة (ب)</label><input id="cp-sb" class="bx-input" value="${esc(cfg.subject_b || '')}"></div>
        </div>
        <p class="bx-hint">اكتب <b dir="ltr">{name}</b> ليُستبدل بالاسم الأول للمستخدم. يحصل نصف المستخدمين على العنوان (أ) والنصف الآخر على (ب)، وتظهر نسبة التفعيل لكل عنوان أدناه.</p>
        <div class="bx-formmsg" id="cp-msg" aria-live="polite"></div>
        <div class="bx-btnrow"><button class="bs-btn bs-btn-primary" type="button" id="cp-save">حفظ</button>
          <button class="bs-btn ${cfg.enabled ? 'bs-btn-ghost' : 'bs-btn-secondary'}" type="button" id="cp-toggle">${cfg.enabled ? 'إيقاف الحملة' : 'تشغيل الحملة'}</button>
          <button class="bs-btn bs-btn-ghost" type="button" id="cp-test">إرسال رسالة تجريبية إلى بريدي</button>
          <button class="bs-btn bs-btn-ghost" type="button" id="cp-now">إرسال دفعة اليوم الآن</button></div>`)}
      ${D.panel('مقارنة العنوانين', `<div class="bx-stats" style="margin:0">${D.stat('العنوان (أ)', pct(s.a_act || 0, s.a_sent || 0), (s.a_act || 0) + ' تفعيل من ' + (s.a_sent || 0))}${D.stat('العنوان (ب)', pct(s.b_act || 0, s.b_sent || 0), (s.b_act || 0) + ' تفعيل من ' + (s.b_sent || 0))}</div>`)}
      ${D.panel('استيراد المستخدمين', `<p class="bx-hint" style="margin-top:0">ارفع ملف CSV يحتوي على عمود للبريد الإلكتروني على الأقل (ويُفضّل الاسم والهاتف وتاريخ التسجيل وآخر دخول). البريد المكرر يُتجاهل، ومن لديه حساب على المنصة الجديدة بالفعل يُستبعد من الإرسال تلقائيًا. يُرسل أولًا لمن دخل مؤخرًا.</p>
        <input type="file" id="cp-file" accept=".csv,text/csv,text/plain" class="bx-input"><div class="bx-formmsg" id="cp-imsg" aria-live="polite"></div>`)}
      ${D.panel('آخر النشاط', D.table(['المستخدم', 'الحالة', 'العنوان', 'أُرسلت', 'فعّل'], recent.map((r) => [
        `<b dir="auto">${esc(r.full_name || '—')}</b><br><small class="bx-muted" dir="ltr">${esc(r.email)}</small>`,
        `<span class="bx-st bx-st-${(ST[r.status] || ['', 'mute'])[1]}">${(ST[r.status] || [r.status])[0]}</span>${r.founding ? ' <span class="bx-founder">★ عضو مؤسس</span>' : ''}`,
        r.variant ? (r.variant === 'B' ? 'ب' : 'أ') : '—', r.sent_at ? D.dateTime(r.sent_at) : '—', r.activated_at ? D.dateTime(r.activated_at) : '—']), 'لا يوجد مستخدمون بعد. استورد ملف المستخدمين أولًا.'))}`;

    const msg = (t, k) => { const m = $('#cp-msg', main); m.className = 'bx-formmsg ' + (k || ''); m.textContent = t; };
    const save = async (extra) => {
      const lim = Math.min(95, Math.max(1, parseInt($('#cp-lim', main).value, 10) || 80)), fd = Math.min(60, Math.max(1, parseInt($('#cp-days', main).value, 10) || 14));
      const data = { ...cfg, daily_limit: lim, founder_days: fd, subject_a: $('#cp-sa', main).value.trim(), subject_b: $('#cp-sb', main).value.trim(), ...(extra || {}) };
      if (!data.subject_a || !data.subject_b) { msg('اكتب عنواني الرسالة.', 'err'); return false; }
      await sb.update('site_content', { key: 'eq.reactivation' }, { data, updated_at: new Date().toISOString() });
      return true;
    };
    $('#cp-save', main).onclick = async () => { try { if (await save()) { ui.toast('تم الحفظ'); D.reload(); } } catch (e) { msg(arErr(e), 'err'); } };
    $('#cp-toggle', main).onclick = async () => {
      if (!cfg.enabled && !(s.queued > 0)) { msg('استورد المستخدمين أولًا.', 'err'); return; }
      try { if (await save({ enabled: !cfg.enabled })) { ui.toast(cfg.enabled ? 'تم إيقاف الحملة' : 'تم تشغيل الحملة'); D.reload(); } } catch (e) { msg(arErr(e), 'err'); }
    };
    $('#cp-test', main).onclick = async (ev) => {
      ev.target.disabled = true;
      try { await sb.rpc('reactivation_send_test', { p_email: sb.user.email, p_variant: 'A' }); msg('أُرسلت رسالة تجريبية إلى ' + sb.user.email + ' وستصل خلال 5 دقائق.', 'ok'); }
      catch (e) { msg(arErr(e), 'err'); } finally { ev.target.disabled = false; }
    };
    $('#cp-now', main).onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await sb.rpc('reactivation_send_batch', {});
        msg(r && r.skipped ? 'الحملة متوقفة. شغّلها أولًا.' : `أُرسلت ${r.sent} رسالة اليوم (المجموع اليوم ${r.today}). المتبقي ${r.queued}.`, r && r.skipped ? 'err' : 'ok');
      } catch (e) { msg(arErr(e), 'err'); } finally { ev.target.disabled = false; }
    };
    $('#cp-file', main).onchange = async (ev) => {
      const f = ev.target.files[0], m = $('#cp-imsg', main); if (!f) return;
      const rows = parseCsv(await f.text());
      if (!rows.length) { m.className = 'bx-formmsg err'; m.textContent = 'لم نجد عمودًا للبريد الإلكتروني في الملف.'; return; }
      m.className = 'bx-formmsg'; m.textContent = 'جارٍ الاستيراد…';
      let added = 0, linked = 0;
      try {
        for (let i = 0; i < rows.length; i += 500) { const r = await sb.rpc('reactivation_import', { p_rows: rows.slice(i, i + 500) }); added += r.added; linked += r.already_on_platform; }
        ui.toast(`تمت إضافة ${added} مستخدم`); m.className = 'bx-formmsg ok'; m.textContent = `تمت إضافة ${added} من ${rows.length}، ولدى ${linked} منهم حساب على المنصة الجديدة بالفعل.`;
        setTimeout(() => D.reload(), 1500);
      } catch (e) { m.className = 'bx-formmsg err'; m.textContent = arErr(e); }
    };
  };
})();
