#!/usr/bin/env python3
"""Biosyn Egypt — SEO / GEO / AEO + programmatic SEO build.

Reads public data from Supabase (same publishable key the browser uses) and writes into docs/:
  course-<slug>.html   one pre-rendered page per published course (the app hydrates it in the browser)
  topic-<faculty>.html one landing page per faculty that has enough real courses
  teacher-<id8>.html   one profile page per instructor with a bio and at least one course
  sitemap.xml, robots.txt, llms.txt, llms-full.txt
  a marked <!--seo--> block in the <head> of every static page (canonical, Open Graph, JSON-LD)

Quality gates keep thin pages out of the index (noindex + not in the sitemap) instead of publishing doorway pages.
Run:  python3 scripts/seo/build.py                 (live data)
      python3 scripts/seo/build.py --fixture f.json (offline test)
"""
import argparse, datetime, hashlib, html, json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://biosyneg.com'
BRAND = 'Biosyn Egypt'
TODAY = datetime.date.today().isoformat()
OG_IMAGE = SITE + '/img/og.png'
LOGO = SITE + '/img/biosyn-mark.png'
CONTACT = 'contact@biosynegypt.com'

LEVEL = {'beginner': 'مبتدئ', 'beginner_intermediate': 'مبتدئ ومتوسط', 'intermediate': 'متوسط', 'intermediate_advanced': 'متوسط ومتقدم', 'advanced': 'متقدم', 'all_levels': 'كل المستويات'}
LEVEL_EN = {'beginner': 'Beginner', 'beginner_intermediate': 'Beginner', 'intermediate': 'Intermediate', 'intermediate_advanced': 'Intermediate', 'advanced': 'Advanced', 'all_levels': 'Beginner'}

# public pages: (file, breadcrumb name, priority)
STATIC = [
    ('index.html', 'الرئيسية', '1.0'), ('courses.html', 'الدورات المسجلة', '0.9'), ('interactive.html', 'الدورات التفاعلية', '0.9'),
    ('pricing.html', 'الأسعار والاشتراكات', '0.9'), ('instructors.html', 'المحاضرون', '0.7'), ('consultations.html', 'الاستشارات والخدمات البحثية', '0.7'),
    ('institutions.html', 'حلول المؤسسات', '0.7'), ('teach.html', 'انضم كمحاضر', '0.6'), ('blog.html', 'المدونة', '0.6'), ('news.html', 'الأخبار والفعاليات', '0.6'),
    ('about.html', 'من نحن', '0.7'), ('verify.html', 'التحقق من الشهادات', '0.4'), ('terms.html', 'الشروط والأحكام', '0.2'), ('privacy.html', 'سياسة الخصوصية', '0.2'), ('refund.html', 'سياسة الاسترداد', '0.2'),
]
PRIVATE = ['login.html', 'account.html', 'admin.html', 'instructor.html', 'watch.html', 'certificate.html', 'form.html', 'course.html', 'article.html', '404.html', 'unsubscribe.html', 'contract.html']
AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot', 'meta-externalagent']

ABOUT = {}  # admin → «صفحة من نحن» (site_content.about)
S = {}   # admin → «السيو والظهور» settings (seo_settings.data)
e = lambda s: html.escape(str(s or ''), quote=True)
AR = re.compile(r'[؀-ۿ]')


# ---------------------------------------------------------------- data
def config():
    s = open(os.path.join(DOCS, 'js', 'config.js'), encoding='utf-8').read()
    url = re.search(r"SUPABASE_URL:\s*'([^']+)'", s).group(1)
    key = re.search(r"SUPABASE_KEY:\s*'([^']+)'", s).group(1)
    fac = subprocess.run(['node', '-e', "global.window={};global.document={documentElement:{style:{}}};global.top=global.self={};eval(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(JSON.stringify(window.FACULTIES||[]))", os.path.join(DOCS, 'js', 'config.js')], capture_output=True, text=True)
    return url, key, json.loads(fac.stdout or '[]')


def rest(url, key, path):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', headers={'apikey': key, 'Accept': 'application/json', 'User-Agent': 'biosyn-seo-build/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as x:
        sys.exit(f'Supabase {x.code} on {path}: {x.read().decode("utf-8", "replace")[:400]}')


