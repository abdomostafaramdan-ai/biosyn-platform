/* Certificate page: certificate.html?c=CODE — renders the sheet from the public verify_certificate() RPC */
(function () {
  const AR = /[؀-ۿ]/;
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = (v) => { const x = new Date(v); return { d: x.getDate(), m: MON[x.getMonth()], y: x.getFullYear() }; };
  const full = (v) => { const x = d(v); return `${x.d}\u00a0${x.m}\u00a0${x.y}`; };
  // "3 March to 3 June 2026" / "3 to 28 June 2026" / "20 December 2025 to 10 January 2026"
  const range = (a, b) => {
    const A = d(a), B = d(b);
    if (A.y !== B.y) return `${full(a)} to ${full(b)}`;
    if (A.m !== B.m) return `${A.d}\u00a0${A.m} to ${B.d}\u00a0${B.m}\u00a0${B.y}`;
    return A.d === B.d ? full(b) : `${A.d} to ${B.d}\u00a0${B.m}\u00a0${B.y}`;
  };
  const hrs = (h) => { const n = Number(h); if (!(n > 0)) return ''; const r = n >= 10 ? Math.round(n) : Math.round(n * 2) / 2; return r + (r === 1 ? ' Hour' : ' Hours'); };

  function lineFor(r) {
    const h = hrs(r.hours);
    if (r.kind === 'interactive') {
      const when = r.starts_at && r.ends_at ? ` held from ${range(r.starts_at, r.ends_at)}` : r.ends_at ? ` completed on ${full(r.ends_at)}` : '';
      return `This candidate has successfully completed a${h ? ' ' + h : ''} Live Online Training${when}, in`;
    }
    return `This candidate has successfully completed the${h ? ' ' + h : ''} Online Course`;
  }

  function loadQR() {
    if (window.QRCode) return Promise.resolve(true);
    return new Promise((res) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  }

  // scale the fixed-size sheet to the available width
  function fit(stage) {
    const box = stage.querySelector('.cx-scale'), cert = box && box.querySelector('.cx-cert');
    if (!cert) return;
    const k = Math.min(1, stage.clientWidth / 1123);
    cert.style.transform = `scale(${k})`; box.style.height = 794 * k + 'px'; box.style.width = 1123 * k + 'px';
  }

  function render(stage, r, url) {
    const node = document.getElementById('cx-tpl').content.firstElementChild.cloneNode(true);
    const f = (k) => node.querySelector(`[data-f="${k}"]`);
    const nm = f('name');
    if (r.name) { nm.textContent = r.name; if (AR.test(r.name)) nm.classList.add('ar'); }
    else { nm.textContent = 'Your name here'; nm.classList.add('empty'); }
    f('line').textContent = lineFor(r);
    const co = f('course'); co.textContent = r.course || '';
    if (AR.test(r.course || '')) co.classList.add('ar'); if ((r.course || '').length > 46) co.classList.add('long');
    f('date').textContent = full(r.issued_at);
    f('code').textContent = r.code;
    f('vurl').textContent = 'biosyneg.com/verify';
    if (r.founding) { const by = node.querySelector('.cx-by'); if (by) by.insertAdjacentHTML('beforeend', ' <span class="cx-founder" data-no-i18n>★ Founding Member</span>'); }
    const box = document.createElement('div'); box.className = 'cx-scale'; box.appendChild(node);
    stage.innerHTML = ''; stage.appendChild(box); fit(stage);
    // shrink a long name until it fits on one line
    requestAnimationFrame(() => { let s = parseFloat(getComputedStyle(nm).fontSize); while (nm.scrollWidth > nm.clientWidth + 1 && s > 30) { s -= 2; nm.style.fontSize = s + 'px'; } });
    loadQR().then((ok) => { const el = f('qr'); if (ok && window.QRCode) new QRCode(el, { text: url, width: 108, height: 108, colorDark: '#2b0b52', correctLevel: QRCode.CorrectLevel.M }); else el.remove(); });
  }

  async function page() {
    const stage = $('[data-stage]'), code = (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase();
    const fail = (t, s) => { stage.innerHTML = `<div class="bx-empty-big" style="margin:40px auto;max-width:560px"><b>${t}</b>${s}</div>`; };
    if (!/^[A-Z0-9]{6,20}$/.test(code)) return fail('رابط الشهادة غير مكتمل', 'افتح الشهادة من لوحة حسابك، أو <a class="bx-link" href="verify.html">تحقق برقم الشهادة</a>.');
    let r;
    try { r = await sb.rpc('verify_certificate', { p_code: code }); } catch (e) { return fail('تعذّر تحميل الشهادة', esc(arErr(e))); }
    if (!r || !r.code) return fail('لم نجد شهادة بهذا الرقم', 'تأكد من الرابط، أو <a class="bx-link" href="verify.html">تحقق برقم الشهادة</a>.');
    const url = new URL('certificate.html?c=' + r.code, location.href).href;
    document.title = `${r.name || 'Certificate'} · ${r.course} | Biosyn Egypt`;
    render(stage, r, new URL('verify.html?c=' + r.code, location.href).href);
    addEventListener('resize', () => fit(stage));

    const bar = $('[data-bar]'); bar.hidden = false;
    $('[data-sub]', bar).innerHTML = `✓ شهادة صحيحة صادرة من Biosyn Egypt · رقم <span class="bs-latin" dir="ltr">${esc(r.code)}</span>`;
    $('[data-print]', bar).onclick = () => window.print();
    $('[data-copy]', bar).onclick = async () => { try { await navigator.clipboard.writeText(url); ui.toast('تم نسخ رابط الشهادة.'); } catch { ui.toast(url); } };
    const iss = new Date(r.issued_at);
    $('[data-li]', bar).href = 'https://www.linkedin.com/profile/add?' + new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name: r.course, organizationName: 'Biosyn Egypt', issueYear: iss.getFullYear(), issueMonth: iss.getMonth() + 1, certUrl: url, certId: r.code });

    // the owner fixes a missing printed name once (it is frozen after that)
    if (!r.name && sb.user) {
      await sb.auth.ready;
      const mine = await sb.get('certificates', { select: 'id', code: 'eq.' + r.code, user_id: 'eq.' + sb.user.id }).catch(() => []);
      if (mine[0]) {
        const fx = $('[data-fix]'); fx.hidden = false;
        fx.innerHTML = `<b>اكتب اسمك كما تحب أن يظهر على الشهادة</b><p style="margin:6px 0 0">يُفضّل بالإنجليزي كما في جواز السفر. الاسم يُثبَّت بعد الحفظ ولا يمكن تغييره إلا عن طريق الدعم.</p>
          <form novalidate><input class="bx-input" dir="auto" maxlength="80" placeholder="Ahmed Mohamed Ali" aria-label="الاسم على الشهادة"><button class="bs-btn bs-btn-primary" type="submit">حفظ الاسم</button></form><div class="bx-formmsg" aria-live="polite"></div>`;
        $('form', fx).onsubmit = async (e) => {
          e.preventDefault(); const v = $('input', fx).value.trim(), m = $('.bx-formmsg', fx);
          if (v.split(/\s+/).length < 2) { m.className = 'bx-formmsg err'; m.textContent = 'اكتب اسمك بالكامل (اسمين على الأقل).'; return; }
          try { await sb.rpc('set_certificate_name', { p_cert: mine[0].id, p_name: v }); fx.hidden = true; r.name = v; render(stage, r, new URL('verify.html?c=' + r.code, location.href).href); ui.toast('تم تثبيت الاسم على الشهادة ✓'); }
          catch (err) { m.className = 'bx-formmsg err'; m.textContent = arErr(err); }
        };
      }
    }
  }
  window.BiosynPages = window.BiosynPages || {};
  window.BiosynPages.certificate = page;
})();
