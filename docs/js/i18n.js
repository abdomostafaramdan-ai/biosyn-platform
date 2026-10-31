/* English mode: Arabic stays the source of truth; when <html data-lang="en">, visible Arabic text is
   replaced from the dictionary in i18n-en.js (exact strings first, then patterns for dynamic text).
   New DOM content (rendered by JS) is translated as it appears. */
(function () {
  'use strict';
  const root = document.documentElement;
  const en = root.getAttribute('data-lang') === 'en';
  window.LANG = en ? 'en' : 'ar';
  window.LOC = en ? 'en-GB' : 'ar-EG-u-nu-latn';
  if (!en) { window.t = (s) => s; return; }

  root.setAttribute('data-i18n', 'pending');
  const AR = /[؀-ۿ]/;
  const DICT = window.I18N_EN || {};
  const PATS = window.I18N_EN_PATTERNS || [];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const missing = (window.__i18nMissing = new Set());

  function tr(s) {
    const k = norm(s);
    if (!k || !AR.test(k)) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
    for (const [re, rep] of PATS) {
      const m = k.match(re);
      if (m) {
        const out = typeof rep === 'function' ? rep(...m) : k.replace(re, rep);
        if (out != null) return AR.test(out) ? tr2(out) : out;
      }
    }
    // composite text: translate "a · b" segments or whole sentences one by one
    for (const sep of [/\s·\s/, /(?<=[.!؟?:])\s+/]) {
      const parts = k.split(sep);
      if (parts.length > 1) {
        const seps = k.match(new RegExp(sep.source, 'g')) || [];
        const out = parts.map((p) => (AR.test(p) ? (inner(p)) : p));
        if (out.every((p) => p != null)) return out.reduce((acc, p, i) => acc + (i ? (seps[i - 1].includes('·') ? ' · ' : ' ') : '') + p, '');
      }
    }
    missing.add(k);
    return null;
  }
  function inner(p) {
    const k = norm(p);
    if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
    for (const [re, rep] of PATS) { const m = k.match(re); if (m) { const o = typeof rep === 'function' ? rep(...m) : k.replace(re, rep); if (o != null && !AR.test(o)) return o; } }
    return null;
  }
  // second pass for pattern outputs that still contain Arabic fragments (e.g. a plan name)
  function tr2(s) { return s.replace(/[؀-ۿ][؀-ۿ\s.،ـًٌٍَُِّْ]*[؀-ۿ]|[؀-ۿ]/g, (w) => (DICT[norm(w)] != null ? DICT[norm(w)] : w)); }
  window.t = (s) => { const r = tr(s); return r == null ? s : r; };

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function textNode(n) {
    const v = n.nodeValue; if (!v || !AR.test(v)) return;
    const p = n.parentNode; if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.closest && p.closest('[data-no-i18n]'))) return;
    const r = tr(v);
    if (r != null && r !== norm(v)) { const nv = (v.match(/^\s*/)[0]) + r + (v.match(/\s*$/)[0]); if (nv !== v) n.nodeValue = nv; }
  }
  function element(el) {
    if (el.nodeType !== 1) return;
    if (el.getAttribute('dir') === 'rtl' && !el.closest('[data-no-i18n]')) el.setAttribute('dir', 'ltr');
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && AR.test(v)) { const r = tr(v); if (r != null && r !== v) el.setAttribute(a, r); } }
    if ((el.nodeName === 'INPUT' && /^(button|submit)$/.test(el.type)) && AR.test(el.value)) { const r = tr(el.value); if (r != null) el.value = r; }
  }
  function walk(node) {
    if (node.nodeType === 3) return textNode(node);
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) { if (node.closest && node.closest('[data-no-i18n]')) return; element(node); }
    const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else element(n); }
  }
  function head() {
    if (AR.test(document.title)) { const r = tr(document.title); if (r) document.title = r; }
    document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach((m) => { const r = tr(m.content || ''); if (r) m.content = r; });
  }

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') element(m.target);
      else m.addedNodes.forEach(walk);
    }
    if (AR.test(document.title)) head();
  });
  function start() {
    walk(document.body); head();
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['dir']) });
    root.removeAttribute('data-i18n');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setTimeout(() => root.removeAttribute('data-i18n'), 2500); // never keep the page hidden
})();