def rpc(url, key, name, body=None):
    req = urllib.request.Request(f'{url}/rest/v1/rpc/{name}', data=json.dumps(body or {}).encode(), method='POST',
                                 headers={'apikey': key, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'biosyn-seo-build/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def load(fixture):
    url, key, facs = config()
    if fixture:
        d = json.load(open(fixture, encoding='utf-8'))
    else:
        d = {
            'courses': rest(url, key, 'courses?select=*,lectures(title,position,duration_seconds,is_preview)&status=eq.published&order=created_at'),
            'featured_instructors': rest(url, key, 'featured_instructors?select=id,name,title,photo_url,profile_id,visible,faculty'),
            'plans': rest(url, key, 'plans?select=code,name,price_egp,old_price_egp,intl_price,duration_months&active=eq.true&order=duration_months'),
            'posts': rest(url, key, 'posts?select=slug,title,excerpt,body,tag,published_at,updated_at&published=eq.true&order=published_at.desc'),
            'settings': (rest(url, key, 'seo_settings?select=data,rebuild_requested_at&id=eq.1') or [{}])[0],
            'fp': rpc(url, key, 'seo_fingerprint'),
            'about': ((rest(url, key, 'site_content?select=data&key=eq.about') or [{}])[0]).get('data') or {},
            'about_stats': rpc(url, key, 'about_stats'),
        }
    d['faculties'] = facs
    d.setdefault('posts', [])
    S.clear(); S.update(((d.get('settings') or {}).get('data')) or {})
    ABOUT.clear(); ABOUT.update(d.get('about') or {}); ABOUT['_stats'] = d.get('about_stats') or {}
    for c in d['courses']:
        c['lectures'] = sorted(c.get('lectures') or [], key=lambda l: l.get('position') or 0)
    return d


# ---------------------------------------------------------------- helpers
def clean_lecture(t):
    t = re.sub(r'[-_ ]*\d{8}_\d{6}[-_ ]*Meeting Recording', '', t or '', flags=re.I)
    t = re.sub(r'\.(mp4|mov|mkv)$', '', t, flags=re.I)
    return t.strip(' -_') or 'محاضرة'


def secs(c): return sum((l.get('duration_seconds') or 0) for l in c['lectures'])


def hours_ar(total):
    m = round(total / 60)
    if m < 60: return f'{m} دقيقة'
    h, r = divmod(m, 60)
    return f'{h} ساعة' + (f' و{r} دقيقة' if r else '')


def iso_duration(total):
    h, rem = divmod(int(total), 3600)
    return f'PT{h}H{rem // 60}M' if h else f'PT{max(1, rem // 60)}M'


def paras(t): return [p.strip() for p in re.split(r'\n+', t or '') if p.strip()]


def plain(t, n=158):
    t = re.sub(r'\s+', ' ', t or '').strip()
    return t if len(t) <= n else t[:n - 1].rsplit(' ', 1)[0] + '…'


def instructors_of(c, fi):
    by = {f['id']: f for f in fi}
    ids = c.get('featured_instructor_ids') or ([c['featured_instructor_id']] if c.get('featured_instructor_id') else [])
    out = [by[i] for i in ids if i in by]
    if not out and c.get('instructor_id'):
        out = [f for f in fi if f.get('profile_id') == c['instructor_id']][:1]
    return out


def fac_of(c, facs):
    return next((f for f in facs if f['id'] == c.get('faculty')), None)


def _norm(t): return re.sub(r'\W+', '', (t or '').lower())


def indexable(c, all_courses):
    """Enough real content to deserve a search result (and not a copy of another course)."""
    text = len((c.get('description') or '') + (c.get('summary') or ''))
    body = _norm(c.get('description') or c.get('summary'))
    if body and any(o is not c and o.get('created_at', '') < c.get('created_at', '') and _norm(o.get('description') or o.get('summary')) == body for o in all_courses):
        return False
    sm = (c.get('summary') or '').strip().lower()
    junk = bool(sm) and bool(re.fullmatch(r'[a-z\s]{1,20}', sm)) and not c.get('description')   # placeholder text like "dvcbvb"
    if junk: return False
    mc, ml = int(S.get('min_chars') or 200), int(S.get('min_lectures') or 5)
    if c['kind'] == 'interactive': return text >= mc
    return text >= mc or len(c['lectures']) >= ml


def why_not(c, all_courses):
    """Human-readable reasons a course page is kept out of the index (shown in the admin dashboard)."""
    if indexable(c, all_courses): return []
    r, text = [], len((c.get('description') or '') + (c.get('summary') or ''))
    mc, ml = int(S.get('min_chars') or 200), int(S.get('min_lectures') or 5)
    body = _norm(c.get('description') or c.get('summary'))
    if body and any(o is not c and o.get('created_at', '') < c.get('created_at', '') and _norm(o.get('description') or o.get('summary')) == body for o in all_courses):
        r.append('الوصف منسوخ من دورة أخرى')
    sm = (c.get('summary') or '').strip().lower()
    if sm and re.fullmatch(r'[a-z\s]{1,20}', sm) and not c.get('description'): r.append('الوصف نص تجريبي')
    if text < mc: r.append(f'الوصف أقل من {mc} حرفًا')
    if c['kind'] == 'recorded' and len(c['lectures']) < ml: r.append(f'أقل من {ml} محاضرات')
    return r or ['محتوى قليل']


def ld(obj): return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>'


ORG = {'@type': 'EducationalOrganization', '@id': SITE + '/#org', 'name': BRAND, 'alternateName': ['Biosyn Eg', 'بايوسين إيجيبت'], 'url': SITE + '/',
       'logo': {'@type': 'ImageObject', 'url': LOGO}, 'image': OG_IMAGE, 'email': CONTACT,
       'description': 'منصة مصرية للتعليم العلمي والطبي: دورات مسجلة وتفاعلية باللغة العربية في العلوم الحيوية والطب والمعلوماتية الحيوية، مع شهادات إتمام قابلة للتحقق.',
       'areaServed': [{'@type': 'Country', 'name': 'Egypt'}, 'MENA'], 'knowsLanguage': ['ar', 'en'],
       'contactPoint': {'@type': 'ContactPoint', 'contactType': 'customer support', 'email': CONTACT, 'availableLanguage': ['Arabic', 'English']}}
ORG_REF = {'@id': SITE + '/#org'}


def crumbs(items):
    return {'@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(items)]}


def faq_ld(qas):
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in qas]}


def head_block(url, title, desc, graph, robots=None, kind='website', image=None):
    img = image or OG_IMAGE; wh = ('1280', '720') if image else ('1200', '630')
    tags = [f'<link rel="canonical" href="{e(url)}">',
            f'<meta property="og:url" content="{e(url)}">', f'<meta property="og:type" content="{kind}">',
            f'<meta property="og:site_name" content="{BRAND}">', '<meta property="og:locale" content="ar_EG">',
            f'<meta property="og:image" content="{e(img)}">', f'<meta property="og:image:width" content="{wh[0]}"><meta property="og:image:height" content="{wh[1]}">',
            '<meta name="twitter:card" content="summary_large_image">', f'<meta name="twitter:title" content="{e(title)}">', f'<meta name="twitter:description" content="{e(desc)}">', f'<meta name="twitter:image" content="{e(img)}">']
    if robots: tags.append(f'<meta name="robots" content="{robots}">')
    if graph: tags.append(ld({'@context': 'https://schema.org', '@graph': graph}))
    return '<!--seo:start-->' + ''.join(tags) + '<!--seo:end-->'


SEO_RE = re.compile(r'<!--seo:start-->.*?<!--seo:end-->', re.S)


def put_head(doc, block, title=None, desc=None):
    doc = SEO_RE.sub('', doc)
    doc = re.sub(r'<meta property="og:(image|url|type|site_name|locale)"[^>]*>', '', doc)
    doc = re.sub(r'<meta name="(robots|twitter:[a-z]+)"[^>]*>', '', doc)
    doc = re.sub(r'<link rel="canonical"[^>]*>', '', doc)
    if title:
        doc = re.sub(r'<title>.*?</title>', f'<title>{e(title)}</title>', doc, count=1, flags=re.S)
        doc = re.sub(r'<meta property="og:title"[^>]*>', '', doc)
        block = block.replace('<!--seo:start-->', f'<!--seo:start--><meta property="og:title" content="{e(title)}">', 1)
    if desc is not None:
        doc = re.sub(r'<meta name="description"[^>]*>', '', doc)
        doc = re.sub(r'<meta property="og:description"[^>]*>', '', doc)
        block = block.replace('<!--seo:start-->', f'<!--seo:start--><meta name="description" content="{e(desc)}"><meta property="og:description" content="{e(desc)}">', 1)
    return doc.replace('</head>', block + '</head>', 1)


def details_faq(doc):
    out = []
    for m in re.finditer(r'<details[^>]*>\s*<summary[^>]*>(.*?)</summary>(.*?)</details>', doc, re.S):
        q = re.sub(r'<[^>]+>', ' ', m.group(1)); a = re.sub(r'<[^>]+>', ' ', m.group(2))
        q = re.sub(r'\s+', ' ', html.unescape(q)).strip(); a = re.sub(r'\s+', ' ', html.unescape(a)).strip()
        if q and a: out.append((q, a))
    return out


def meta(doc, name):
    m = re.search(rf'<meta name="{name}" content="([^"]*)"', doc)
    return html.unescape(m.group(1)) if m else ''


# ---------------------------------------------------------------- pages
def course_facts(c, plans):
    total = secs(c); n = len(c['lectures'])
    if c['kind'] == 'interactive':
        price = f"{int(float(c['price_egp'])):,} ج.م".replace(',', '٬') if c.get('price_egp') is not None else 'يُعلن قبل التسجيل'
        return total, n, price
    p = plans[0] if plans else None
    return total, n, (f"ضمن اشتراك Biosyn، يبدأ من {int(float(p['price_egp']))} ج.م شهريًا" if p else 'ضمن باقات الاشتراك')


def course_faq(c, plans, insts, fac):
    total, n, price = course_facts(c, plans)
    qa = []
    if c['kind'] == 'recorded':
        qa.append((f'كم سعر دورة {c["title"]}؟', f'الدورة متاحة ضمن اشتراك Biosyn Egypt الذي يتيح لك جميع الدورات المسجلة. الباقات: ' + '، '.join(f"{p['name']} بـ {int(float(p['price_egp']))} ج.م" for p in plans) + '. الاشتراك لا يتجدد تلقائيًا.'))
        if n: qa.append((f'ما مدة دورة {c["title"]}؟', f'تتضمن الدورة {n} محاضرة مسجلة' + (f' بإجمالي حوالي {hours_ar(total)}' if total else '') + '، ويمكنك مشاهدتها في أي وقت وبالسرعة التي تناسبك.'))
        qa.append(('هل تمنح الدورة شهادة؟', 'نعم. بعد إتمام جميع محاضرات الدورة تصدر لك شهادة إتمام من Biosyn Egypt تلقائيًا، عليها اسمك ورقم ورمز QR للتحقق من صحتها، ويمكنك تحميلها بصيغة PDF أو إضافتها إلى LinkedIn.'))
    else:
        qa.append((f'كم سعر {c["title"]}؟', f'رسوم البرنامج {price}، وهي منفصلة عن باقات الاشتراك. ويمكن استرداد الرسوم خلال 7 أيام من تاريخ الدفع.'))
        when = []
        if c.get('starts_at'): when.append('يبدأ يوم ' + c['starts_at'][:10])
        if c.get('ends_at'): when.append('وينتهي يوم ' + c['ends_at'][:10])
        if when: qa.append((f'متى يبدأ {c["title"]}؟', ' '.join(when) + '، والجلسات مباشرة عبر الإنترنت' + (f' وعدد المقاعد {c["seats"]} مقعد.' if c.get('seats') else '.')))
        qa.append(('هل يمنح البرنامج شهادة؟', 'نعم. تصدر شهادة الإتمام تلقائيًا في لوحة حسابك يوم انتهاء البرنامج، ويصلك إشعار وبريد إلكتروني بها، وعليها رقم ورمز QR للتحقق.'))
    qa.append(('ما لغة الدورة؟', 'الشرح باللغة العربية، مع الإبقاء على المصطلحات العلمية بالإنجليزية كما هي مستخدمة في المجال.'))
    who = f'طلاب وخريجي {fac["name"]}' if fac else 'طلاب وخريجي الكليات العلمية والطبية والباحثين'
    qa.append(('لمن تناسب هذه الدورة؟', f'تناسب {who}، ومستواها {LEVEL.get(c.get("level"), "مبتدئ")}.'))
    if insts:
        qa.append(('من يقدّم الدورة؟', '، '.join(f"{i['name']}" + (f" ({plain(i['title'], 120)})" if i.get('title') else '') for i in insts) + '.'))
    return qa


def course_page(tpl, c, d, related):
    plans, facs = d['plans'], d['faculties']
    insts = instructors_of(c, d['featured_instructors']); fac = fac_of(c, facs)
    url = f"{SITE}/course-{c['slug']}.html"
    total, n, price = course_facts(c, plans)
    rec = c['kind'] == 'recorded'
    kind_ar = 'دورة مسجلة' if rec else 'دورة تفاعلية مباشرة'
    title = f"{c['title']} | {kind_ar} بالعربية | {BRAND}"
    desc = plain(c.get('summary') or c.get('description') or (f"{kind_ar} في {c['title']} على {BRAND}: {n} محاضرة" + (f" ({hours_ar(total)})" if total else '') + ' باللغة العربية مع شهادة إتمام.'))
    faq = course_faq(c, plans, insts, fac)
    ok = indexable(c, d['courses'])
    # JSON-LD
    course = {'@type': 'Course', '@id': url + '#course', 'name': c['title'], 'description': plain(c.get('description') or c.get('summary') or desc, 500),
              'url': url, 'inLanguage': 'ar', 'provider': ORG_REF, 'educationalLevel': LEVEL_EN.get(c.get('level'), 'Beginner'),
              'isAccessibleForFree': False, 'image': c.get('cover_url') or OG_IMAGE,
              'educationalCredentialAwarded': 'Certificate of Completion (Biosyn Egypt)',
              'hasCourseInstance': [{'@type': 'CourseInstance', 'courseMode': 'Online' if rec else 'Synchronous', 'inLanguage': 'ar'}]}
    inst = course['hasCourseInstance'][0]
    if total: inst['courseWorkload'] = iso_duration(total)
    if c.get('hours') and not total: inst['courseWorkload'] = f"PT{int(float(c['hours']))}H"
    if not rec:
        inst['courseMode'] = 'Online'
        if c.get('starts_at'): inst['startDate'] = c['starts_at'][:10]
        if c.get('ends_at'): inst['endDate'] = c['ends_at'][:10]
        if c.get('seats'): inst['maximumAttendeeCapacity'] = c['seats']
    else:
        inst['courseSchedule'] = {'@type': 'Schedule', 'repeatFrequency': 'P1D', 'repeatCount': max(1, n)}
    if insts: inst['instructor'] = [{'@type': 'Person', 'name': i['name'], **({'description': plain(i['title'], 200)} if i.get('title') else {})} for i in insts]
    if c.get('specialty') and c['specialty'] != 'كل التخصصات': course['about'] = c['specialty']
    if n: course['syllabusSections'] = [{'@type': 'Syllabus', 'name': clean_lecture(l['title']), **({'timeRequired': iso_duration(l['duration_seconds'])} if l.get('duration_seconds') else {})} for l in c['lectures'][:40]]
    if rec and plans:
        course['offers'] = [{'@type': 'Offer', 'category': 'Subscription', 'name': p['name'], 'price': float(p['price_egp']), 'priceCurrency': 'EGP', 'availability': 'https://schema.org/InStock', 'url': SITE + '/pricing.html'} for p in plans]
    elif not rec and c.get('price_egp') is not None:
        course['offers'] = [{'@type': 'Offer', 'category': 'Paid', 'price': float(c['price_egp']), 'priceCurrency': 'EGP', 'availability': 'https://schema.org/InStock', 'url': url}]
    cat = ('الدورات المسجلة', SITE + '/courses.html') if rec else ('الدورات التفاعلية', SITE + '/interactive.html')
    graph = [ORG, course, crumbs([('الرئيسية', SITE + '/'), cat, (c['title'], url)]), faq_ld(faq)]
    doc = put_head(tpl, head_block(url, title, desc, graph, None if ok else 'noindex,follow', 'website', c.get('cover_url')), title, desc)
    doc = doc.replace('<body data-page="course">', f'<body data-page="course" data-slug="{e(c["slug"])}">', 1)
    # pre-rendered body (same facts the app shows after hydration)
    def li(i, l):
        dur = f'<span class="bs-curr-dur">{e(hours_ar(l["duration_seconds"]))}</span>' if l.get('duration_seconds') else ''
        return f'<li class="bs-curr-item"><span class="bs-curr-num bs-latin">{i + 1:02d}</span><span class="bs-play" aria-hidden="true"></span><span class="bs-curr-title bs-latin" dir="auto">{e(clean_lecture(l["title"]))}</span>{dur}</li>'
    lec = ''.join(li(i, l) for i, l in enumerate(c['lectures']))
    stats = (f'<span><b>{n}</b> محاضرة</span>' if n else '') + (f'<span><b>{e(hours_ar(total))}</b></span>' if total else '') + '<span>بالعربية</span>'
    if not rec and c.get('starts_at'): stats += f'<span>يبدأ {e(c["starts_at"][:10])}</span>'
    fac_badge = f'<span class="bs-badge">{e(fac["name"])}</span>' if fac else ''
    who = ''.join(f'<span class="bs-teacher-name">{e(i["name"])}</span>' for i in insts)
    body = (f'<section class="bs-course-hero"><span class="bs-wm" aria-hidden="true"></span><div class="bs-course-hero-in"><div>'
            f'<nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="{cat[1].rsplit("/", 1)[1]}">{e(cat[0])}</a><span>/</span><span class="bs-latin">{e(c["title"])}</span></nav>'
            f'<div style="display:flex;gap:8px;flex-wrap:wrap"><span class="bs-badge bs-badge-neutral">{e(LEVEL.get(c.get("level"), "مبتدئ"))}</span><span class="bs-badge bs-badge-info">{"دورة مسجلة" if rec else "دورة تفاعلية"}</span>{fac_badge}</div>'
            f'<h1 dir="auto">{e(c["title"])}</h1>' + (f'<p class="bs-lead">{e(c["summary"])}</p>' if c.get('summary') else '') +
            f'<div class="bs-stats">{stats}</div>' + (f'<div class="bx-teachers">{who}</div>' if who else '') + '</div><div class="bs-spacer"></div></div></section>'
            '<div class="bs-course-main"><div>' +
            (f'<section class="bs-block-sec" style="margin-top:48px"><h2>عن الدورة</h2>' + ''.join(f'<p>{e(p)}</p>' for p in paras(c.get('description'))) + '</section>' if c.get('description') else '') +
            (f'<section class="bs-block-sec"><h2>محتوى الدورة</h2><div class="bs-curr"><div class="bs-curr-head"><b>محتوى الدورة</b><span>{n} محاضرة{" · " + e(hours_ar(total)) if total else ""}</span></div><ol class="bs-curr-list">{lec}</ol></div></section>' if n else '') +
            f'</div><aside class="bs-enroll"><div class="bs-enroll-body"><div class="bs-enroll-access"><b>{e(price)}</b></div>'
            f'<a class="bs-btn bs-btn-primary bs-btn-lg bs-block" href="{"pricing.html" if rec else "course-" + e(c["slug"]) + ".html"}">{"اشترك لمشاهدة الدورة" if rec else "سجّل الآن"}</a>'
            '<ul class="bs-checks bs-checks-sm"><li><span>شهادة إتمام قابلة للتحقق</span></li><li><span>بالعربية مع المصطلحات بالإنجليزي</span></li></ul></div></aside></div>')
    doc = re.sub(r'<div id="course-root">.*?</div>\s*</div>', lambda m: f'<div id="course-root">{body}</div>', doc, count=1, flags=re.S) if '<div id="course-root"><div class="bx-loading"' in doc else doc
    extra = '<section class="bs-section bx-seo-extra" id="seo-extra" aria-label="أسئلة شائعة"><div class="bs-section-head"><div><h2>أسئلة شائعة عن الدورة</h2></div></div><div class="bx-faq">' + \
        ''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in faq) + '</div>'
    if related:
        extra += '<h3 style="margin:28px 0 12px">دورات ذات صلة قد تهمك</h3><ul class="bx-seo-links">' + ''.join(f'<li><a href="course-{e(r["slug"])}.html" dir="auto">{e(r["title"])}</a></li>' for r in related) + '</ul>'
    arts = [p for p in d.get('posts') or [] if f"course-{c['slug']}.html" in (p.get('body') or '')]
    if arts:
        extra += '<h3 style="margin:28px 0 12px">مقالات عن الدورة</h3><ul class="bx-seo-links">' + ''.join(f'<li><a href="blog-{e(p["slug"])}.html">{e(p["title"])}</a></li>' for p in arts) + '</ul>'
    if fac and fac['id'] in TOPICS_OK:
        extra += f'<p style="margin-top:16px"><a class="bx-link" href="topic-{fac["id"]}.html">جميع دورات {e(fac["name"])} ←</a></p>'
    if insts:
        links = [f'<a class="bx-link" href="teacher-{i["id"][:8]}.html">{e(i["name"])}</a>' for i in insts if i['id'] in TEACHERS_OK]
        if links: extra += '<p>عن المحاضر: ' + ' · '.join(links) + '</p>'
    extra += '</section>'
    doc = doc.replace('<template id="plan-card">', extra + '<template id="plan-card">', 1)
    return url, doc, ok


