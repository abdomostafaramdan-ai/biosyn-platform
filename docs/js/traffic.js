/* Admin → «زيارات المنصة»: first-party traffic (visitors today / month / year, countries, sources, pages, devices).
   Data: admin_traffic() RPC over the visits table (filled by trackVisit() in app.js). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  let CN = null; try { CN = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch {}
  const country = (k) => (k === '??' ? 'غير معروف' : (CN && CN.of(k)) || k);
  const flag = (k) => (/^[A-Z]{2}$/.test(k) ? String.fromCodePoint(...[...k].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');
  const SRC = { direct: 'مباشر / بدون مصدر', google: 'Google', bing: 'Bing', facebook: 'Facebook', instagram: 'Instagram', x: 'X (Twitter)', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram',
    chatgpt: '🤖 ChatGPT', perplexity: '🤖 Perplexity', claude: '🤖 Claude', gemini: '🤖 Gemini', copilot: '🤖 Copilot', deepseek: '🤖 DeepSeek', yahoo: 'Yahoo', duckduckgo: 'DuckDuckGo' };
  const DEV = { mobile: '📱 موبايل', desktop: '💻 كمبيوتر', tablet: '📟 تابلت', unknown: 'غير معروف' };
  const PAGE = { '/': 'الرئيسية', '/courses.html': 'الكورسات المسجلة', '/interactive.html': 'الكورسات التفاعلية', '/pricing.html': 'الأسعار', '/login.html': 'تسجيل الدخول', '/account.html': 'لوحة الطالب', '/watch.html': 'صفحة المشاهدة',
    '/consultations.html': 'الاستشارات', '/institutions.html': 'المؤسسات', '/teach.html': 'انضم كمحاضر', '/instructors.html': 'المحاضرين', '/blog.html': 'المدونة', '/verify.html': 'التحقق من الشهادة', '/certificate.html': 'صفحة شهادة' };
  const pageName = (p) => PAGE[p] || (/^\/course-/.test(p) ? 'كورس: ' + p.replace(/^\/course-|\.html$/g, '') : /^\/course\.html\?c=/.test(p) ? 'كورس: ' + p.split('=')[1] : p);

  const startOf = (k) => {
    const now = new Date(), d = new Date(now);
    if (k === 'today') d.setHours(0, 0, 0, 0);
    else if (k === '7d') d.setDate(d.getDate() - 7);
    else if (k === '30d') d.setDate(d.getDate() - 30);
    else if (k === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); }
    else if (k === 'year') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); }
    else if (k === '12m') d.setMonth(d.getMonth() - 12);
    return d.toISOString();
  };
  const RANGES = [['today', 'اليوم'], ['7d', 'آخر 7 أيام'], ['30d', 'آخر 30 يوم'], ['month', 'هذا الشهر'], ['year', 'هذه السنة'], ['12m', 'آخر 12 شهر']];

  // bars chart (inline SVG): visitors bars + page views line
  function chart(series, daily) {
    if (!series.length) return '<div class="bx-empty-big" style="padding:28px"><b>مفيش زيارات في الفترة دي لسه</b>العدّاد بدأ يشتغل، والأرقام هتظهر هنا أول ما الزوار يدخلوا.</div>';
    const W = 760, H = 220, P = 28, max = Math.max(...series.map((s) => s.pv), 1), bw = (W - P * 2) / series.length;
    const y = (v) => H - P - (v / max) * (H - P * 2);
    const lbl = (d) => (daily ? d.slice(8) + '/' + d.slice(5, 7) : d.slice(5) + '/' + d.slice(2, 4));
    const step = Math.ceil(series.length / 12);
    const bars = series.map((s, i) => `<g><rect x="${P + i * bw + bw * 0.18}" y="${y(s.v)}" width="${Math.max(2, bw * 0.64)}" height="${H - P - y(s.v)}" rx="3" class="tx-bar"><title>${s.d}: ${n(s.v)} زائر · ${n(s.pv)} مشاهدة صفحة</title></rect>${i % step === 0 ? `<text x="${P + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="tx-ax">${lbl(s.d)}</text>` : ''}</g>`).join('');
    const line = series.map((s, i) => `${i ? 'L' : 'M'}${(P + i * bw + bw / 2).toFixed(1)},${y(s.pv).toFixed(1)}`).join(' ');
    return `<svg class="tx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="الزوار ومشاهدات الصفحات"><line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" class="tx-grid"/><line x1="${P}" x2="${W - P}" y1="${y(max)}" y2="${y(max)}" class="tx-grid"/><text x="${W - P}" y="${y(max) - 6}" text-anchor="end" class="tx-ax">${n(max)}</text>${bars}<path d="${line}" class="tx-line"/></svg>
      <div class="tx-legend"><span><i class="tx-k1"></i>زوار</span><span><i class="tx-k2"></i>مشاهدات صفحات</span></div>`;
  }
  const bars = (rows, total, label, val = (r) => r.v) => rows.length
    ? `<ul class="tx-list">${rows.map((r) => `<li><span class="tx-name" dir="auto">${label(r)}</span><span class="tx-num">${n(val(r))}<small>${pct(val(r), total)}%</small></span><i style="width:${Math.max(2, pct(val(r), total))}%"></i></li>`).join('')}</ul>`
    : '<p class="bx-hint">لا توجد بيانات بعد.</p>';

  window.trafficDashboard = async function (main) {
    let range = '30d', timer = null;
    const draw = async () => {
      let d;
      try { d = await sb.rpc('admin_traffic', { p_from: startOf(range), p_to: new Date().toISOString() }); }
      catch (e) { main.innerHTML = `<div class="bx-formmsg err">${esc(arErr(e))}</div>`; return; }
      const k = d.kpi, r = d.range, sum = (a) => a.reduce((s, x) => s + Number(x.v || 0), 0);
      const vsY = k.yesterday_v ? Math.round(((k.today_v - k.yesterday_v) / k.yesterday_v) * 100) : null;
      const by = r.signups_by || {}, hours = Array.from({ length: 24 }, (_, h) => Number((d.hours.find((x) => x.h === h) || {}).pv || 0)), hmax = Math.max(...hours, 1);
      main.innerHTML = `
        <div class="tx-head"><div><p class="bx-hint" style="margin:0"><span class="bx-live"><i></i></span> بيتحدث كل دقيقة · بتوقيت القاهرة · زيارات فريق العمل مش محسوبة</p></div>
          <div class="tx-ranges" role="group" aria-label="الفترة">${RANGES.map(([id, t]) => `<button type="button" class="bx-chip" data-r="${id}" aria-pressed="${id === range}">${t}</button>`).join('')}</div></div>
        <div class="bx-stats tx-kpis">
          ${D.stat('موجودين دلوقتي', n(k.online), 'آخر 5 دقايق')}
          ${D.stat('زوار اليوم', n(k.today_v), (vsY === null ? '' : (vsY >= 0 ? '▲ ' : '▼ ') + Math.abs(vsY) + '% عن امبارح · ') + n(k.today_pv) + ' مشاهدة')}
          ${D.stat('زوار الشهر', n(k.month_v), n(k.month_pv) + ' مشاهدة صفحة')}
          ${D.stat('زوار السنة', n(k.year_v), n(k.year_pv) + ' مشاهدة صفحة')}
          ${D.stat('حسابات جديدة', n(k.signups_today) + ' اليوم', n(k.signups_month) + ' الشهر · ' + n(k.signups_year) + ' السنة')}
        </div>
        ${D.panel('الزوار خلال الفترة', chart(d.series, d.daily), `<small class="bx-muted">${RANGES.find((x) => x[0] === range)[1]}</small>`)}
        <div class="bx-stats tx-range">
          ${D.stat('زوار', n(r.visitors), pct(r.new_v, r.visitors) + '% زوار جدد')}
          ${D.stat('جلسات', n(r.sessions), r.sessions ? (r.pageviews / r.sessions).toFixed(1) + ' صفحة / جلسة' : '')}
          ${D.stat('مشاهدات صفحات', n(r.pageviews))}
          ${D.stat('تسجيلات جديدة', n(r.signups), Object.keys(by).length ? Object.entries(by).map(([p, c]) => `${p === 'google' ? 'Google' : p === 'email' ? 'إيميل' : p} ${c}`).join(' · ') : '')}
          ${D.stat('عمليات دفع', n(r.paid), r.visitors ? 'تحويل ' + ((r.paid / r.visitors) * 100).toFixed(1) + '% من الزوار' : '')}
        </div>
        <div class="tx-grid2">
          ${D.panel('الدول', bars(d.countries, sum(d.countries), (x) => `${flag(x.k)} ${esc(country(x.k))}`))}
          ${D.panel('مصادر الزيارات', bars(d.sources, sum(d.sources), (x) => esc(SRC[x.k] || x.k)), '<small class="bx-muted">بالجلسات</small>')}
          ${D.panel('أكتر الصفحات زيارة', bars(d.pages, d.pages.reduce((s, x) => s + Number(x.pv), 0), (x) => esc(pageName(x.k)), (x) => x.pv), '<small class="bx-muted">مشاهدات</small>')}
          ${D.panel('الأجهزة والمتصفحات', bars(d.devices, sum(d.devices), (x) => esc(DEV[x.k] || x.k)) + '<div style="height:14px"></div>' + bars(d.browsers, sum(d.browsers), (x) => esc(x.k)))}
        </div>
        ${D.panel('أوقات الذروة (بتوقيت القاهرة)', `<div class="tx-hours">${hours.map((v, h) => `<div title="${h}:00 — ${n(v)} مشاهدة"><i style="height:${Math.max(3, (v / hmax) * 100)}%"></i><small>${h % 3 === 0 ? h : ''}</small></div>`).join('')}</div>`)}
        <p class="bx-hint">للتفاصيل الأعمق (كلمات البحث في جوجل، الحملات، مسار التحويل) افتح <a class="bx-link" href="https://analytics.google.com/analytics/web/#/p562437867/reports/intelligenthome" target="_blank" rel="noopener">Google Analytics</a> و<a class="bx-link" href="https://search.google.com/search-console?resource_id=sc-domain%3Abiosyneg.com" target="_blank" rel="noopener">Search Console</a>.</p>`;
      $$('[data-r]', main).forEach((b) => (b.onclick = () => { range = b.dataset.r; draw(); }));
    };
    await draw();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.body.contains(main) || document.hidden) return; if ($('.tx-kpis', main)) draw(); else clearInterval(timer); }, 60000);
  };
})();
