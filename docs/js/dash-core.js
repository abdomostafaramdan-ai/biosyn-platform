/* Dashboard shell + shared helpers (account / instructor / admin). */
(() => {
  'use strict';
  const D = window.Dash = {};
  const ICONS = {
    home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5',
    card: 'M2 5h20v14H2zM2 10h20',
    cert: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9 7 22l5-3 5 3-1.2-8.1',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6',
    chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    chat: 'M21 12a8 8 0 0 1-11.8 7L4 20l1-4.2A8 8 0 1 1 21 12z',
    ticket: 'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12',
    tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
    coin: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v12M9 9.5c0-1 1-1.5 3-1.5s3 .7 3 1.8-1 1.5-3 2-3 1-3 2.2S10.3 16 12 16s3-.5 3-1.5',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  };
  D.ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ICONS.list}"/></svg>`;

  const loc = window.LOC || 'ar-EG-u-nu-latn';
  D.date = (d) => (d ? new Date(d).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  D.dateTime = (d) => (d ? new Date(d).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  D.month = (d) => new Date(d).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
  D.addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

  const ST = {
    pay: { pending: ['بانتظار الدفع', 'warn'], paid: ['مدفوع', 'ok'], failed: ['فشل', 'danger'], refunded: ['مسترد', 'mute'] },
    req: { new: ['جديد', 'warn'], in_review: ['قيد المراجعة', 'info'], accepted: ['مقبول', 'ok'], rejected: ['مرفوض', 'mute'] },
    payout: { requested: ['مطلوب', 'warn'], approved: ['معتمد', 'info'], paid: ['تم التحويل', 'ok'], rejected: ['مرفوض', 'mute'] },
    course: { draft: ['مسودة', 'mute'], review: ['قيد المراجعة', 'warn'], published: ['منشور', 'ok'], archived: ['مؤرشف', 'mute'] },
  };
  D.badge = (kind, v) => { const [t, c] = (ST[kind] && ST[kind][v]) || [v, 'mute']; return `<span class="bx-st bx-st-${c}">${esc(t)}</span>`; };
  D.reqType = { instructor_recorded: 'محاضر · كورس مسجل', instructor_interactive: 'محاضر · كورس تفاعلي', institution: 'مؤسسة', consultation: 'استشارة', refund: 'طلب استرداد' };
  D.roleAr = { student: 'طالب', instructor: 'محاضر', support: 'دعم', admin: 'مدير' };
  D.gw = { stripe: 'Stripe', paymob: 'Paymob', fawaterk: 'Fawaterk', manual: 'تحويل يدوي' };
  D.money = (n) => EGP(n) + ' ج.م';

  // shell({ title, who, sub, items:[{id,label,icon,badge?}], views:{id:async(main)=>…}, topLink })
  D.shell = async function (cfg) {
    const app = $('#app');
    app.innerHTML = `<div class="bs-root bx-app" dir="rtl"><aside class="bx-sidebar" aria-label="القائمة الجانبية">
      <a class="bs-logo" href="index.html" aria-label="Biosyn Egypt"><img class="bs-logo-dark" src="img/biosyn-logo.png" alt="Biosyn" style="height:36px"><img class="bs-logo-light" src="img/biosyn-logo-light.png" alt="Biosyn" style="height:36px"></a>
      <nav class="bx-navgroup" aria-label="${esc(cfg.title)}">${cfg.items.map((i) => `<a class="bx-nav-item" href="#${i.id}" data-v="${i.id}">${D.ic(i.icon)}${esc(i.label)}<span class="bx-nav-n" data-n="${i.id}" hidden></span></a>`).join('')}</nav>
      <div class="bx-sidefoot"><div class="bx-avatar"><span>${esc((cfg.who || '؟').trim().charAt(0))}</span></div><div><b>${esc(cfg.who || '')}</b><small>${esc(cfg.sub || '')}</small></div></div></aside>
      <div class="bx-content"><div class="bx-topbar"><div class="bx-pagetitle"><b id="vt"></b></div><div class="bx-topbar-tools"><span class="bx-toggles" data-toggles></span><a href="index.html" class="bs-btn bs-btn-ghost bs-btn-sm">الموقع</a>${cfg.topLink || ''}<button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" id="signout">تسجيل الخروج</button></div></div>
      <main class="bx-main" id="main" tabindex="-1"></main></div></div>`;
    window.mountToggles && mountToggles();
    $('#signout').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
    const ids = cfg.items.map((i) => i.id);
    async function route() {
      const id = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0];
      $$('.bx-nav-item', app).forEach((a) => { if (a.dataset.v === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      $('#vt').textContent = cfg.items.find((i) => i.id === id).label;
      const main = $('#main'); main.innerHTML = '<div class="bx-loading">جارٍ التحميل…</div>';
      try { await cfg.views[id](main); } catch (e) { console.error(e); main.innerHTML = `<div class="bx-empty-big"><b>تعذّر تحميل هذه الصفحة</b>${esc(arErr(e))}</div>`; }
      main.focus({ preventScroll: true });
    }
    D.reload = route;
    D.setBadge = (id, n) => { const b = $(`[data-n="${id}"]`); if (b) { b.textContent = n; b.hidden = !n; } };
    window.addEventListener('hashchange', route);
    await route();
  };

  D.denied = (msg) => { $('#app').innerHTML = `<div class="bs-root"><div class="bx-empty-big" style="margin:80px auto;max-width:560px"><b>${msg}</b><a class="bx-link" href="index.html">العودة إلى الموقع</a></div></div>`; };
  D.guard = async (roles) => {
    if (!requireLogin()) return null;
    const me = await getMe();
    if (!me || !roles.includes(me.role)) { D.denied('هذه الصفحة غير متاحة لحسابك.'); return null; }
    return me;
  };
  D.table = (cols, rows, empty) => rows.length
    ? `<div class="bx-tablewrap"><table class="bx-table"><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="bx-empty-big"><b>${empty || 'لا توجد بيانات'}</b></div>`;
  D.panel = (title, body, extra) => `<section class="bx-panel"><div class="bx-panel-head"><h3>${title}</h3>${extra || ''}</div>${body}</section>`;
  D.stat = (label, value, hint) => `<div class="bx-stat"><span>${label}</span><b>${value}</b>${hint ? `<small class="bx-muted">${hint}</small>` : ''}</div>`;
})();