TOPICS_OK, TEACHERS_OK = set(), set()


def shell(tpl, url, title, desc, graph, main, page='seo', robots=None):
    doc = put_head(tpl, head_block(url, title, desc, graph, robots), title, desc)
    doc = re.sub(r'<body data-page="[^"]*">', f'<body data-page="{page}">', doc, count=1)
    return re.sub(r'<main.*?</main>', lambda m: main, doc, count=1, flags=re.S)


def card(c, d):
    total, n, price = course_facts(c, d['plans'])
    meta_ = (f'<span>{n} محاضرة</span>' if n else '') + (f'<span>{e(hours_ar(total))}</span>' if total else '') + \
        (f'<span>{e(LEVEL.get(c.get("level"), ""))}</span>' if c['kind'] == 'recorded' else f'<span>{e(price)}</span>')
    return (f'<a class="bs-course" href="course-{e(c["slug"])}.html"><div class="bs-cover"><span aria-hidden="true" class="bs-wm bs-wm-brand"></span><span class="bs-cover-code">{e((c.get("cover_code") or c["title"][:2]).upper())}</span>{('<img class="bs-cover-img" src="' + e(c["cover_url"]) + '" alt="" loading="lazy">') if c.get("cover_url") else ''}</div>'
            f'<div class="bs-course-body"><span class="bs-course-kind">{"دورة مسجلة" if c["kind"] == "recorded" else "دورة تفاعلية"}</span><h3 class="bs-course-title" dir="auto">{e(c["title"])}</h3><div class="bs-course-meta">{meta_}</div></div></a>')


