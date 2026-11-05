/* Admin → «السيو والظهور»: SEO / GEO / AEO status, content audit and settings.
   Settings live in seo_settings.data and are applied by scripts/seo/build.py (GitHub Action, every 15 minutes). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const SITE = 'https://biosyneg.com';
  const PAGES = [['index.html', 'الرئيسية'], ['courses.html', 'الكورسات المسجلة'], ['interactive.html', 'الكورسات التفاعلية'], ['pricing.html', 'الأسعار'], ['consultations.html', 'الاستشارات'],
    ['institutions.html', 'حلول المؤسسات'], ['instructors.html', 'المحاضرين'], ['teach.html', 'انضم كمحاضر'], ['blog.html', 'المدونة']];
  const AI = ['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot', 'deepseek'];
  const ago = (t) => { if (!t) return '—'; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'دلوقتي' : m < 60 ? `من ${m} دقيقة` : m < 1440 ? `من ${Math.round(m / 60)} ساعة` : `من ${Math.round(m / 1440)} يوم`; };
  const norm = (t) => (t || '').toLowerCase().replace(/[\W_]+/g, '');
  const chip = (t, k) => `<span class="sx-chip sx-${k}">${esc(t)}</span>`;

  // same rules as scripts/seo/build.py (indexable) + extra advice that doesn't block indexing
  function audit(c, all, S) {
    const mc = Number(S.min_chars) || 200, ml = Number(S.min_lectures) || 5;
    const text = (c.description || '').length + (c.summary || '').length, lec = (c.lectures || []).length;
    const body = norm(c.description || c.summary), block = [], warn = [];
    if (body && all.some((o) => o !== c && o.status === 'published' && (o.created_at || '') < (c.created_at || '') && norm(o.description || o.summary) === body)) block.push('الوصف منسوخ من كورس تاني');
    if (/^[a-z\s]{1,20}$/i.test((c.summary || '').trim()) && !c.description) block.push('الوصف نص تجريبي');
    const thin = c.kind === 'interactive' ? text < mc : text < mc && lec < ml;
    if (thin) block.push(`محتوى قليل: الوصف ${text} حرف` + (c.kind === 'recorded' ? ` و${lec} محاضرة` : ''));
    if (!c.description) warn.push('مفيش «عن الدورة»');
    if (!c.summary) warn.push('مفيش ملخص قصير');
    if (c.title.length < 12) warn.push('العنوان قصير');
    if (c.title.length > 70) warn.push('العنوان طويل');
    if (/bioinformtics|gentics|diplomaa/i.test(c.title)) warn.push('غلطة إملائية في العنوان');
    if (!c.faculty) warn.push('الكلية مش محددة');
    if (!c.specialty || c.specialty === 'كل التخصصات') warn.push('التخصص مش محدد');
    if (!(c.featured_instructor_ids || []).length && !c.featured_instructor_id) warn.push('مفيش محاضر ظاهر');
    if (c.kind === 'recorded' && lec && (c.lectures || []).some((l) => !l.duration_seconds)) warn.push('محاضرات من غير مدة');
    if (c.kind === 'interactive' && !c.ends_at) warn.push('مفيش تاريخ انتهاء');
    const score = Math.max(0, 100 - block.length * 40 - warn.length * 8);
    return { index: !block.length, block, warn, score };
  }

  window.seoDashboard = async function (main) {
    const [row, courses, status, traffic] = await Promise.all([
      sb.one('seo_settings', { select: '*', id: 'eq.1' }).catch(() => null),
      sb.get('courses', { select: 'id,slug,title,summary,description,kind,status,faculty,specialty,featured_instructor_id,featured_instructor_ids,ends_at,created_at,lectures(duration_seconds)', order: 'created_at' }).catch(() => []),
      fetch('seo-status.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      sb.rpc('admin_traffic', { p_from: new Date(Date.now() - 30 * 864e5).toISOString(), p_to: new Date().toISOString() }).catch(() => null),
    ]);
    const S = (row && row.data) || {};
    const pub = courses.filter((c) => c.status === 'published');
    const res = pub.map((c) => ({ c, a: audit(c, courses, S) }));
    const ok = res.filter((x) => x.a.index).length;
    const aiVisits = traffic ? (traffic.sources || []).filter((s) => AI.includes(s.k)).reduce((t, s) => t + Number(s.v), 0) : 0;
    const searchVisits = traffic ? (traffic.sources || []).filter((s) => ['google', 'bing', 'yahoo', 'duckduckgo'].includes(s.k)).reduce((t, s) => t + Number(s.v), 0) : 0;
    const pending = row && row.rebuild_requested_at && (!status || new Date(row.rebuild_requested_at) > new Date(status.built_at));
    const facs = (window.FACULTIES || []).map((f) => {
      const own = res.filter((x) => x.a.index && x.c.faculty === f.id).length, alls = res.filter((x) => x.a.index && x.c.faculty === 'all').length;
      const live = own >= 1 && own + alls >= 3;
      return { f, own, total: own + alls, live, need: live ? 0 : Math.max(1 - own, 3 - own - alls, 1) };
    });

    main.innerHTML = `
      <p class="bx-hint" style="margin:0 0 14px">جوجل (SEO) ومحركات الإجابة (AEO) والذكاء الاصطناعي زي ChatGPT وPerplexity (GEO). الصفحات بتتبني لوحدها كل 15 دقيقة لما يحصل أي تغيير.</p>
      <div class="bx-stats">
        ${D.stat('آخر تحديث للصفحات', status ? ago(status.built_at) : '—', pending ? '⏳ في تحديث مطلوب، خلال 15 دقيقة' : status ? n(status.sitemap_urls) + ' صفحة في الـ sitemap' : '')}
        ${D.stat('كورسات ظاهرة في البحث', `${ok} / ${pub.length}`, pub.length - ok ? `${pub.length - ok} مخفية لضعف المحتوى` : 'كلها مؤهلة')}
        ${D.stat('صفحات كليات ومحاضرين', `${status ? status.topics.length : 0} · ${status ? status.teachers.length : 0}`, 'كليات · محاضرين')}
        ${D.stat('زيارات من محركات البحث', n(searchVisits), 'آخر 30 يوم (جلسات)')}
        ${D.stat('زيارات من الذكاء الاصطناعي', n(aiVisits), 'ChatGPT · Perplexity · Gemini … آخر 30 يوم')}
      </div>
      <div class="sx-actions">
        <button type="button" class="bs-btn bs-btn-primary" data-rebuild>⟳ إعادة بناء الصفحات الآن</button>
        <a class="bs-btn bs-btn-secondary" target="_blank" rel="noopener" href="https://search.google.com/search-console?resource_id=sc-domain%3Abiosyneg.com">Search Console</a>
        <a class="bs-btn bs-btn-secondary" target="_blank" rel="noopener" href="https://analytics.google.com/analytics/web/#/p562437867/reports/intelligenthome">Google Analytics</a>
        <a class="bs-btn bs-btn-ghost" target="_blank" rel="noopener" href="https://www.bing.com/webmasters">Bing Webmaster</a>
        <a class="bs-btn bs-btn-ghost" target="_blank" rel="noopener" href="https://search.google.com/test/rich-results?url=${encodeURIComponent(SITE + '/')}">اختبار البيانات المنظمة</a>
        <a class="bs-btn bs-btn-ghost" target="_blank" rel="noopener" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(SITE + '/')}">سرعة الموقع</a>
      </div>
      <p class="bx-hint sx-files">الملفات: <a class="bx-link" href="sitemap.xml" target="_blank">sitemap.xml</a> · <a class="bx-link" href="robots.txt" target="_blank">robots.txt</a> · <a class="bx-link" href="llms.txt" target="_blank">llms.txt</a> · <a class="bx-link" href="llms-full.txt" target="_blank">llms-full.txt</a></p>

      ${D.panel('فحص محتوى الكورسات', res.length ? `<div class="sx-audit">${res.sort((x, y) => x.a.score - y.a.score).map(({ c, a }) => `
        <div class="sx-row"><div class="sx-score ${a.score >= 80 ? 'good' : a.score >= 50 ? 'mid' : 'bad'}">${a.score}</div>
          <div class="sx-body"><b dir="auto">${esc(c.title)}</b> ${a.index ? chip('ظاهر في البحث', 'ok') : chip('مخفي عن البحث', 'bad')} <small class="bx-muted">${c.kind === 'interactive' ? 'تفاعلي' : 'مسجل'}</small>
            <div>${a.block.map((t) => chip(t, 'bad')).join('')}${a.warn.map((t) => chip(t, 'warn')).join('')}${!a.block.length && !a.warn.length ? chip('ممتاز', 'ok') : ''}</div></div>
          <div class="sx-links"><a class="bx-link" target="_blank" href="course-${encodeURIComponent(c.slug)}.html">الصفحة</a> · <a class="bx-link" href="#courses">تعديل</a></div></div>`).join('')}</div>
        <p class="bx-hint">الكورس «المخفي» صفحته موجودة للزوار بس جوجل مش بيأرشفها (noindex) لحد ما محتواه يكمل، عشان الصفحات الضعيفة ماتضرّش ترتيب الموقع كله. اكتب وصف حقيقي ${Number(S.min_chars) || 200} حرف على الأقل.</p>` : '<p class="bx-hint">مفيش كورسات منشورة.</p>')}

      ${D.panel('صفحات الكليات (Programmatic SEO)', `<div class="sx-facs">${facs.map((x) => `<div class="sx-fac ${x.live ? 'on' : ''}"><b>${esc(x.f.name)}</b><span>${x.live ? `✓ صفحتها شغالة · ${x.total} كورس` : `${x.own} كورس خاص بيها · محتاجة ${x.need} كمان`}</span>${x.live ? `<a class="bx-link" target="_blank" href="topic-${x.f.id}.html">افتح</a>` : ''}</div>`).join('')}</div>
        <p class="bx-hint">صفحة الكلية بتتعمل تلقائي لما يبقى ليها كورس واحد على الأقل خاص بيها، و3 كورسات في المجموع (مع الكورسات المناسبة لكل الكليات).</p>`)}

      <form id="sx-form" class="bx-form2" novalidate>
      ${D.panel('بيانات المنصة (بتظهر لجوجل والذكاء الاصطناعي)', `
        <div class="bx-field"><label for="sx-desc">وصف Biosyn في جملتين</label><textarea id="sx-desc" class="bx-input" rows="3" maxlength="400" placeholder="منصة مصرية للتعليم العلمي والطبي بالعربي…">${esc(S.org_description || '')}</textarea><small class="bx-hint">ده الوصف اللي ChatGPT وجوجل بيستخدموه لما حد يسأل «إيه هي Biosyn؟». خليه حقائق مش دعاية.</small></div>
        <div class="bx-field"><label for="sx-same">حسابات السوشيال الرسمية (رابط في كل سطر)</label><textarea id="sx-same" class="bx-input" dir="ltr" rows="4" placeholder="https://www.facebook.com/...\nhttps://www.instagram.com/...\nhttps://www.linkedin.com/company/...">${esc((S.same_as || []).join('\n'))}</textarea><small class="bx-hint">بيربط حساباتك بالموقع عند جوجل (Knowledge Panel) وبيقوّي ثقة محركات الذكاء الاصطناعي.</small></div>
        <div class="row2"><div class="bx-field"><label for="sx-phone">رقم التواصل</label><input id="sx-phone" class="bx-input" dir="ltr" value="${esc(S.phone || '')}" placeholder="+20 10 0000 0000"></div>
          <div class="bx-field"><label for="sx-city">المدينة</label><input id="sx-city" class="bx-input" value="${esc(S.city || '')}" placeholder="Cairo"></div>
          <div class="bx-field"><label for="sx-year">سنة التأسيس</label><input id="sx-year" class="bx-input" dir="ltr" inputmode="numeric" maxlength="4" value="${esc(S.founded || '')}" placeholder="2024"></div></div>
        <div class="bx-field"><label for="sx-facts">حقائق إضافية للذكاء الاصطناعي (llms.txt) — حقيقة في كل سطر</label><textarea id="sx-facts" class="bx-input" rows="4" placeholder="عدد الطلاب أكتر من …\nشراكات مع …">${esc(S.facts || '')}</textarea><small class="bx-hint">اكتب أرقام وحقائق صحيحة بس. دي بتتقري من أدوات زي ChatGPT وPerplexity لما تتكلم عن المنصة.</small></div>`)}

      ${D.panel('أسئلة شائعة إضافية (AEO)', `<p class="bx-hint" style="margin-top:0">بتظهر في قسم الأسئلة الشائعة في الصفحة الرئيسية وبتتعلّم لجوجل كـ FAQ. اكتب السؤال زي ما الطالب بيكتبه في جوجل، والإجابة مباشرة في أول جملة.</p>
        <div id="sx-faq">${(S.faq && S.faq.length ? S.faq : [{ q: '', a: '' }]).map(faqRow).join('')}</div>
        <button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-addfaq>+ سؤال جديد</button>`)}

      ${D.panel('عناوين ووصف الصفحات في نتائج البحث', `<p class="bx-hint" style="margin-top:0">سيبها فاضية عشان يفضل العنوان الحالي. العنوان المثالي أقل من 60 حرف، والوصف أقل من 160.</p>
        <div class="sx-pages">${PAGES.map(([f, nm]) => { const o = (S.pages || {})[f] || {}; return `<div class="sx-page" data-page="${f}"><b>${esc(nm)}</b>
          <input class="bx-input" data-k="title" maxlength="90" placeholder="العنوان الحالي…" value="${esc(o.title || '')}"><small class="sx-cnt"></small>
          <textarea class="bx-input" data-k="description" rows="2" maxlength="220" placeholder="الوصف الحالي…">${esc(o.description || '')}</textarea><small class="sx-cnt"></small></div>`; }).join('')}</div>`)}

      ${D.panel('إعدادات متقدمة', `
        <label class="sx-switch"><input type="checkbox" id="sx-train" ${S.ai_training === false ? '' : 'checked'}> اسمح لروبوتات تدريب الذكاء الاصطناعي (GPTBot, ClaudeBot, Google-Extended…) تقرا الموقع</label>
        <small class="bx-hint" style="display:block;margin:4px 0 14px">لو قفلتها، ChatGPT وPerplexity لسه هيقدروا يدوروا في موقعك ويرشحوه (روبوتات البحث مسموحة دايمًا)، بس محتواك مش هيدخل في تدريب النماذج. للظهور الأقوى في الذكاء الاصطناعي سيبها مفتوحة.</small>
        <div class="row2"><div class="bx-field"><label for="sx-mc">أقل عدد حروف للوصف عشان الكورس يظهر في البحث</label><input id="sx-mc" class="bx-input" type="number" min="80" max="1000" value="${esc(S.min_chars || 200)}"></div>
          <div class="bx-field"><label for="sx-ml">أو أقل عدد محاضرات (للكورس المسجل)</label><input id="sx-ml" class="bx-input" type="number" min="1" max="50" value="${esc(S.min_lectures || 5)}"></div></div>
        <b style="display:block;margin:10px 0 6px">أكواد التحقق من الملكية</b>
        <div class="row2"><div class="bx-field"><label for="sx-v-bing">Bing (msvalidate.01)</label><input id="sx-v-bing" class="bx-input" dir="ltr" value="${esc((S.verify || {}).bing || '')}" placeholder="الكود بس من غير الـ meta"></div>
          <div class="bx-field"><label for="sx-v-yandex">Yandex</label><input id="sx-v-yandex" class="bx-input" dir="ltr" value="${esc((S.verify || {}).yandex || '')}"></div></div>
        <div class="row2"><div class="bx-field"><label for="sx-v-facebook">Facebook domain verification</label><input id="sx-v-facebook" class="bx-input" dir="ltr" value="${esc((S.verify || {}).facebook || '')}"></div>
          <div class="bx-field"><label for="sx-v-pinterest">Pinterest</label><input id="sx-v-pinterest" class="bx-input" dir="ltr" value="${esc((S.verify || {}).pinterest || '')}"></div></div>
        <small class="bx-hint">Google Search Console متأكد بالفعل عن طريق الـ DNS، مش محتاج كود هنا. كود Facebook مهم لإعلانات Meta.</small>`)}
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-btnrow sx-save"><button class="bs-btn bs-btn-primary" type="submit">حفظ وتحديث الصفحات</button></div>
      </form>`;

    function faqRow(x) {
      return `<div class="sx-faq"><input class="bx-input" data-q placeholder="السؤال (مثال: أفضل كورس بايوانفورماتكس بالعربي؟)" maxlength="160" value="${esc(x.q || '')}"><textarea class="bx-input" data-a rows="2" maxlength="600" placeholder="الإجابة المباشرة…">${esc(x.a || '')}</textarea><button type="button" class="bx-linkbtn" data-rmfaq aria-label="حذف السؤال">حذف</button></div>`;
    }
    const wireFaq = () => $$('[data-rmfaq]', main).forEach((b) => (b.onclick = () => { b.closest('.sx-faq').remove(); }));
    wireFaq();
    $('[data-addfaq]', main).onclick = () => { $('#sx-faq', main).insertAdjacentHTML('beforeend', faqRow({})); wireFaq(); };

    // live character counters + current titles as placeholders
    const count = (el) => { const max = el.dataset.k === 'title' ? 60 : 160, l = el.value.length, c = el.nextElementSibling; if (c) { c.textContent = l ? `${l} / ${max}` : ''; c.className = 'sx-cnt' + (l > max ? ' over' : ''); } };
    $$('.sx-page [data-k]', main).forEach((el) => { el.oninput = () => count(el); count(el); });
    PAGES.forEach(([f]) => fetch(f, { cache: 'no-store' }).then((r) => r.text()).then((h) => {
      const box = $(`.sx-page[data-page="${f}"]`, main); if (!box) return;
      const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1], d = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1];
      const tmp = document.createElement('textarea');
      if (t) { tmp.innerHTML = t; $('[data-k=title]', box).placeholder = tmp.value; }
      if (d) { tmp.innerHTML = d; $('[data-k=description]', box).placeholder = tmp.value; }
    }).catch(() => {}));

    $('[data-rebuild]', main).onclick = async (ev) => {
      ev.target.disabled = true;
      try { await sb.rpc('seo_request_rebuild'); ui.toast('اتسجل طلب التحديث. الصفحات هتتبني خلال 15 دقيقة.'); } catch (e) { ui.toast(arErr(e)); }
      ev.target.disabled = false;
    };

    $('#sx-form', main).onsubmit = async (ev) => {
      ev.preventDefault();
      const m = $('.bx-formmsg', main), v = (id) => $('#' + id, main).value.trim();
      const same = v('sx-same').split(/\s+/).filter(Boolean);
      const bad = same.find((u) => !/^https:\/\/[^\s]+\.[^\s]+/.test(u));
      if (bad) { m.className = 'bx-formmsg err'; m.textContent = 'الرابط ده مش صحيح: ' + bad + ' (لازم يبدأ بـ https://)'; return; }
      if (v('sx-year') && !/^\d{4}$/.test(v('sx-year'))) { m.className = 'bx-formmsg err'; m.textContent = 'سنة التأسيس لازم تكون 4 أرقام.'; return; }
      const pages = {};
      $$('.sx-page', main).forEach((b) => { const t = $('[data-k=title]', b).value.trim(), d = $('[data-k=description]', b).value.trim(); if (t || d) pages[b.dataset.page] = { title: t, description: d }; });
      const faq = $$('.sx-faq', main).map((r) => ({ q: $('[data-q]', r).value.trim(), a: $('[data-a]', r).value.trim() })).filter((x) => x.q && x.a);
      const data = {
        org_description: v('sx-desc'), same_as: same, phone: v('sx-phone'), city: v('sx-city'), founded: v('sx-year'), facts: v('sx-facts'), faq, pages,
        ai_training: $('#sx-train', main).checked, min_chars: Number(v('sx-mc')) || 200, min_lectures: Number(v('sx-ml')) || 5,
        verify: { bing: v('sx-v-bing'), yandex: v('sx-v-yandex'), facebook: v('sx-v-facebook'), pinterest: v('sx-v-pinterest') },
      };
      const btn = $('button[type=submit]', ev.target); btn.disabled = true; m.className = 'bx-formmsg'; m.textContent = 'جارٍ الحفظ…';
      try {
        await sb.update('seo_settings', { id: 'eq.1' }, { data });
        await sb.rpc('seo_request_rebuild');
        m.className = 'bx-formmsg ok'; m.textContent = 'اتحفظ ✓ الموقع هيتحدث خلال 15 دقيقة، وبعدها جوجل وBing بيتبلّغوا تلقائي.';
      } catch (e) { m.className = 'bx-formmsg err'; m.textContent = arErr(e); }
      btn.disabled = false;
    };
  };
})();
