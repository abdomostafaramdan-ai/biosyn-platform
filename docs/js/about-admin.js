/* Admin → «صفحة من نحن»: edits site_content.about (public text) — the page and its SEO copy update automatically. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.Dash;
  const waLink = window.waLink || ((num) => { let d = String(num || '').replace(/\D/g, ''); if (/^01\d{9}$/.test(d)) d = '2' + d; else if (/^1\d{9}$/.test(d)) d = '20' + d; return d ? 'https://wa.me/' + d : ''; });
  // defaults = what about.html ships with, so the form is never empty
  const DEF = {
    lead: 'Biosyn Eg منصة مصرية للتعليم العلمي والطبي والمعلوماتية الحيوية، تقدّم محتوى متخصصًا باللغة العربية للطلاب والباحثين وأعضاء هيئة التدريس في الجامعات.',
    story: 'انطلقت Biosyn Eg عام 2020 بفكرة بسيطة: أن يتمكن الطالب والباحث العربي من تعلّم العلوم الحيوية والطبية والمعلوماتية الحيوية بلغته، وبمحتوى عملي يربط النظرية بالمعمل وبسوق العمل.\n\nمنذ عام 2020 حتى اليوم قدّمنا خدماتنا التعليمية والبحثية لأكثر من 20 ألف طالب وباحث وعضو هيئة تدريس في الجامعات، في 7 دول، من خلال دورات مسجلة وبرامج تفاعلية واستشارات بحثية وبرامج تدريب للمؤسسات.',
    vision: 'أن تكون Biosyn المنصة العربية الأولى للتعليم العلمي والطبي، والمكان الذي يبدأ منه كل طالب وباحث عربي رحلته في العلوم الحيوية.',
    mission: 'إيصال المعرفة العلمية المتخصصة باللغة العربية بجودة عالية وبسعر في متناول الطلاب، وتزويد الطلاب والباحثين بالمهارات العملية المطلوبة في البحث العلمي والصناعة.',
    services: [
      { title: 'الدورات المسجلة', desc: 'مكتبة دورات في البيولوجيا الجزيئية والوراثة والمناعة والميكروبيولوجيا وغيرها، كلها باشتراك واحد ومتاحة للمشاهدة في أي وقت.' },
      { title: 'الدورات والدبلومات التفاعلية', desc: 'جلسات مباشرة مع محاضرين متخصصين، تتضمن تطبيقًا عمليًا ومشاريع ومتابعة.' },
      { title: 'الاستشارات والخدمات البحثية', desc: 'مساعدة في تصميم الأبحاث وتحليل البيانات والمعلوماتية الحيوية للطلاب والباحثين.' },
      { title: 'حلول المؤسسات', desc: 'برامج تدريب مخصصة للجامعات والمعامل والشركات والمؤسسات الطبية.' },
      { title: 'شهادات قابلة للتحقق', desc: 'تمنح كل دورة شهادة إتمام عليها رقم ورمز QR، ويمكن لأي جهة التحقق منها من موقعنا.' },
    ],
    founder_name: 'Abdo Mostafa', founder_title: 'مؤسس Biosyn Eg · B.Sc. in Science',
    founder_bio: 'أسّس Abdo Mostafa منصة Biosyn Eg عام 2020، وهو حاصل على بكالوريوس العلوم (B.Sc. in Science)، ويعمل على بناء المنصة وفريق المحاضرين ليصبح المحتوى العلمي المتخصص متاحًا باللغة العربية وبشكل عملي لكل طالب وباحث.',
    email: 'contact@biosynegypt.com', whatsapp: '01069151456',
    founded: 2020, base_students: 20000, base_countries: 7, known_countries: ['EG'],
  };

  window.aboutAdmin = async function (main) {
    const [row, st] = await Promise.all([sb.one('site_content', { select: 'data', key: 'eq.about' }).catch(() => null), sb.rpc('about_stats').catch(() => null)]);
    const A = Object.assign({}, DEF, (row && row.data) || {});
    const svc = (x) => `<div class="sx-faq ab-svcrow"><input class="bx-input" data-t maxlength="80" placeholder="اسم الخدمة" value="${esc(x.title || '')}"><textarea class="bx-input" data-d rows="2" maxlength="300" placeholder="وصف قصير">${esc(x.desc || '')}</textarea><button type="button" class="bx-linkbtn" data-rm>حذف</button></div>`;
    const f = (id, label, val, extra) => `<div class="bx-field"><label for="${id}">${label}</label><input id="${id}" class="bx-input" value="${esc(val ?? '')}" ${extra || ''}></div>`;
    const ta = (id, label, val, rows, hint) => `<div class="bx-field"><label for="${id}">${label}</label><textarea id="${id}" class="bx-input" rows="${rows || 3}">${esc(val || '')}</textarea>${hint ? `<small class="bx-hint">${hint}</small>` : ''}</div>`;
    main.innerHTML = `
      <p class="bx-hint" style="margin:0 0 14px">ما تكتبه هنا يظهر في صفحة <a class="bx-link" href="about.html" target="_blank">من نحن</a> فورًا، ويتحدّث لدى محركات البحث والذكاء الاصطناعي خلال 15 دقيقة.</p>
      <div class="bx-stats">${D.stat('الطلاب على الصفحة الآن', st ? '+' + Number(st.students).toLocaleString('en-US') : '—', 'الرقم الأساسي + كل حساب جديد')}${D.stat('الدول', st ? st.countries : '—', 'الأساسي + أي دولة جديدة')}${D.stat('سنوات', st ? st.years : '—', 'من سنة التأسيس')}</div>
      <form id="ab-form" class="bx-form2" novalidate>
      ${D.panel('النبذة', ta('a-lead', 'الجملة الأولى (تحت العنوان)', A.lead, 3) + ta('a-story', 'نبذة عن Biosyn', A.story, 6, 'اترك سطرًا فارغًا بين كل فقرة والتي تليها.'))}
      ${D.panel('رؤيتنا وهدفنا', ta('a-vision', 'رؤيتنا', A.vision, 3) + ta('a-mission', 'هدفنا', A.mission, 3))}
      ${D.panel('خدماتنا', `<div id="a-svcs">${(A.services || []).map(svc).join('')}</div><button type="button" class="bs-btn bs-btn-ghost bs-btn-sm" data-addsvc>+ خدمة جديدة</button>`)}
      ${D.panel('المؤسس', `<div class="row2">${f('a-fname', 'الاسم', A.founder_name)}${f('a-ftitle', 'الصفة', A.founder_title)}</div>${ta('a-fbio', 'نبذة عن المؤسس', A.founder_bio, 4)}
        <div class="bx-field"><label>الصورة</label><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><img src="${esc(A.founder_photo || 'img/founder-v2.webp')}" alt="" style="width:72px;height:90px;object-fit:cover;border-radius:10px"><input type="file" id="a-photo" accept="image/jpeg,image/png,image/webp" class="bx-input" style="max-width:320px"></div><small class="bx-hint">اختياري: ارفع صورة جديدة (JPG أو PNG، بحد أقصى 3 ميجابايت) إذا أردت تغيير الصورة الحالية.</small></div>`)}
      ${D.panel('التواصل', `<div class="row2">${f('a-email', 'البريد الإلكتروني', A.email, 'dir="ltr"')}${f('a-wa', 'رقم واتساب', A.whatsapp, 'dir="ltr"')}</div>`)}
      ${D.panel('الأرقام', `<div class="row2">${f('a-year', 'سنة التأسيس', A.founded, 'dir="ltr" inputmode="numeric"')}${f('a-bs', 'عدد الطلاب قبل المنصة', A.base_students, 'type="number" min="0"')}${f('a-bc', 'عدد الدول قبل المنصة', A.base_countries, 'type="number" min="1"')}</div>
        ${f('a-kc', 'رموز الدول المشمولة في هذا العدد (إن كنت تعرفها)', (A.known_countries || []).join(', '), 'dir="ltr" placeholder="EG, SA, AE"')}
        <small class="bx-hint">الطلاب = هذا الرقم + كل حساب جديد على المنصة. الدول = هذا الرقم + أي دولة جديدة غير موجودة في هذه القائمة، عندما يسجّل منها طالب أو يدخل منها 5 زوار مختلفين على الأقل. اكتب رموز الدول التي عملت فيها سابقًا (EG مصر، SA السعودية، AE الإمارات…) حتى لا تُحتسب مرتين.</small>`)}
      <div class="bx-formmsg" aria-live="polite"></div>
      <div class="bx-btnrow sx-save"><button class="bs-btn bs-btn-primary" type="submit">حفظ</button><a class="bs-btn bs-btn-ghost" href="about.html" target="_blank">عرض الصفحة</a></div>
      </form>`;
    const wire = () => $$('[data-rm]', main).forEach((b) => (b.onclick = () => b.closest('.ab-svcrow').remove()));
    wire();
    $('[data-addsvc]', main).onclick = () => { $('#a-svcs', main).insertAdjacentHTML('beforeend', svc({})); wire(); };

    $('#ab-form', main).onsubmit = async (ev) => {
      ev.preventDefault();
      const m = $('.bx-formmsg', main), v = (id) => $('#' + id, main).value.trim(), err = (t) => { m.className = 'bx-formmsg err'; m.textContent = t; };
      if (v('a-email') && !/^\S+@\S+\.\S+$/.test(v('a-email'))) return err('البريد الإلكتروني غير صحيح.');
      if (v('a-wa') && !waLink(v('a-wa'))) return err('رقم واتساب غير صحيح.');
      if (!/^(19|20)\d{2}$/.test(v('a-year'))) return err('يجب أن تكون سنة التأسيس بصيغة مثل 2020.');
      const codes = v('a-kc').toUpperCase().split(/[\s,،]+/).filter(Boolean);
      if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return err('يجب أن تتكون رموز الدول من حرفين إنجليزيين مثل EG, SA.');
      const btn = $('button[type=submit]', ev.target); btn.disabled = true; m.className = 'bx-formmsg'; m.textContent = 'جارٍ الحفظ…';
      try {
        let photo = A.founder_photo || '';
        const file = $('#a-photo', main).files[0];
        if (file) {
          if (file.size > 3 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type)) { btn.disabled = false; return err('يجب أن تكون الصورة JPG أو PNG أو WebP وأقل من 3 ميجابايت.'); }
          const path = `about/founder-${Date.now()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
          await sb.storage.upload('site-media', path, file);
          photo = `${BIOSYN.SUPABASE_URL}/storage/v1/object/public/site-media/${path}`;
        }
        const data = {
          lead: v('a-lead'), story: v('a-story'), vision: v('a-vision'), mission: v('a-mission'),
          services: $$('.ab-svcrow', main).map((r) => ({ title: $('[data-t]', r).value.trim(), desc: $('[data-d]', r).value.trim() })).filter((x) => x.title),
          founder_name: v('a-fname'), founder_title: v('a-ftitle'), founder_bio: v('a-fbio'), founder_photo: photo,
          email: v('a-email'), whatsapp: v('a-wa'), founded: Number(v('a-year')), base_students: Math.max(0, Number(v('a-bs')) || 0),
          base_countries: Math.max(1, Number(v('a-bc')) || 1), known_countries: codes.length ? codes : ['EG'],
        };
        const r = await sb.update('site_content', { key: 'eq.about' }, { data, updated_at: new Date().toISOString() });
        if (!r.length) await sb.insert('site_content', { key: 'about', data });
        await sb.rpc('seo_request_rebuild').catch(() => null);
        m.className = 'bx-formmsg ok'; m.textContent = 'تم الحفظ ✓ وتحدّثت الصفحة.';
      } catch (e) { m.className = 'bx-formmsg err'; m.textContent = arErr(e); }
      btn.disabled = false;
    };
  };
})();