def topic_page(tpl, fac, cs, d):
    url = f'{SITE}/topic-{fac["id"]}.html'
    short = fac['name'].replace('كلية ', '')
    title = f'دورات وكورسات أونلاين لطلاب {fac["name"]} بالعربية | {BRAND}'
    total = sum(secs(c) for c in cs); nrec = sum(1 for c in cs if c['kind'] == 'recorded'); nint = len(cs) - nrec
    specs = sorted({c['specialty'] for c in cs if c.get('specialty') and c['specialty'] != 'كل التخصصات'})
    desc = plain(f'{len(cs)} دورة أونلاين باللغة العربية لطلاب وخريجي {fac["name"]}' + (f' في {"، ".join(specs[:4])}' if specs else '') + f' على {BRAND}، مع شهادات إتمام قابلة للتحقق.')
    p = d['plans'][0] if d['plans'] else None
    faq = [(f'ما أفضل الكورسات الأونلاين لطلاب {fac["name"]}؟', f'تضم {BRAND} {len(cs)} دورة مناسبة لطلاب {short}: ' + '، '.join(c['title'] for c in cs[:8]) + '.'),
           ('هل الدورات باللغة العربية؟', 'نعم، الشرح باللغة العربية والمصطلحات العلمية بالإنجليزية.'),
           ('هل توجد شهادة؟', 'نعم، تمنح كل دورة شهادة إتمام من Biosyn Egypt عليها رقم ورمز QR للتحقق.')]
    if p and nrec: faq.append(('كم سعر الاشتراك؟', f'جميع الدورات المسجلة متاحة باشتراك واحد يبدأ من {int(float(p["price_egp"]))} ج.م شهريًا، وللدورات التفاعلية رسوم منفصلة.'))
    graph = [ORG, {'@type': 'CollectionPage', '@id': url, 'name': title, 'description': desc, 'url': url, 'inLanguage': 'ar', 'isPartOf': {'@id': SITE + '/#website'},
                   'mainEntity': {'@type': 'ItemList', 'numberOfItems': len(cs), 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/course-{c["slug"]}.html', 'name': c['title']} for i, c in enumerate(cs)]}},
             crumbs([('الرئيسية', SITE + '/'), ('الدورات المسجلة', SITE + '/courses.html'), (fac['name'], url)]), faq_ld(faq)]
    main = (f'<main class="bx-wrap bx-topic" id="main" style="max-width:1180px"><nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="courses.html">الدورات</a><span>/</span><span>{e(fac["name"])}</span></nav>'
            f'<h1>دورات أونلاين لطلاب {e(fac["name"])}</h1>'
            f'<p class="bs-lead">تضم {BRAND} <b>{len(cs)}</b> دورة باللغة العربية مناسبة لطلاب وخريجي {e(fac["name"])}'
            + (f': {nrec} دورة مسجلة' if nrec else '') + (f' و{nint} برنامج تفاعلي مباشر' if nint else '') + (f'، بإجمالي محتوى حوالي {e(hours_ar(total))}' if total else '') + '. تمنح كل دورة شهادة إتمام قابلة للتحقق.</p>'
            + (f'<p>التخصصات: {e("، ".join(specs))}.</p>' if specs else '') +
            f'<div class="bs-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:24px">{"".join(card(c, d) for c in cs)}</div>'
            f'<section style="margin-top:40px"><h2>أسئلة شائعة</h2><div class="bx-faq">{"".join(f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in faq)}</div></section>'
            f'<p style="margin-top:24px"><a class="bs-btn bs-btn-primary" href="pricing.html">اطّلع على الباقات</a> <a class="bs-btn bs-btn-secondary" href="courses.html?f={e(fac["id"])}">تصفّح الدورات وصنّفها</a></p></main>')
    return url, shell(tpl, url, title, desc, graph, main)


def teacher_page(tpl, t, cs, d):
    url = f'{SITE}/teacher-{t["id"][:8]}.html'
    title = f'{t["name"]} | محاضر على {BRAND}'
    desc = plain(f'{t["name"]}: {t.get("title") or ""} — دوراته على {BRAND}: ' + '، '.join(c['title'] for c in cs))
    person = {'@type': 'Person', '@id': url + '#person', 'name': t['name'], 'url': url, 'description': plain(t.get('title'), 300), 'worksFor': ORG_REF}
    if t.get('photo_url'): person['image'] = t['photo_url']
    graph = [ORG, {'@type': 'ProfilePage', '@id': url, 'url': url, 'name': title, 'mainEntity': person, 'inLanguage': 'ar'},
             crumbs([('الرئيسية', SITE + '/'), ('المحاضرون', SITE + '/instructors.html'), (t['name'], url)])]
    main = (f'<main class="bx-wrap bx-topic" id="main" style="max-width:1180px"><nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="instructors.html">المحاضرون</a><span>/</span><span>{e(t["name"])}</span></nav>'
            f'<h1>{e(t["name"])}</h1>' + ''.join(f'<p class="bs-lead">{e(p)}</p>' for p in paras(t.get('title'))) +
            f'<h2 style="margin-top:32px">دورات {e(t["name"])} على {BRAND}</h2><div class="bs-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:24px">{"".join(card(c, d) for c in cs)}</div></main>')
    return url, shell(tpl, url, title, desc, graph, main)


# ---------------------------------------------------------------- blog
MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
INLINE = re.compile(r'\[([^\]]+)\]\((https://[^\s)]+|[\w./#?=&%-]+)\)|\*\*(.+?)\*\*')


def ar_date(iso):
    if not iso: return ''
    y, m, dd = iso[:10].split('-'); return f'{int(dd)} {MONTHS[int(m) - 1]} {y}'


def inline_md(t):
    out, i = '', 0
    for m in INLINE.finditer(t):
        out += e(t[i:m.start()])
        out += f'<a class="bx-link" href="{e(m.group(2))}">{e(m.group(1))}</a>' if m.group(1) else f'<b>{e(m.group(3))}</b>'
        i = m.end()
    return out + e(t[i:])


def md_html(t):
    """Same tiny markdown as pages.js: ## / ### headings, - lists, [text](url), **bold**, blank line = new paragraph."""
    html_, para, lst = '', [], []
    def flush():
        nonlocal html_, para, lst
        if para: html_ += '<p>' + '<br>'.join(inline_md(x) for x in para) + '</p>'; para = []
        if lst: html_ += '<ul>' + ''.join(f'<li>{inline_md(x)}</li>' for x in lst) + '</ul>'; lst = []
    for line in (t or '').split('\n'):
        l = line.strip()
        if re.match(r'^[-•] ', l):
            if para: html_ += '<p>' + '<br>'.join(inline_md(x) for x in para) + '</p>'; para = []
            lst.append(l[2:]); continue
        if lst: flush()
        if not l: flush()
        elif l.startswith('### '): flush(); html_ += f'<h3>{inline_md(l[4:])}</h3>'
        elif l.startswith('## '): flush(); html_ += f'<h2>{inline_md(l[3:])}</h2>'
        else: para.append(l)
    flush(); return html_


def post_faq(body):
    """Q&A pairs written as «س: …» then «ج: …» lines (any section) → FAQPage schema."""
    out, q = [], None
    for line in (body or '').split('\n'):
        l = line.strip()
        if l.startswith('س:'): q = l[2:].strip()
        elif l.startswith('ج:') and q: out.append((q, re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', l[2:].strip()).replace('**', ''))); q = None
    return out


def post_course(p, courses):
    return next((c for c in courses if f"course-{c['slug']}.html" in (p.get('body') or '')), None)


def post_page(tpl, p, d):
    url = f"{SITE}/blog-{p['slug']}.html"
    c = post_course(p, d['courses'])
    img = (c or {}).get('cover_url')
    title = f"{p['title']} | مدونة {BRAND}"
    desc = plain(p.get('excerpt') or p.get('body'))
    faq = post_faq(p.get('body'))
    words = len(re.findall(r'\w+', p.get('body') or ''))
    art = {'@type': 'BlogPosting', '@id': url + '#article', 'headline': p['title'][:110], 'description': desc, 'url': url, 'mainEntityOfPage': url,
           'inLanguage': 'ar', 'author': ORG_REF, 'publisher': ORG_REF, 'image': img or OG_IMAGE, 'wordCount': words,
           'datePublished': (p.get('published_at') or TODAY)[:10], 'dateModified': (p.get('updated_at') or p.get('published_at') or TODAY)[:10]}
    if p.get('tag'): art['articleSection'] = p['tag']
    if c: art['about'] = {'@id': f"{SITE}/course-{c['slug']}.html#course"}; art['mentions'] = {'@type': 'Course', 'name': c['title'], 'url': f"{SITE}/course-{c['slug']}.html", 'provider': ORG_REF}
    graph = [ORG, art, crumbs([('الرئيسية', SITE + '/'), ('المدونة', SITE + '/blog.html'), (p['title'], url)])]
    if faq: graph.append(faq_ld(faq))
    doc = put_head(tpl, head_block(url, title, desc, graph, None, 'article', img), title, desc)
    doc = doc.replace('<body data-page="article">', f'<body data-page="article" data-slug="{e(p["slug"])}">', 1)
    cta = (f'<div class="bx-banner" style="display:block;margin-top:40px"><b>ابدأ دورة {e(c["title"])}</b><p style="margin:6px 0 12px">{e(c.get("summary") or "")}</p><a class="bs-btn bs-btn-primary" href="course-{e(c["slug"])}.html">تفاصيل الدورة ومحتواها</a></div>' if c else
           '<div class="bx-banner" style="display:block;margin-top:40px"><b>تعلّم أكثر مع Biosyn</b><p style="margin:6px 0 0">دورات مسجلة في العلوم الحيوية والطبية باشتراك واحد. <a class="bx-link" href="courses.html">تصفح الدورات</a></p></div>')
    body = (f'<nav class="bs-crumbs" aria-label="مسار التنقل"><a href="index.html">الرئيسية</a><span>/</span><a href="blog.html">المدونة</a></nav>'
            f'<small class="bx-hint">{e(p.get("tag") or "مقال")} · <time datetime="{e((p.get("published_at") or "")[:10])}">{e(ar_date(p.get("published_at")))}</time></small><h1>{e(p["title"])}</h1>'
            + (f'<p class="bs-lead" style="color:var(--ink-muted)">{e(p["excerpt"])}</p>' if p.get('excerpt') else '')
            + (f'<img class="bx-art-hero" src="{e(img)}" alt="{e(c["title"])}" width="1280" height="720">' if img else '')
            + f'<div class="bx-prose" style="margin-top:32px">{md_html(p.get("body"))}</div>{cta}')
    doc = re.sub(r'<article id="art">.*?</article>', lambda m: f'<article id="art">{body}</article>', doc, count=1, flags=re.S)
    return url, doc


def post_card(p):
    return (f'<a class="bx-post" href="blog-{e(p["slug"])}.html"><small class="bx-hint">{e(p.get("tag") or "مقال")} · {e(ar_date(p.get("published_at")))}</small>'
            f'<h2>{e(p["title"])}</h2>' + (f'<p>{e(p["excerpt"])}</p>' if p.get('excerpt') else '') + '</a>')


def llms(d, courses, topics, teachers):
    plans = d['plans']
    L = [f'# {BRAND}', '', '> منصة مصرية للتعليم العلمي والطبي باللغة العربية (biosyneg.com): دورات مسجلة باشتراك واحد، وبرامج تفاعلية مباشرة، واستشارات وخدمات بحثية، وشهادات إتمام قابلة للتحقق. Egyptian EdTech platform for life-science, medical and bioinformatics education in Arabic.', '',
         '## Key facts', f'- Website: {SITE}', f'- Contact: {CONTACT}', '- Language: Arabic explanations, scientific terms kept in English',
         '- Audience: students, graduates and researchers of science, biotechnology, pharmacy, medicine, dentistry, veterinary, agriculture and applied health sciences faculties in Egypt and the Arab region',
         '- Recorded courses: all included in one subscription; the subscription does not renew automatically',
         '- Interactive courses: live online sessions with separate fees; refundable within 7 days of payment',
         '- Certificates: every completed course issues a Biosyn Egypt certificate of completion with an ID and QR code, verifiable at ' + SITE + '/verify.html',
         '- Payment in Egypt: cards, mobile wallets (e.g. Vodafone Cash), Fawry, InstaPay; international payments available']
    if (S.get('org_description') or '').strip(): L.insert(2, '> ' + S['org_description'].strip().replace('\n', ' '))
    st = ABOUT.get('_stats') or {}
    L += [f"- Founded: {ABOUT.get('founded') or 2020}, by {(ABOUT.get('founder_name') or 'Abdo Mostafa').strip()} (B.Sc. in Science)"]
    if st.get('students'): L += [f"- Served: more than {int(st['students']):,} students, researchers and university staff in {int(st.get('countries') or 7)} countries"]
    L += [f'- About page: {SITE}/about.html']
    facts = [x.strip(' -•') for x in (S.get('facts') or '').splitlines() if x.strip()]
    if facts: L += [''] + ['- ' + x for x in facts]
    links = [u for u in (S.get('same_as') or []) if (u or '').startswith('https://')]
    if links: L += ['- Official profiles: ' + ', '.join(links)]
    if plans:
        L += ['', '## Subscription prices (EGP)'] + [f"- {p['name']}: {int(float(p['price_egp']))} EGP" + (f" (international: {float(p['intl_price']):g} in local currency)" if p.get('intl_price') else '') for p in plans] + [f'- Details: {SITE}/pricing.html']
    L += ['', '## Courses']
    for c in courses:
        total, n, price = course_facts(c, plans)
        L.append(f"- [{c['title']}]({SITE}/course-{c['slug']}.html): {'recorded course' if c['kind'] == 'recorded' else 'live interactive course'}" + (f', {n} lectures' if n else '') + (f', ~{round(total / 3600, 1)} hours' if total >= 360 else '') + (f", {c['specialty']}" if c.get('specialty') and c['specialty'] != 'كل التخصصات' else '') + (f" — {plain(c.get('summary'), 180)}" if c.get('summary') else ''))
    if topics: L += ['', '## Courses by faculty'] + [f'- [{f["name"]}]({SITE}/topic-{f["id"]}.html)' for f in topics]
    if teachers: L += ['', '## Instructors'] + [f'- [{t["name"]}]({SITE}/teacher-{t["id"][:8]}.html): {plain(t.get("title"), 160)}' for t in teachers]
    if d.get('posts'): L += ['', '## Articles'] + [f"- [{p['title']}]({SITE}/blog-{p['slug']}.html)" + (f": {plain(p.get('excerpt'), 160)}" if p.get('excerpt') else '') for p in d['posts']]
    L += ['', '## Main pages'] + [f'- [{n}]({SITE}/{"" if f == "index.html" else f})' for f, n, _ in STATIC]
    L += ['', '## Optional', f'- [Full content for LLMs]({SITE}/llms-full.txt)']
    return '\n'.join(L) + '\n'


def llms_full(d, courses):
    out = [llms(d, courses, [], []).split('## Courses')[0].rstrip(), '', '## Course details', '']
    for c in courses:
        insts = instructors_of(c, d['featured_instructors']); total, n, price = course_facts(c, d['plans'])
        out += [f"### {c['title']}", f"URL: {SITE}/course-{c['slug']}.html", f"Type: {'Recorded (subscription)' if c['kind'] == 'recorded' else 'Live interactive'} · Level: {LEVEL_EN.get(c.get('level'), 'Beginner')} · Price: {price}"]
        if c.get('starts_at'): out.append(f"Starts: {c['starts_at'][:10]}" + (f" · Ends: {c['ends_at'][:10]}" if c.get('ends_at') else ''))
        if insts: out.append('Instructors: ' + '; '.join(i['name'] + (f" — {plain(i['title'], 160)}" if i.get('title') else '') for i in insts))
        if c.get('description') or c.get('summary'): out += ['', (c.get('description') or c.get('summary')).strip()]
        if n: out += ['', 'Lectures:'] + [f'{i + 1}. {clean_lecture(l["title"])}' for i, l in enumerate(c['lectures'])]
        out.append('')
    faqs = []
    for f in ('index.html', 'pricing.html'):
        faqs += details_faq(open(os.path.join(DOCS, f), encoding='utf-8').read())
    if faqs: out += ['## FAQ', ''] + [f'Q: {q}\nA: {a}\n' for q, a in dict(faqs).items()]
    return '\n'.join(out) + '\n'


TRAINING_BOTS = {'GPTBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'ClaudeBot'}


def robots():
    lines = ['# Biosyn Egypt — search and AI crawlers are welcome on public pages', 'User-agent: *'] + [f'Disallow: /{p}' for p in ['account.html', 'admin.html', 'instructor.html', 'watch.html', 'login.html', 'form.html', 'certificate.html', 'unsubscribe.html', 'contract.html']] + ['Allow: /', '']
    block = S.get('ai_training') is False   # admin choice: keep AI *search* bots, refuse model-training crawlers
    for b in AI_BOTS:
        lines += [f'User-agent: {b}'] + (['Disallow: /'] if block and b in TRAINING_BOTS else ['Allow: /', 'Disallow: /account.html', 'Disallow: /admin.html', 'Disallow: /watch.html']) + ['']
    lines += [f'Sitemap: {SITE}/sitemap.xml', '']
    return '\n'.join(lines)


# ---------------------------------------------------------------- main
def write(path, text, changed, manifest, url=None):
    full = os.path.join(DOCS, path)
    old = open(full, encoding='utf-8').read() if os.path.exists(full) else None
    if old != text:
        open(full, 'w', encoding='utf-8').write(text)
    if url:
        h = hashlib.sha1(re.sub(r'\s+', ' ', text).encode()).hexdigest()[:16]
        prev = manifest.get(url)
        if not prev or prev['h'] != h:
            manifest[url] = {'h': h, 'lastmod': TODAY}; changed.append(url)


def apply_org():
    """Organization facts from the dashboard go into every page's JSON-LD and llms.txt."""
    if (S.get('org_description') or '').strip(): ORG['description'] = S['org_description'].strip()
    links = [u.strip() for u in (S.get('same_as') or []) if re.match(r'^https://', (u or '').strip())]
    if links: ORG['sameAs'] = links
    if (S.get('phone') or '').strip():
        ORG['telephone'] = S['phone'].strip(); ORG['contactPoint']['telephone'] = S['phone'].strip()
    if (S.get('city') or '').strip(): ORG['address'] = {'@type': 'PostalAddress', 'addressLocality': S['city'].strip(), 'addressCountry': 'EG'}
    if re.match(r'^\d{4}$', str(S.get('founded') or '')): ORG['foundingDate'] = str(S['founded'])
    ORG['foundingDate'] = str(ABOUT.get('founded') or ORG.get('foundingDate') or 2020)
    ORG['founder'] = {'@type': 'Person', 'name': (ABOUT.get('founder_name') or 'Abdo Mostafa').strip(), 'jobTitle': 'Founder',
                      'image': SITE + '/img/founder-v2.jpg', 'url': SITE + '/about.html#founder'}


FAQ_RE = re.compile(r'<!--seo-faq:start-->.*?<!--seo-faq:end-->', re.S)
PLUS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>'


def inject_faq(doc):
    """Extra Q&A written in the dashboard: shown in the home page FAQ (visible text + FAQPage schema), and in llms-full.txt."""
    doc = FAQ_RE.sub('', doc)
    items = [(q.get('q', '').strip(), q.get('a', '').strip()) for q in (S.get('faq') or []) if q.get('q', '').strip() and q.get('a', '').strip()]
    if not items: return doc
    block = '<!--seo-faq:start-->' + ''.join(f'\n    <details>\n      <summary>{e(q)}{PLUS}</summary>\n      <p>{e(a)}</p>\n    </details>' for q, a in items) + '<!--seo-faq:end-->'
    m = re.search(r'(<section class="bs-section" id="faq">.*?)(\s*</div></section>)', doc, re.S)
    return doc[:m.end(1)] + block + doc[m.end(1):] if m else doc


def render_about(doc):
    """Put the dashboard's «من نحن» text into the static page, so search engines and AI read the current version."""
    A = ABOUT
    def put(key, inner):
        nonlocal doc
        doc = re.sub(r'(<(\w+)[^>]*\sdata-ab="' + key + r'"[^>]*>)(.*?)(</\2>)', lambda m: m.group(1) + inner + m.group(4), doc, count=1, flags=re.S)
    paras = lambda t: ''.join(f'<p>{e(x.strip())}</p>' for x in re.split(r'\n+', t) if x.strip())
    for k in ('lead', 'vision', 'mission', 'founder_name', 'founder_title', 'email', 'whatsapp'):
        if (A.get(k) or '').strip(): put(k, e(A[k].strip()))
    for k in ('story', 'founder_bio'):
        if (A.get(k) or '').strip(): put(k, paras(A[k]))
    sv = [x for x in (A.get('services') or []) if (x or {}).get('title')]
    if sv:
        html_ = ''.join(f'<article class="ab-svc"><span class="ab-num">{i + 1:02d}</span><h3>{e(x["title"])}</h3>' + (f'<p>{e(x.get("desc"))}</p>' if x.get('desc') else '') + '</article>' for i, x in enumerate(sv))
        doc = re.sub(r'(<div class="ab-services" data-ab-list="services">).*?(</div>\s*</section>)', lambda m: m.group(1) + html_ + m.group(2), doc, count=1, flags=re.S)
    st = A.get('_stats') or {}
    for k in ('students', 'countries', 'years', 'courses'):
        if st.get(k) is not None:
            v = int(st[k]); txt = ('+' if k == 'students' else '') + f'{v:,}'
            doc = re.sub(r'(<b data-count="' + k + r'" data-base=")\d+(">)[^<]*(</b>)', lambda m: m.group(1) + str(v) + m.group(2) + txt + m.group(3), doc, count=1)
    return doc


def verify_tags():
    v, out = S.get('verify') or {}, ''
    for k, name in (('bing', 'msvalidate.01'), ('yandex', 'yandex-verification'), ('facebook', 'facebook-domain-verification'), ('pinterest', 'p:domain_verify'), ('google', 'google-site-verification')):
        val = re.sub(r'[^\w.-]', '', str(v.get(k) or ''))[:120]
        if val: out += f'<meta name="{name}" content="{val}">'
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--fixture'); ap.add_argument('--force', action='store_true'); a = ap.parse_args()
    d = load(a.fixture)
    # skip when neither the data (remote fingerprint) nor the page templates / this script changed
    spath = os.path.join(HERE, 'state.json')
    state = json.load(open(spath)) if os.path.exists(spath) else {}
    local = hashlib.sha1(b''.join(SEO_RE.sub('', open(os.path.join(DOCS, f), encoding='utf-8').read()).encode() for f, _, _ in STATIC + [('course.html', 0, 0), ('verify.html', 0, 0), ('article.html', 0, 0)]) + open(__file__, 'rb').read()).hexdigest()
    fp = f"{d.get('fp') or ''}:{local}"
    if not a.force and not a.fixture and state.get('fp') == fp:
        print('no changes since last build'); open(os.path.join(HERE, 'changed.txt'), 'w').write(''); return
    apply_org()
    mpath = os.path.join(HERE, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    changed, sitemap = [], []
    courses = d['courses']
    ok_courses = [c for c in courses if indexable(c, courses)]
    facs = d['faculties']
    # topic pages: a faculty needs its own courses (not only the "all faculties" ones) and 3+ courses in total
    topics = []
    for f in facs:
        own = [c for c in ok_courses if c.get('faculty') == f['id']]
        alls = [c for c in ok_courses if c.get('faculty') == 'all']
        if own and len(own) + len(alls) >= 3: topics.append((f, own + alls))
    TOPICS_OK.update(f['id'] for f, _ in topics)
    teachers = []
    for t in d['featured_instructors']:
        cs = [c for c in ok_courses if t in instructors_of(c, d['featured_instructors'])]
        if t.get('title') and len(t['title']) >= 30 and cs and t.get('visible', True): teachers.append((t, cs))
    TEACHERS_OK.update(t['id'] for t, _ in teachers)

    # 1) static pages: head block
    for f, name, prio in STATIC:
        p = os.path.join(DOCS, f); doc = open(p, encoding='utf-8').read()
        url = SITE + '/' + ('' if f == 'index.html' else f)
        graph = [ORG]
        if f == 'index.html':
            graph.append({'@type': 'WebSite', '@id': SITE + '/#website', 'url': SITE + '/', 'name': BRAND, 'inLanguage': 'ar', 'publisher': ORG_REF,
                          'potentialAction': {'@type': 'SearchAction', 'target': {'@type': 'EntryPoint', 'urlTemplate': SITE + '/courses.html?q={search_term_string}'}, 'query-input': 'required name=search_term_string'}})
        else:
            graph.append(crumbs([('الرئيسية', SITE + '/'), (name, url)]))
        if f == 'courses.html' and ok_courses:
            graph.append({'@type': 'ItemList', 'name': 'الدورات المسجلة', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/course-{c["slug"]}.html', 'name': c['title']} for i, c in enumerate([c for c in ok_courses if c['kind'] == 'recorded'])]})
        if f == 'interactive.html' and ok_courses:
            graph.append({'@type': 'ItemList', 'name': 'الدورات التفاعلية', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/course-{c["slug"]}.html', 'name': c['title']} for i, c in enumerate([c for c in ok_courses if c['kind'] == 'interactive'])]})
        if f == 'index.html': doc = inject_faq(doc)
        if f == 'blog.html' and d['posts']:
            graph.append({'@type': 'Blog', '@id': url + '#blog', 'name': 'مدونة ' + BRAND, 'url': url, 'inLanguage': 'ar', 'publisher': ORG_REF,
                          'blogPost': [{'@type': 'BlogPosting', 'headline': p['title'], 'url': f"{SITE}/blog-{p['slug']}.html", 'datePublished': (p.get('published_at') or TODAY)[:10]} for p in d['posts'][:30]]})
            doc = re.sub(r'(<div id="posts"[^>]*>).*?(</div></main>)', lambda m: m.group(1) + ''.join(post_card(p) for p in d['posts']) + m.group(2), doc, count=1, flags=re.S)
        if f == 'about.html':
            doc = render_about(doc)
            graph.append({'@type': 'AboutPage', '@id': url, 'url': url, 'name': 'من نحن | ' + BRAND, 'inLanguage': 'ar', 'about': ORG_REF, 'mainEntity': ORG_REF})
        qa = details_faq(doc)
        if qa: graph.append(faq_ld(qa))
        ov = (S.get('pages') or {}).get(f) or {}
        title = (ov.get('title') or '').strip() or html.unescape(re.search(r'<title>(.*?)</title>', doc, re.S).group(1))
        desc = (ov.get('description') or '').strip() or meta(doc, 'description')
        block = head_block(url, title, desc, graph)
        if f == 'index.html': block = block.replace('<!--seo:end-->', verify_tags() + '<!--seo:end-->')
        write(f, put_head(doc, block, title if ov.get('title') else None, desc if ov.get('description') else None), changed, manifest, url)
        sitemap.append((url, prio))
    for f in PRIVATE:
        p = os.path.join(DOCS, f)
        if os.path.exists(p): write(f, put_head(open(p, encoding='utf-8').read(), '<!--seo:start--><meta name="robots" content="noindex,follow"><!--seo:end-->'), changed, {})

    # 2) programmatic pages
    tpl_course = SEO_RE.sub('', open(os.path.join(DOCS, 'course.html'), encoding='utf-8').read())
    tpl_shell = SEO_RE.sub('', open(os.path.join(DOCS, 'verify.html'), encoding='utf-8').read())
    made = set()
    for c in courses:
        rel = [r for r in ok_courses if r is not c and (r.get('faculty') in (c.get('faculty'), 'all') or r.get('specialty') == c.get('specialty'))][:6]
        url, doc, ok = course_page(tpl_course, c, d, rel)
        fn = f"course-{c['slug']}.html"; made.add(fn)
        write(fn, doc, changed, manifest, url if ok else None)
        if ok: sitemap.append((url, '0.8'))
    for f, cs in topics:
        url, doc = topic_page(tpl_shell, f, cs, d); fn = f'topic-{f["id"]}.html'; made.add(fn)
        write(fn, doc, changed, manifest, url); sitemap.append((url, '0.7'))
    tpl_article = SEO_RE.sub('', open(os.path.join(DOCS, 'article.html'), encoding='utf-8').read())
    for p in d['posts']:
        url, doc = post_page(tpl_article, p, d); fn = f"blog-{p['slug']}.html"; made.add(fn)
        write(fn, doc, changed, manifest, url); sitemap.append((url, '0.6'))
    for t, cs in teachers:
        url, doc = teacher_page(tpl_shell, t, cs, d); fn = f'teacher-{t["id"][:8]}.html'; made.add(fn)
        write(fn, doc, changed, manifest, url); sitemap.append((url, '0.5'))
    # remove pages whose course/topic/instructor is gone
    for fn in os.listdir(DOCS):
        if re.match(r'(course|topic|teacher|blog)-.+\.html$', fn) and fn not in made:
            os.remove(os.path.join(DOCS, fn)); manifest.pop(f'{SITE}/{fn}', None); changed.append(f'{SITE}/{fn}')

    # 3) sitemap, robots, llms
    live = {u for u, _ in sitemap}
    for u in [u for u in manifest if u not in live]: manifest.pop(u)
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [f'  <url><loc>{u}</loc><lastmod>{manifest.get(u, {}).get("lastmod", TODAY)}</lastmod><priority>{p}</priority></url>' for u, p in sitemap]
    sm.append('</urlset>')
    write('sitemap.xml', '\n'.join(sm) + '\n', changed, {})
    write('robots.txt', robots(), changed, {})
    write('llms.txt', llms(d, ok_courses, [f for f, _ in topics], [t for t, _ in teachers]), changed, {})
    write('llms-full.txt', llms_full(d, ok_courses), changed, {})
    json.dump(manifest, open(mpath, 'w'), indent=1, sort_keys=True)
    status = {'built_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'sitemap_urls': len(sitemap),
              'indexable': [{'slug': c['slug'], 'title': c['title'], 'url': f"{SITE}/course-{c['slug']}.html"} for c in ok_courses],
              'noindex': [{'slug': c['slug'], 'title': c['title'], 'why': why_not(c, courses)} for c in courses if c not in ok_courses],
              'topics': [{'id': f['id'], 'name': f['name'], 'courses': len(cs)} for f, cs in topics],
              'teachers': [{'name': t['name'], 'url': f"{SITE}/teacher-{t['id'][:8]}.html"} for t, _ in teachers],
              'ai_training': S.get('ai_training') is not False, 'changed': len(set(changed))}
    write('seo-status.json', json.dumps(status, ensure_ascii=False, indent=1) + '\n', [], {})
    if not a.fixture: json.dump({'fp': fp, 'built_at': status['built_at']}, open(spath, 'w'))
    open(os.path.join(HERE, 'changed.txt'), 'w').write('\n'.join(sorted(set(changed))) + ('\n' if changed else ''))
    print(f'courses {len(courses)} (indexable {len(ok_courses)}) · topics {len(topics)} · teachers {len(teachers)} · sitemap {len(sitemap)} · changed {len(set(changed))}')
    skipped = [c['title'] for c in courses if c not in ok_courses]
    if skipped: print('noindex (thin content):', ', '.join(skipped))


if __name__ == '__main__':
    main()
