/* Instructor agreement: one renderer for the signing step, the printable page (contract.html) and the PDF copy. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // keep Latin runs (dates, emails, IDs, hashes) left-to-right inside Arabic lines
  const iso = (t) => String(t).replace(/(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?|[\w.+-]+@[\w-]+\.[\w.]+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{12,}|\d+\.\d+\.\d+\.\d+)/gi, '\u2066$1\u2069');
  const fmt = (d) => new Date(d).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // body text → paragraphs; "1) …" lines become clause headings
  function bodyHTML(text) {
    return String(text || '').trim().split(/\n/).map((l) => l.trim()).filter(Boolean).map((l, i) =>
      i === 0 ? `<h1>${esc(iso(l))}</h1>` : /^\d+\)\s/.test(l) ? `<h3>${esc(iso(l))}</h3>` : /^(الطرف|الكورس|تاريخ)/.test(l) ? `<p class="kc-party">${esc(iso(l))}</p>` : `<p>${esc(iso(l))}</p>`).join('');
  }

  // c: { id?, title, body, version, signer_name?, signature_png?, signed_at?, ip?, body_sha256|sha256, course_title? }
  window.contractDoc = (c) => `<article class="kc-doc" dir="rtl" lang="ar">
    <header class="kc-head"><img src="img/biosyn-logo-light.png" alt="Biosyn Egypt" onerror="this.src='img/biosyn-logo.png'"><div><b>${esc(c.title)}</b><small>الإصدار ${esc(c.version)}${c.id ? ' · رقم الاتفاقية ' + esc(String(c.id).slice(0, 8).toUpperCase()) : ''}</small></div></header>
    <div class="kc-body">${bodyHTML(c.body)}</div>
    <section class="kc-sign">
      <div><span>الطرف الأول</span><b>Biosyn Egypt</b><small>biosyneg.com · contact@biosynegypt.com</small><div class="kc-stamp">Biosyn Egypt<br><small>معتمد إلكترونيًا</small></div></div>
      <div><span>الطرف الثاني (المحاضر)</span><b>${esc(c.signer_name || '—')}</b>${c.signature_png ? `<img class="kc-sig" src="${esc(c.signature_png)}" alt="توقيع المحاضر">` : '<div class="kc-sig kc-sig-empty">التوقيع</div>'}<small>${c.signed_at ? 'وقّع في ' + esc(fmt(c.signed_at)) : ''}</small></div>
    </section>
    ${c.signed_at ? `<footer class="kc-audit"><b>سجل التوقيع الإلكتروني</b>
      <span>رقم الاتفاقية: <bdi>${esc(c.id)}</bdi></span><span>التاريخ والوقت: <bdi>${esc(new Date(c.signed_at).toISOString())}</bdi> (UTC)</span>
      ${c.ip ? `<span>عنوان IP: <bdi>${esc(c.ip)}</bdi></span>` : ''}<span>البصمة الرقمية للنص (SHA-256): <bdi class="kc-hash">${esc(c.body_sha256 || c.sha256)}</bdi></span>
      ${c.signer_email ? `<span>البريد الإلكتروني للحساب: <bdi>${esc(c.signer_email)}</bdi></span>` : ''}</footer>` : ''}
  </article>`;

  const load = (src) => new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  // A4 PDF drawn directly on canvas (the browser's own text shaping handles Arabic correctly; html2canvas doesn't)
  const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  window.contractPdf = async (c) => {
    await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const K = 2, W = 794 * K, H = 1123 * K, M = 56 * K, CW = W - M * 2;   // A4 at 96dpi ×2
    const FONT = "'IBM Plex Sans Arabic','Readex Pro',Tahoma,Arial,sans-serif";
    const [logo, sig] = await Promise.all([loadImg('img/biosyn-logo-light.png'), c.signature_png ? loadImg(c.signature_png) : null]);
    const pages = []; let cv, ctx, y;
    const newPage = () => {
      cv = document.createElement('canvas'); cv.width = W; cv.height = H; ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      pages.push(cv); y = M;
      // header on every page
      if (logo) { const lh = 34 * K, lw = logo.width * lh / logo.height; ctx.drawImage(logo, M, y - 4 * K, lw, lh); }
      ctx.fillStyle = '#010232'; ctx.font = `700 ${15 * K}px ${FONT}`; ctx.fillText(c.title, W - M, y + 14 * K);
      ctx.fillStyle = '#5d6088'; ctx.font = `400 ${11 * K}px ${FONT}`;
      ctx.fillText(`الإصدار ${c.version}${c.id ? ' · رقم الاتفاقية ' + String(c.id).slice(0, 8).toUpperCase() : ''} · صفحة ${pages.length}`, W - M, y + 32 * K);
      y += 46 * K; ctx.fillStyle = '#c6f84a'; ctx.fillRect(M, y, CW, 3 * K); y += 22 * K;
    };
    const ensure = (h) => { if (y + h > H - M) newPage(); };
    const wrap = (text, font, width) => {
      ctx.font = font; const words = String(text).split(/\s+/); const lines = []; let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line); return lines;
    };
    const para = (text, { size = 13, weight = 400, color = '#1a1d3a', gap = 6, lh = 1.9, indent = 0, bar = false } = {}) => {
      const font = `${weight} ${size * K}px ${FONT}`, lines = wrap(iso(text), font, CW - indent * K), step = size * lh * K;
      lines.forEach((l, i) => {
        ensure(step);
        if (bar && i === 0) { ctx.fillStyle = '#c6f84a'; ctx.fillRect(W - M - 4 * K, y + 3 * K, 4 * K, size * 1.3 * K); }
        ctx.fillStyle = color; ctx.font = font; ctx.fillText(l, W - M - indent * K, y + size * 1.25 * K); y += step;
      });
      y += gap * K;
    };
    newPage();
    String(c.body || '').trim().split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
      if (i === 0) para(l, { size: 17, weight: 700, color: '#010232', gap: 4 });
      else if (/^\d+\)\s/.test(l)) { y += 8 * K; para(l, { size: 14, weight: 700, color: '#010232', gap: 2, indent: 12, bar: true }); }
      else if (/^(الطرف|الكورس|تاريخ)/.test(l)) para(l, { size: 13, weight: 600, color: '#010232', gap: 2 });
      else para(l, { size: 12.5, gap: 4 });
    });
    // signatures
    ensure(220 * K); y += 14 * K; ctx.fillStyle = '#e3e5f1'; ctx.fillRect(M, y, CW, 1 * K); y += 26 * K;
    const colR = W - M, colL = M + CW / 2 - 20 * K, top = y;
    ctx.fillStyle = '#5d6088'; ctx.font = `400 ${11 * K}px ${FONT}`; ctx.fillText('الطرف الأول', colR, y); ctx.fillText('الطرف الثاني (المحاضر)', colL, y);
    y += 22 * K; ctx.fillStyle = '#010232'; ctx.font = `700 ${14 * K}px ${FONT}`; ctx.fillText('Biosyn Egypt', colR, y); ctx.fillText(c.signer_name || '—', colL, y);
    // stamp
    const sx = colR - 70 * K, sy = y + 72 * K, r = 52 * K;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.14); ctx.strokeStyle = '#3a2a8c'; ctx.lineWidth = 2.5 * K;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r - 7 * K, 0, Math.PI * 2); ctx.lineWidth = 1 * K; ctx.stroke();
    ctx.fillStyle = '#3a2a8c'; ctx.textAlign = 'center'; ctx.font = `800 ${13 * K}px ${FONT}`; ctx.fillText('Biosyn Egypt', 0, -2 * K);
    ctx.font = `600 ${10 * K}px ${FONT}`; ctx.fillText('معتمد إلكترونيًا', 0, 16 * K); ctx.restore(); ctx.textAlign = 'right';
    if (sig) { const sh = 70 * K, sw = Math.min(240 * K, sig.width * sh / sig.height); ctx.drawImage(sig, colL - sw, y + 12 * K, sw, sh); }
    ctx.fillStyle = '#1a1d3a'; ctx.fillRect(colL - 240 * K, y + 88 * K, 240 * K, 1.5 * K);
    if (c.signed_at) { ctx.fillStyle = '#5d6088'; ctx.font = `400 ${11 * K}px ${FONT}`; ctx.fillText('وقّع في ' + fmt(c.signed_at), colL, y + 108 * K); }
    y = top + 190 * K;
    // audit trail
    if (c.signed_at) {
      const rows = [`رقم الاتفاقية: ${c.id}`, `التاريخ والوقت: ${new Date(c.signed_at).toISOString()} (UTC)`, c.ip ? `عنوان IP: ${c.ip}` : '', c.signer_email ? `البريد الإلكتروني للحساب: ${c.signer_email}` : '', `البصمة الرقمية للنص (SHA-256): ${c.body_sha256 || c.sha256}`].filter(Boolean);
      const bh = (rows.length * 18 + 40) * K; ensure(bh);
      ctx.fillStyle = '#f4f6fb'; ctx.fillRect(M, y, CW, bh); y += 24 * K;
      ctx.fillStyle = '#010232'; ctx.font = `700 ${12 * K}px ${FONT}`; ctx.fillText('سجل التوقيع الإلكتروني', W - M - 14 * K, y); y += 20 * K;
      ctx.fillStyle = '#3f4366'; ctx.font = `400 ${10.5 * K}px ${FONT}`;
      rows.forEach((t) => { ctx.fillText(iso(t).replace(/\((UTC|SHA-256)\)/g, '\u2066($1)\u2069'), W - M - 14 * K, y); y += 18 * K; });
    }
    const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    pages.forEach((p, i) => { if (i) pdf.addPage(); pdf.addImage(p.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, pw, ph); });
    pdf.setProperties({ title: c.title + (c.id ? ' — ' + String(c.id).slice(0, 8).toUpperCase() : ''), author: 'Biosyn Egypt', subject: 'Instructor agreement' });
    window.__lastContractPages = pages;   // for previews/tests
    return pdf.output('blob');
  };

  // signature pad: returns { el, isEmpty(), toDataURL(), clear() }
  window.signaturePad = (canvas) => {
    const ctx = canvas.getContext('2d'); let drawing = false, dirty = false, last = null, ink = 0;
    const fit = () => { const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1; canvas.width = r.width * d; canvas.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1a5c'; };
    fit();
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ink += Math.hypot(p.x - last.x, p.y - last.y); last = p; dirty = true; e.preventDefault(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
    return {
      isEmpty: () => !dirty || ink < 40,
      clear: () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); dirty = false; ink = 0; },
      toDataURL: () => {   // tight crop on a white background, max 900px wide
        const src = document.createElement('canvas'); src.width = canvas.width; src.height = canvas.height;
        const sc = src.getContext('2d'); sc.fillStyle = '#fff'; sc.fillRect(0, 0, src.width, src.height); sc.drawImage(canvas, 0, 0);
        const k = Math.min(1, 900 / src.width), out = document.createElement('canvas'); out.width = src.width * k; out.height = src.height * k;
        out.getContext('2d').drawImage(src, 0, 0, out.width, out.height); return out.toDataURL('image/png');
      },
    };
  };
})();
