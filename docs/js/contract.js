/* Instructor agreement: one renderer for the signing step, the printable page (contract.html) and the PDF copy. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => new Date(d).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // body text → paragraphs; "1) …" lines become clause headings
  function bodyHTML(text) {
    return String(text || '').trim().split(/\n/).map((l) => l.trim()).filter(Boolean).map((l, i) =>
      i === 0 ? `<h1>${esc(l)}</h1>` : /^\d+\)\s/.test(l) ? `<h3>${esc(l)}</h3>` : /^(الطرف|الكورس|تاريخ)/.test(l) ? `<p class="kc-party">${esc(l)}</p>` : `<p>${esc(l)}</p>`).join('');
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

  // A4 PDF from the rendered document (image-based, so Arabic shaping is exactly what the browser shows)
  window.contractPdf = async (c) => {
    await load('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1';
    host.innerHTML = window.contractDoc(c);
    document.body.appendChild(host);
    try {
      await Promise.all([...host.querySelectorAll('img')].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const canvas = await window.html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 24;
      const iw = pw - m * 2, scale = iw / canvas.width, sliceH = Math.floor((ph - m * 2) / scale);
      for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
        const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.min(sliceH, canvas.height - y);
        part.getContext('2d').drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
        if (page) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', m, m, iw, part.height * scale);
      }
      pdf.setProperties({ title: c.title + (c.id ? ' — ' + String(c.id).slice(0, 8).toUpperCase() : ''), author: 'Biosyn Egypt', subject: 'Instructor agreement' });
      return pdf.output('blob');
    } finally { host.remove(); }
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
