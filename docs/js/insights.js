/* Admin → «مركز التحليلات»: one page that follows the whole business.
   Data: admin_insights(p_from, p_to) RPC — revenue, funnel, traffic, learning, courses, emails, support, forms, coupons, referrals.
   Staff accounts (admin / support) are excluded from revenue, sign-ups and learning so tests don't skew the numbers.
   Bilingual: every label is written as L('عربي', 'English'). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const en = () => document.documentElement.getAttribute('data-lang') === 'en';
  const L = (a, b) => (en() ? b : a);
  const N = (v) => Number(v || 0);
  const n = (v) => N(v).toLocaleString('en-US');
  const money = (v) => n(Math.round(N(v))) + L(' ج.م', ' EGP');
  const pct = (a, b) => (N(b) ? (N(a) / N(b)) * 100 : 0);
  const p1 = (v) => (v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)) + '%';
  const delta = (cur, prev) => {
    if (!N(prev)) return N(cur) ? `<span class="in-d up">${L('جديد', 'new')}</span>` : '';
    const d = ((N(cur) - N(prev)) / N(prev)) * 100;
    return `<span class="in-d ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}%</span>`;
  };
  let CN = null;
  const country = (k) => { try { CN = CN || new Intl.DisplayNames([en() ? 'en' : 'ar'], { type: 'region' }); } catch (e) {} return k === '??' || k === '—' ? L('غير معروف', 'Unknown') : (CN && /^[A-Z]{2}$/.test(k) && CN.of(k)) || k; };
  const flag = (k) => (/^[A-Z]{2}$/.test(k) ? String.fromCodePoint(...[...k].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');
  const SRC = { direct: ['مباشر', 'Direct'], google: ['Google'], bing: ['Bing'], facebook: ['Facebook'], instagram: ['Instagram'], x: ['X'], linkedin: ['LinkedIn'], youtube: ['YouTube'], tiktok: ['TikTok'], whatsapp: ['WhatsApp'], telegram: ['Telegram'],
    chatgpt: ['🤖 ChatGPT'], perplexity: ['🤖 Perplexity'], claude: ['🤖 Claude'], gemini: ['🤖 Gemini'], copilot: ['🤖 Copilot'], deepseek: ['🤖 DeepSeek'], reactivation: ['حملة إعادة التفعيل', 'Reactivation emails'], email: ['البريد', 'Email'] };
  const src = (k) => { const s = SRC[k]; return s ? (en() && s[1]) || s[0] : k; };
  const PURPOSE = { subscription: ['اشتراك', 'Subscription'], interactive_course: ['دورة تفاعلية', 'Interactive course'], consultation: ['استشارة', 'Consultation'] };
  const REQ = { instructor_recorded: ['محاضر · دورة مسجلة', 'Instructor · recorded'], instructor_interactive: ['محاضر · دورة تفاعلية', 'Instructor · interactive'], instructor_recording_help: ['محاضر · مساعدة في التسجيل', 'Instructor · recording help'], institution: ['مؤسسة', 'Institution'], consultation: ['استشارة', 'Consultation'], refund: ['استرداد', 'Refund'] };
  const tr = (m, k) => (m[k] ? (en() ? m[k][1] || m[k][0] : m[k][0]) : k);
  const PAGES = { '/': ['الرئيسية', 'Home'], '/courses.html': ['الدورات المسجلة', 'Recorded courses'], '/interactive.html': ['الدورات التفاعلية', 'Live courses'], '/pricing.html': ['الأسعار', 'Pricing'], '/login.html': ['تسجيل الدخول', 'Sign in'], '/account.html': ['لوحة الطالب', 'Student dashboard'], '/watch.html': ['صفحة المشاهدة', 'Player'], '/blog.html': ['المدونة', 'Blog'], '/news.html': ['الأخبار والفعاليات', 'News & events'], '/about.html': ['من نحن', 'About'], '/teach.html': ['انضم كمحاضر', 'Teach'], '/instructors.html': ['المحاضرون', 'Instructors'], '/consultations.html': ['الاستشارات', 'Consultations'], '/verify.html': ['التحقق من الشهادات', 'Verify certificate'] };
  const page = (p) => (PAGES[p] ? tr(PAGES, p) : /^\/course-/.test(p) ? L('دورة: ', 'Course: ') + p.replace(/^\/course-|\.html$/g, '') : /^\/blog-/.test(p) ? L('مقال: ', 'Article: ') + p.replace(/^\/blog-|\.html$/g, '') : p);
  const CST = { draft: ['مسودة', 'Draft'], sending: ['قيد الإرسال', 'Sending'], done: ['اكتملت', 'Done'], paused: ['متوقفة', 'Paused'], finished: ['اكتملت', 'Finished'] };
  const DEV = { mobile: ['هاتف', 'Mobile'], desktop: ['كمبيوتر', 'Desktop'], tablet: ['تابلت', 'Tablet'], unknown: ['غير معروف', 'Unknown'] };
  const DAYS = [['الأحد', 'Sun'], ['الإثنين', 'Mon'], ['الثلاثاء', 'Tue'], ['الأربعاء', 'Wed'], ['الخميس', 'Thu'], ['الجمعة', 'Fri'], ['السبت', 'Sat']];
  const RANGES = [['7d', 'آخر 7 أيام', 'Last 7 days', 7], ['30d', 'آخر 30 يومًا', 'Last 30 days', 30], ['90d', 'آخر 90 يومًا', 'Last 90 days', 90], ['month', 'هذا الشهر', 'This month'], ['year', 'هذه السنة', 'This year'], ['12m', 'آخر 12 شهرًا', 'Last 12 months', 365]];
  const startOf = (k) => {
    const d = new Date(), r = RANGES.find((x) => x[0] === k);
    if (k === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); } else if (k === 'year') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); } else d.setTime(d.getTime() - r[3] * 864e5);
    return d.toISOString();
  };
  const METRICS = [['visitors', 'الزوار', 'Visitors', '#8ea2ff'], ['signups', 'حسابات جديدة', 'Sign-ups', '#c6f84a'], ['revenue', 'الإيرادات', 'Revenue', '#ffd76a'], ['learners', 'متعلمون نشطون', 'Active learners', '#7ee7c8']];
  const KEY = 'biosyn.admin.insights';
  const pref = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} };

  // ---------- tiny SVG charts ----------
  function spark(vals, color) {
    if (vals.length < 2) return '';
    const W = 120, H = 32, max = Math.max(...vals, 1), x = (i) => (i / (vals.length - 1)) * W, y = (v) => H - 2 - (v / max) * (H - 4);
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    return `<svg class="in-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="none"><path d="${d}L${W},${H}L0,${H}Z" fill="${color}" opacity=".14"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }
  function trend(series, key, daily) {
    const m = METRICS.find((x) => x[0] === key), vals = series.map((s) => N(s[key]));
    if (!series.length) return `<p class="bx-hint">${L('لا توجد بيانات في هذه الفترة.', 'No data in this period.')}</p>`;
    const W = 860, H = 260, PL = 44, PR = 16, PT = 16, PB = 30, max = Math.max(...vals, 1), nice = niceMax(max);
    const x = (i) => PL + (series.length === 1 ? (W - PL - PR) / 2 : (i / (series.length - 1)) * (W - PL - PR)), y = (v) => PT + (1 - v / nice) * (H - PT - PB);
    const lbl = (d) => (daily ? d.slice(8) + '/' + d.slice(5, 7) : d.slice(5) + '/' + d.slice(2, 4));
    const step = Math.max(1, Math.ceil(series.length / 10));
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="tx-grid"/><text x="${PL - 6}" y="${y(nice * f) + 4}" text-anchor="end" class="tx-ax">${short(nice * f)}</text>`).join('');
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(vals.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
    const ticks = series.map((s, i) => (i % step === 0 || i === series.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="tx-ax">${lbl(s.d)}</text>` : '')).join('');
    const dots = series.map((s, i) => `<circle cx="${x(i)}" cy="${y(vals[i])}" r="${series.length > 60 ? 0 : 3}" fill="${m[3]}"/><rect x="${x(i) - (W - PL - PR) / series.length / 2}" y="${PT}" width="${Math.max(4, (W - PL - PR) / series.length)}" height="${H - PT - PB}" fill="transparent" data-i="${i}"/>`).join('');
    return `<div class="in-trend"><svg class="tx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L(m[1], m[2]))}">${grid}<path d="${area}" fill="${m[3]}" opacity=".12"/><path d="${line}" fill="none" stroke="${m[3]}" stroke-width="2.4" stroke-linejoin="round"/>${dots}${ticks}<line class="in-cross" x1="0" x2="0" y1="${PT}" y2="${H - PB}" hidden/></svg><div class="in-tip" hidden></div></div>`;
  }
  const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const short = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : Math.round(v));
  const bars = (rows, label, val = (r) => r.v, fmt = n, extra) => {
    const total = rows.reduce((s, r) => s + N(val(r)), 0);
    return rows.length ? `<ul class="tx-list">${rows.map((r) => `<li><span class="tx-name" dir="auto">${label(r)}</span><span class="tx-num">${fmt(val(r))}${extra ? extra(r) : ''}<small>${p1(pct(val(r), total))}</small></span><i style="width:${Math.max(2, pct(val(r), total))}%"></i></li>`).join('')}</ul>` : `<p class="bx-hint">${L('لا توجد بيانات بعد.', 'No data yet.')}</p>`;
  };
  function funnel(f) {
    const steps = [['visitors', 'زوار الموقع', 'Site visitors'], ['course_viewers', 'شاهدوا صفحات الدورات', 'Viewed course pages'], ['pricing_viewers', 'شاهدوا صفحة الأسعار', 'Viewed pricing'], ['signups', 'أنشأوا حسابًا', 'Created an account'], ['checkout', 'بدأوا الدفع', 'Started checkout'], ['paid', 'أتموا الدفع', 'Paid'], ['learning', 'يتعلمون فعليًا', 'Actively learning']];
    const top = Math.max(N(f.visitors), 1);
    return `<ol class="in-funnel">${steps.map(([k, a, b], i) => {
      const v = N(f[k]), prev = i ? N(f[steps[i - 1][0]]) : 0;
      return `<li><div class="in-fl"><b>${L(a, b)}</b><span>${n(v)}${i ? ` <small>${prev ? p1(pct(v, prev)) + L(' من الخطوة السابقة', ' of previous step') : ''}</small>` : ''}</span></div><div class="in-fb"><i style="width:${Math.max(1.5, pct(v, top))}%"></i></div></li>`;
    }).join('')}</ol><p class="bx-hint" style="margin:10px 0 0">${L('التحويل الكلي من زائر إلى عميل:', 'Overall visitor → customer conversion:')} <b>${p1(pct(f.paid, f.visitors))}</b> · ${L('من حساب إلى عميل:', 'Account → customer:')} <b>${p1(pct(f.paid, f.signups))}</b></p>`;
  }

  // ---------- smart alerts: what needs attention now ----------
  function alerts(d) {
    const k = d.kpi, out = [], s = d.support || {};
    const add = (lvl, text, view) => out.push(`<${view ? `a href="#${view}"` : 'div'} class="in-alert ${lvl}">${text}</${view ? 'a' : 'div'}>`);
    if (N(k.new_requests)) add('warn', L(`${n(k.new_requests)} طلب جديد في صندوق الطلبات بانتظار المراجعة`, `${n(k.new_requests)} new request(s) waiting for review`), 'requests');
    if (N(s.waiting)) add('warn', L(`${n(s.waiting)} محادثة بانتظار ردّك` + (s.oldest_wait_h ? ` · أقدمها منذ ${n(s.oldest_wait_h)} ساعة` : ''), `${n(s.waiting)} conversation(s) waiting for your reply` + (s.oldest_wait_h ? ` · oldest ${n(s.oldest_wait_h)}h` : '')), 'tickets');
    if (N(k.pending_orders)) add('info', L(`${n(k.pending_orders)} عملية دفع لم تكتمل في الفترة — فرصة للمتابعة مع العملاء`, `${n(k.pending_orders)} unfinished checkout(s) — follow up with these customers`), 'payments');
    if (N(k.expiring_7d)) add('info', L(`${n(k.expiring_7d)} اشتراك ينتهي خلال 7 أيام — أرسل لهم عرض تجديد`, `${n(k.expiring_7d)} subscription(s) end within 7 days — send a renewal offer`), 'users');
    if (N(k.emails_failed)) add('danger', L(`${n(k.emails_failed)} رسالة بريد فشل إرسالها في الفترة`, `${n(k.emails_failed)} email(s) failed in this period`), 'emails');
    const r = d.reactivation || {};
    if (N(r.queued) && !N(r.sent_period)) add('info', L(`${n(r.queued)} مستخدم من المنصة القديمة لم تصلهم رسالة التفعيل بعد`, `${n(r.queued)} legacy users haven't received the activation email yet`), 'campaign');
    const cold = (d.courses || []).filter((c) => c.status === 'published' && N(c.page_visitors) >= 5 && !N(c.learners));
    if (cold.length) add('info', L(`دورات لها زيارات بلا متعلمين: ${cold.slice(0, 3).map((c) => esc(c.title)).join('، ')}`, `Courses with visits but no learners: ${cold.slice(0, 3).map((c) => esc(c.title)).join(', ')}`), 'courses');
    const empty = (d.courses || []).filter((c) => c.status === 'published' && c.kind === 'recorded' && !N(c.lectures));
    if (empty.length) add('danger', L(`دورات منشورة بلا محاضرات: ${empty.map((c) => esc(c.title)).join('، ')}`, `Published courses with no lectures: ${empty.map((c) => esc(c.title)).join(', ')}`), 'courses');
    if (!out.length) add('ok', L('لا يوجد ما يحتاج إلى تدخلك الآن ✓', 'Nothing needs your attention right now ✓'));
    return `<div class="in-alerts">${out.join('')}</div>`;
  }

  function coursesTable(rows, sortKey) {
    const cols = [['title', 'الدورة', 'Course'], ['page_visitors', 'زوار الصفحة', 'Page visitors'], ['learners', 'متعلمون (الفترة)', 'Learners (period)'], ['learners_all', 'كل المتعلمين', 'All learners'], ['completions', 'محاضرات مكتملة', 'Lectures completed'], ['avg_pct', 'متوسط المشاهدة', 'Avg. watched'], ['certs', 'شهادات', 'Certificates'], ['revenue', 'إيرادات', 'Revenue']];
    const s = [...rows].sort((a, b) => (sortKey === 'title' ? String(a.title).localeCompare(b.title) : N(b[sortKey]) - N(a[sortKey])));
    if (!s.length) return `<p class="bx-hint">${L('لا توجد دورات منشورة.', 'No published courses.')}</p>`;
    return `<div class="bx-tablewrap"><table class="bx-table in-ct"><thead><tr>${cols.map(([k, a, b]) => `<th><button type="button" class="in-sort" data-sort="${k}" aria-pressed="${k === sortKey}">${L(a, b)}${k === sortKey ? ' ↓' : ''}</button></th>`).join('')}</tr></thead><tbody>${s.map((c) => `<tr>
      <td><a class="bx-link" href="course-${esc(c.slug)}.html" target="_blank" rel="noopener" dir="auto">${esc(c.title)}</a> <small class="bx-muted">${c.kind === 'interactive' ? L('تفاعلية', 'Live') : n(c.lectures) + L(' محاضرة', ' lectures')}</small></td>
      <td>${n(c.page_visitors)}</td><td><b>${n(c.learners)}</b></td><td>${n(c.learners_all)}</td><td>${n(c.completions)}</td>
      <td><span class="in-meter"><i style="width:${Math.min(100, N(c.avg_pct))}%"></i></span> ${c.avg_pct == null ? '—' : n(c.avg_pct) + '%'}</td><td>${n(c.certs)}</td><td>${N(c.revenue) ? money(c.revenue) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function feed(rows) {
    const ic = { payment: '💳', signup: '👤', certificate: '🎓', request: '📥' };
    const txt = (r) => r.t === 'payment' ? L(`دفعة ${money(r.v)} · ${tr(PURPOSE, r.d)}`, `Payment ${money(r.v)} · ${tr(PURPOSE, r.d)}`)
      : r.t === 'signup' ? L(`حساب جديد: ${esc(r.v || '—')}`, `New account: ${esc(r.v || '—')}`) + (r.d ? ` ${flag(r.d)}` : '')
      : r.t === 'certificate' ? L(`شهادة لـ ${esc(r.v)} في ${esc(r.d || '')}`, `Certificate for ${esc(r.v)} in ${esc(r.d || '')}`)
      : L(`طلب ${tr(REQ, r.d)} من ${esc(r.v)}`, `${tr(REQ, r.d)} request from ${esc(r.v)}`);
    return rows.length ? `<ul class="in-feed">${rows.slice(0, 14).map((r) => `<li><span aria-hidden="true">${ic[r.t] || '•'}</span><span dir="auto">${txt(r)}</span><time>${D.dateTime(r.at)}</time></li>`).join('')}</ul>` : `<p class="bx-hint">${L('لا يوجد نشاط بعد.', 'No activity yet.')}</p>`;
  }

  function csv(d) {
    const rows = [['date', ...METRICS.map((m) => m[0])], ...d.series.map((s) => [s.d, ...METRICS.map((m) => N(s[m[0]]))]), [], ['course', 'page_visitors', 'learners', 'learners_all', 'completions', 'avg_pct', 'certificates', 'revenue_egp'],
      ...(d.courses || []).map((c) => [c.title, c.page_visitors, c.learners, c.learners_all, c.completions, c.avg_pct, c.certs, c.revenue])];
    const body = '﻿' + rows.map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    a.download = `biosyn-insights-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.insightsDashboard = async function (main) {
    let range = pref.range || '30d', metric = pref.metric || 'visitors', sortKey = pref.sort || 'learners', data = null, timer = null, busy = false;
    const draw = async (quiet) => {
      if (busy) return; busy = true;
      if (!quiet && !data) main.innerHTML = `<div class="bx-loading">${L('جارٍ تحميل التحليلات…', 'Loading analytics…')}</div>`;
      try { data = await sb.rpc('admin_insights', { p_from: startOf(range), p_to: new Date().toISOString() }); }
      catch (e) { busy = false; main.innerHTML = `<div class="bx-formmsg err">${esc(arErr(e))}</div>`; return; }
      busy = false; render();
    };
    const render = () => {
      const d = data, k = d.kpi, S = d.series || [], col = (key) => S.map((s) => N(s[key]));
      const R = RANGES.find((x) => x[0] === range), rl = L(R[1], R[2]);
      const tile = (label, val, cur, prev, sp, hint) => `<div class="bx-stat in-tile"><span>${label}</span><b>${val}</b><small class="bx-muted">${delta(cur, prev)} ${hint || ''}</small>${sp || ''}</div>`;
      const aov = N(k.orders[0]) ? N(k.revenue[0]) / N(k.orders[0]) : 0;
      const days = Math.max(1, (new Date(d.range.to) - new Date(d.range.from)) / 864e5);
      const runRate = (N(k.revenue[0]) / days) * 30;
      const r = d.reactivation || {}, sup = d.support || {};
      main.innerHTML = `
        <div class="tx-head"><div><p class="bx-hint" style="margin:0"><span class="bx-live"><i></i></span> ${L('يتحدّث كل دقيقة · بتوقيت القاهرة · حسابات فريق العمل مستبعدة من الإيرادات والتسجيلات', 'Refreshes every minute · Cairo time · team accounts excluded from revenue and sign-ups')}</p>
          <p class="bx-hint" style="margin:4px 0 0">${L('المتواجدون الآن:', 'Online now:')} <b>${n(k.online)}</b> · ${L('مقارنة بالفترة السابقة بنفس الطول', 'Compared with the previous period of the same length')}</p></div>
          <div class="tx-ranges" role="group" aria-label="${L('الفترة', 'Period')}">${RANGES.map(([id, a, b]) => `<button type="button" class="bx-chip" data-r="${id}" aria-pressed="${id === range}">${L(a, b)}</button>`).join('')}<button type="button" class="bs-btn bs-btn-secondary bs-btn-sm" data-csv>${L('تصدير CSV', 'Export CSV')}</button></div></div>
        ${D.panel(L('يحتاج إلى انتباهك', 'Needs your attention'), alerts(d))}
        <div class="bx-stats in-kpis">
          ${tile(L('الإيرادات', 'Revenue'), money(k.revenue[0]), k.revenue[0], k.revenue[1], spark(col('revenue'), '#ffd76a'), L(`معدل شهري ≈ ${money(runRate)}`, `≈ ${money(runRate)} / month`))}
          ${tile(L('عمليات الدفع', 'Orders'), n(k.orders[0]), k.orders[0], k.orders[1], '', L(`متوسط الطلب ${money(aov)}`, `Avg. order ${money(aov)}`))}
          ${tile(L('الزوار', 'Visitors'), n(k.visitors[0]), k.visitors[0], k.visitors[1], spark(col('visitors'), '#8ea2ff'), L(`${n(k.pageviews)} مشاهدة · ${n(k.sessions)} جلسة`, `${n(k.pageviews)} views · ${n(k.sessions)} sessions`))}
          ${tile(L('حسابات جديدة', 'New accounts'), n(k.signups[0]), k.signups[0], k.signups[1], spark(col('signups'), '#c6f84a'), L(`الإجمالي ${n(k.users_total)}`, `${n(k.users_total)} total`))}
          ${tile(L('متعلمون نشطون', 'Active learners'), n(k.learners[0]), k.learners[0], k.learners[1], spark(col('learners'), '#7ee7c8'), L(`${n(k.completions)} محاضرة مكتملة`, `${n(k.completions)} lectures completed`))}
          ${tile(L('اشتراكات سارية', 'Active subscriptions'), n(k.active_subs), 0, 0, '', L(`${n(k.expiring_7d)} تنتهي خلال 7 أيام`, `${n(k.expiring_7d)} end within 7 days`))}
          ${tile(L('شهادات صادرة', 'Certificates issued'), n(k.certificates[0]), k.certificates[0], k.certificates[1])}
          ${tile(L('تحويل الزوار', 'Visitor conversion'), p1(pct(d.funnel.paid, d.funnel.visitors)), 0, 0, '', L(`${n(k.buyers)} عميل دفع`, `${n(k.buyers)} paying customer(s)`))}
        </div>
        ${D.panel(L('الاتجاه خلال الفترة', 'Trend over the period'), `<div class="in-metrics" role="group">${METRICS.map(([id, a, b, c]) => `<button type="button" class="bx-chip" data-m="${id}" aria-pressed="${id === metric}"><i style="background:${c}"></i>${L(a, b)}</button>`).join('')}</div>${trend(S, metric, d.range.daily)}`, `<small class="bx-muted">${rl}</small>`)}
        <div class="tx-grid2">
          ${D.panel(L('مسار التحويل', 'Conversion funnel'), funnel(d.funnel))}
          ${D.panel(L('الإيرادات حسب المصدر', 'Revenue breakdown'), `<h4 class="in-h">${L('حسب النوع', 'By type')}</h4>${bars(d.revenue_by.purpose, (x) => tr(PURPOSE, x.k), (x) => x.v, money)}
            <h4 class="in-h">${L('حسب الباقة أو الدورة', 'By plan or course')}</h4>${bars(d.revenue_by.plan, (x) => esc(x.k), (x) => x.v, money)}
            <h4 class="in-h">${L('حسب وسيلة الدفع', 'By payment method')}</h4>${bars(d.revenue_by.gateway, (x) => esc(x.k), (x) => x.v, money)}
            <p class="bx-hint" style="margin:12px 0 0">${L('خصومات الكوبونات:', 'Coupon discounts:')} <b>${money(k.discounts)}</b> · ${L('رسوم بوابات الدفع:', 'Gateway fees:')} <b>${money(k.fees)}</b> · ${L('مبالغ مستردة:', 'Refunds:')} <b>${money(k.refunds)}</b></p>`)}
        </div>
        ${D.panel(L('أداء الدورات', 'Course performance'), coursesTable(d.courses || [], sortKey), `<small class="bx-muted">${L('اضغط على عنوان العمود للترتيب', 'Click a column to sort')}</small>`)}
        <div class="tx-grid2">
          ${D.panel(L('مصادر الزيارات', 'Traffic sources'), bars(d.sources, (x) => esc(src(x.k)), (x) => x.v, n, (x) => (N(x.users) ? ` <small title="${L('زوار مسجلون', 'signed-in visitors')}">👤${n(x.users)}</small>` : '')), `<small class="bx-muted">${L('بالجلسات', 'by sessions')}</small>`)}
          ${D.panel(L('الدول', 'Countries'), bars(d.countries, (x) => `${flag(x.k)} ${esc(country(x.k))}`) + `<h4 class="in-h">${L('دول الحسابات الجديدة', 'New accounts by country')}</h4>` + bars(d.signup_countries, (x) => `${flag(x.k)} ${esc(country(x.k))}`))}
          ${D.panel(L('الصفحات الأكثر زيارة', 'Top pages'), bars(d.pages, (x) => esc(page(x.k)), (x) => x.v, n, (x) => ` <small>${n(x.u)} ${L('زائر', 'visitors')}</small>`))}
          ${D.panel(L('الأجهزة وأوقات الزيارة', 'Devices & timing'), bars(d.devices, (x) => esc(tr(DEV, x.k))) + `<h4 class="in-h">${L('أيام الأسبوع', 'Weekdays')}</h4>` + bars(DAYS.map((x, i) => ({ k: i, v: N(((d.weekdays || []).find((w) => w.w === i) || {}).v) })).filter((x) => x.v), (x) => L(DAYS[x.k][0], DAYS[x.k][1]))
            + `<h4 class="in-h">${L('ساعات اليوم (القاهرة)', 'Hours of the day (Cairo)')}</h4>` + (() => { const hs = Array.from({ length: 24 }, (_, h) => N(((d.hours || []).find((x) => x.h === h) || {}).v)), hm = Math.max(...hs, 1); return `<div class="tx-hours">${hs.map((v, h) => `<div title="${h}:00 — ${n(v)}"><i style="height:${Math.max(3, (v / hm) * 100)}%"></i><small>${h % 3 === 0 ? h : ''}</small></div>`).join('')}</div>`; })())}
        </div>
        <div class="tx-grid2">
          ${D.panel(L('البريد والحملات', 'Email & campaigns'), `<div class="bx-stats in-mini">${D.stat(L('أُرسلت في الفترة', 'Sent in period'), n(k.emails_sent))}${D.stat(L('في الانتظار', 'Queued'), n(k.emails_queued))}${D.stat(L('فشلت', 'Failed'), n(k.emails_failed))}</div>
            <h4 class="in-h">${L('حملة إعادة تفعيل مستخدمي المنصة القديمة', 'Legacy users reactivation')}</h4>
            <div class="in-prog"><i style="width:${pct(N(r.total) - N(r.queued), r.total)}%"></i></div>
            <p class="bx-hint" style="margin:6px 0 0">${L(`${n(r.total)} مستخدم · أُرسل إلى ${n(N(r.total) - N(r.queued))} · فعّلوا حساباتهم ${n(r.activated)} (${p1(pct(r.activated, N(r.total) - N(r.queued)))}) · ألغوا الاشتراك ${n(r.unsubscribed)}`, `${n(r.total)} users · reached ${n(N(r.total) - N(r.queued))} · activated ${n(r.activated)} (${p1(pct(r.activated, N(r.total) - N(r.queued)))}) · unsubscribed ${n(r.unsubscribed)}`)}</p>
            ${(d.campaigns || []).length ? `<h4 class="in-h">${L('آخر حملات البريد', 'Latest campaigns')}</h4><ul class="tx-list">${d.campaigns.map((c) => `<li><span class="tx-name" dir="auto">${esc(c.name)}</span><span class="tx-num">${n(c.sent)} / ${n(c.total)}<small>${esc(tr(CST, c.status))}</small></span><i style="width:${pct(c.sent, c.total)}%"></i></li>`).join('')}</ul>` : ''}`)}
          ${D.panel(L('الدعم والطلبات', 'Support & requests'), `<div class="bx-stats in-mini">${D.stat(L('محادثات مفتوحة', 'Open conversations'), n(k.open_tickets))}${D.stat(L('بانتظار الرد', 'Awaiting reply'), n(sup.waiting))}${D.stat(L('أقدم انتظار', 'Oldest wait'), sup.oldest_wait_h == null ? '—' : n(sup.oldest_wait_h) + L(' ساعة', 'h'))}</div>
            <h4 class="in-h">${L('الطلبات الواردة في الفترة', 'Requests received in period')}</h4>${bars(sup.requests_by_type || [], (x) => esc(tr(REQ, x.k)) + (N(x.open) ? ` <small class="in-d down">${n(x.open)} ${L('مفتوح', 'open')}</small>` : ''))}`)}
        </div>
        <div class="tx-grid2">
          ${D.panel(L('النماذج والاختبارات', 'Forms & quizzes'), bars(d.forms || [], (x) => esc(x.k), (x) => x.v, n, (x) => (x.avg_score != null ? ` <small>${L('متوسط الدرجة', 'avg. score')} ${n(x.avg_score)}%</small>` : '')), `<small class="bx-muted">${n(k.form_subs)} ${L('رد', 'responses')}</small>`)}
          ${D.panel(L('الكوبونات والإحالات', 'Coupons & referrals'), bars(d.coupons || [], (x) => esc(x.k), (x) => x.n, n, (x) => ` <small>${L('خصم', 'discount')} ${money(x.discount)}</small>`) + `<p class="bx-hint" style="margin:12px 0 0">${L('إحالات مؤهلة:', 'Qualified referrals:')} <b>${n(d.referrals.qualified)}</b> · ${L('أشهر مجانية مُنحت:', 'Free months granted:')} <b>${n(d.referrals.grants)}</b></p>`)}
          ${D.panel(L('أرباح المحاضرين', 'Instructor earnings'), bars(d.instructors || [], (x) => esc(x.k), (x) => x.v, money, (x) => ` <small>${n(x.views)} ${L('مشاهدة', 'views')}</small>`))}
          ${D.panel(L('آخر النشاط', 'Latest activity'), feed(d.recent || []))}
        </div>`;
      $$('[data-r]', main).forEach((b) => (b.onclick = () => { range = pref.range = b.dataset.r; save(); draw(); }));
      $$('[data-m]', main).forEach((b) => (b.onclick = () => { metric = pref.metric = b.dataset.m; save(); render(); }));
      $$('[data-sort]', main).forEach((b) => (b.onclick = () => { sortKey = pref.sort = b.dataset.sort; save(); render(); }));
      $('[data-csv]', main).onclick = () => csv(d);
      // hover tooltip on the trend chart
      const wrap = $('.in-trend', main);
      if (wrap) {
        const tip = $('.in-tip', wrap), cross = $('.in-cross', wrap), m = METRICS.find((x) => x[0] === metric);
        $$('rect[data-i]', wrap).forEach((rc) => {
          rc.onmouseenter = () => {
            const s = S[+rc.dataset.i], cx = +rc.getAttribute('x') + +rc.getAttribute('width') / 2;
            cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.hidden = false;
            tip.innerHTML = `<b>${esc(s.d)}</b>${METRICS.map(([id, a, b, c]) => `<span${id === metric ? ' class="on"' : ''}><i style="background:${c}"></i>${L(a, b)}: ${id === 'revenue' ? money(s[id]) : n(s[id])}</span>`).join('')}`;
            tip.hidden = false; tip.style.insetInlineStart = Math.min(78, Math.max(2, (cx / 860) * 100)) + '%';
          };
        });
        wrap.onmouseleave = () => { tip.hidden = true; cross.hidden = true; };
        void m;
      }
    };
    await draw();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.body.contains(main) || !$('.in-kpis', main)) { clearInterval(timer); return; } if (!document.hidden) draw(true); }, 60000);
  };
})();
