/* Admin-editable wording for every page (Admin → «نصوص الموقع»). Exact sentences are replaced in the
   browser; the original stays in the code. Overrides are cached per browser for instant paint.
   Admin edit mode: open any page with ?edit-text=1 and click a sentence to change it. */
(function () {
  'use strict';
  const KEY = 'biosyn.txo.v1', TTL = 5 * 60 * 1000;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = 'SCRIPT,STYLE,NOSCRIPT,TEXTAREA,CODE,PRE';
  const isEn = () => document.documentElement.getAttribute('data-lang') === 'en';
  let rows = [], map = new Map(), lastSet = new WeakMap(), origOf = new WeakMap(), editing = false;

  function build() {
    map = new Map();
    const dict = window.I18N_EN || {};
    rows.forEach((r) => {
      if (isEn()) { if (r.replacement_en) map.set(norm(dict[r.original] || r.original), r.replacement_en); }
      else map.set(norm(r.original), r.replacement);
    });
  }
  function fixText(n) {
    const v = n.nodeValue; if (!v || lastSet.get(n) === v) return;
    const k = norm(v); if (!k || !map.has(k)) return;
    const out = v.replace(v.trim(), map.get(k)); origOf.set(n, origOf.get(n) || k); lastSet.set(n, out); n.nodeValue = out;
  }
  function fixEl(el) {
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && map.has(norm(v))) el.setAttribute(a, map.get(norm(v))); }
  }
  function apply(root) {
    if (!map.size || !root) return;
    if (root.nodeType === 3) { if (!root.parentElement || !root.parentElement.closest(SKIP + ',[data-no-txo]')) fixText(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP + ',[data-no-txo]')) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && (SKIP.includes(n.nodeName) || n.hasAttribute('data-no-txo')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    fixEl(root);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? fixText(n) : fixEl(n);
    if (root === document.body) { const t = norm(document.title); if (map.has(t)) document.title = map.get(t); }
  }
  let queued = new Set(), raf = 0;
  const mo = new MutationObserver((list) => {
    if (!map.size) return;
    list.forEach((m) => { if (m.type === 'characterData') queued.add(m.target); else m.addedNodes.forEach((n) => queued.add(n)); if (m.type === 'attributes') queued.add(m.target); });
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = new Set(); q.forEach((n) => n.isConnected && apply(n)); });
  });
  function start(list) {
    rows = Array.isArray(list) ? list : []; build(); apply(document.body);
  }
  function load() {
    try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Array.isArray(c.rows)) start(c.rows); if (c && Date.now() - c.at < TTL) return; } catch (e) {}
    if (!window.sb) return;
    sb.get('text_overrides', { select: 'original,replacement,replacement_en', scope: 'eq.site' }).then((r) => {
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows: r })); } catch (e) {}
      start(r);
    }).catch(() => {});
  }
  window.BiosynTexts = { refresh: () => { try { localStorage.removeItem(KEY); } catch (e) {} load(); }, rows: () => rows };

  // language switch (data-lang changes) → rebuild the map for the other language
  new MutationObserver(() => { build(); apply(document.body); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang'] });

  // ---------- admin: edit texts directly on the page ----------
  async function editMode() {
    if (!/[?&]edit-text=1\b/.test(location.search) || !window.sb || !sb.session) return;
    try { await (sb.auth && sb.auth.ready); } catch (e) {}
    let me = null; try { me = await sb.one('profiles', { select: 'role', id: 'eq.' + sb.user.id }); } catch (e) {}
    if (!me || me.role !== 'admin') return;
    editing = true;
    const css = document.createElement('style');
    css.textContent = `.txo-bar{position:fixed;z-index:2147483000;inset-inline:12px;bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-radius:14px;background:#c6f84a;color:#010232;font:700 14px/1.5 Tahoma,Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35)}
      .txo-bar a{color:#010232}.txo-hover{outline:2px dashed #c6f84a!important;outline-offset:2px;cursor:text!important}
      .txo-dlg{position:fixed;z-index:2147483001;inset:0;background:rgba(1,2,30,.7);display:grid;place-items:center;padding:16px}
      .txo-card{width:min(560px,100%);background:#fff;color:#1a1d3a;border-radius:16px;padding:20px;display:grid;gap:10px;font:15px/1.7 Tahoma,Arial,sans-serif;direction:rtl}
      .txo-card textarea{width:100%;min-height:96px;border:1px solid #d7dbee;border-radius:10px;padding:10px;font:inherit;box-sizing:border-box}
      .txo-card small{color:#5d6088}.txo-card .row{display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap}
      .txo-card button{font:700 14px/1 inherit;padding:11px 16px;border-radius:10px;border:0;cursor:pointer;background:#eef0f8;color:#010232}.txo-card button.p{background:#010232;color:#fff}`;
    document.head.appendChild(css);
    const bar = document.createElement('div'); bar.className = 'txo-bar'; bar.setAttribute('data-no-txo', '');
    bar.innerHTML = '✏️ وضع تعديل النصوص: اضغط على أي جملة لتعديلها. الروابط والأزرار لا تعمل في هذا الوضع. <a href="' + location.pathname + '">خروج</a> · <a href="admin.html#texts">كل التعديلات</a>';
    document.body.appendChild(bar);
    let hov = null;
    const target = (e) => { const el = e.target.closest('h1,h2,h3,h4,h5,p,li,a,button,span,b,strong,small,label,td,th,dt,dd,legend,summary,figcaption,blockquote,div'); if (!el || el.closest('[data-no-txo],.txo-dlg')) return null; const tn = [...el.childNodes].find((n) => n.nodeType === 3 && norm(n.nodeValue)); return tn ? { el, tn } : null; };
    document.addEventListener('mouseover', (e) => { const t = editing && target(e); if (hov) hov.classList.remove('txo-hover'); hov = t ? t.el : null; if (hov) hov.classList.add('txo-hover'); }, true);
    document.addEventListener('click', (e) => {
      if (!editing || e.target.closest('[data-no-txo],.txo-dlg')) return;
      const t = target(e); if (!t) return;
      e.preventDefault(); e.stopPropagation();
      const cur = norm(t.tn.nodeValue), orig = origOf.get(t.tn) || cur;
      const row = rows.find((r) => norm(r.original) === orig);
      const dlg = document.createElement('div'); dlg.className = 'txo-dlg'; dlg.setAttribute('data-no-txo', '');
      dlg.innerHTML = `<div class="txo-card" role="dialog" aria-modal="true"><b>تعديل النص</b><small>النص الأصلي: <span dir="auto"></span></small>
        <label>النص الجديد بالعربية<textarea data-ar dir="auto"></textarea></label><label>النص في النسخة الإنجليزية (اختياري)<textarea data-en dir="ltr" style="min-height:60px"></textarea></label>
        <small>يتغير هذا النص في كل صفحات الموقع التي يظهر فيها بالضبط. اترك الخانة العربية فارغة لإرجاع النص الأصلي.</small><small data-msg></small>
        <div class="row"><button class="p" data-s>حفظ</button><button data-c>إلغاء</button></div></div>`;
      dlg.querySelector('small span').textContent = orig;
      dlg.querySelector('[data-ar]').value = row ? row.replacement : cur;
      dlg.querySelector('[data-en]').value = (row && row.replacement_en) || '';
      document.body.appendChild(dlg); dlg.querySelector('[data-ar]').focus();
      dlg.querySelector('[data-c]').onclick = () => dlg.remove();
      dlg.onclick = (ev) => { if (ev.target === dlg) dlg.remove(); };
      dlg.querySelector('[data-s]').onclick = async () => {
        const ar = norm(dlg.querySelector('[data-ar]').value), en = norm(dlg.querySelector('[data-en]').value), m = dlg.querySelector('[data-msg]');
        m.textContent = 'جارٍ الحفظ…';
        try {
          const ex = await sb.get('text_overrides', { select: 'id', scope: 'eq.site', original: 'eq.' + orig });
          if (!ar || (ar === orig && !en)) { if (ex[0]) await sb.remove('text_overrides', { id: 'eq.' + ex[0].id }); t.tn.nodeValue = t.tn.nodeValue.replace(t.tn.nodeValue.trim(), orig); }
          else {
            const body = { scope: 'site', original: orig, replacement: ar, replacement_en: en || null, page: location.pathname.split('/').pop() || 'index.html', updated_at: new Date().toISOString() };
            if (ex[0]) await sb.update('text_overrides', { id: 'eq.' + ex[0].id }, body); else await sb.insert('text_overrides', body);
            const v = t.tn.nodeValue.replace(t.tn.nodeValue.trim(), isEn() ? (en || t.tn.nodeValue.trim()) : ar); origOf.set(t.tn, orig); lastSet.set(t.tn, v); t.tn.nodeValue = v;
          }
          window.BiosynTexts.refresh(); dlg.remove();
        } catch (err) { m.textContent = (window.arErr ? arErr(err) : err.message) || 'تعذّر الحفظ'; }
      };
    }, true);
  }

  const boot = () => { load(); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); editMode(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
