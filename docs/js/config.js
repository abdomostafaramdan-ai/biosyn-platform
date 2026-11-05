// Anti-clickjacking: the platform never runs inside another site's frame (GitHub Pages can't send frame-ancestors).
(function () { try { if (window.top !== window.self) { document.documentElement.style.display = 'none'; window.top.location = window.self.location.href; } } catch (e) { document.documentElement.style.display = 'none'; } })();
// Public values only (safe in the browser). Secrets live in Supabase Edge Function secrets.
window.BIOSYN = {
  SUPABASE_URL: 'https://qdlvvwwlsofcngedoaya.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xqiQvcj_a-ZrH-E5a6ozng_Pa137wO5',
  TRACKING: { META_PIXEL_ID: '', GA4_ID: '' }, // fill in to enable Meta Pixel / Google Analytics (leave empty to disable)
  SUPPORT_CHAT: false, // set true after adding the ANTHROPIC_API_KEY secret in Supabase
  GATEWAYS_FALLBACK: [], // payment methods now come from Admin → Integrations (keys saved there)
};

/* Faculties (الكليات) and their specialties — used by the home page, the course filters and the admin course form. */
window.FACULTIES = [
  { id: 'science', name: 'كلية العلوم', icon: '<circle cx="12" cy="12" r="1.2"/><path d="M20.2 20.2c2-2 0-7.4-4.5-11.9S5.8 1.8 3.8 3.8s0 7.4 4.5 11.9 9.9 6.5 11.9 4.5Z"/><path d="M15.7 15.7c4.5-4.5 6.5-9.9 4.5-11.9s-7.4 0-11.9 4.5-6.5 9.9-4.5 11.9 7.4 0 11.9-4.5Z"/>',
    specs: ['الأحياء الجزيئية', 'الوراثة', 'الكيمياء الحيوية', 'الأحياء الدقيقة', 'علم الحيوان', 'علم النبات', 'الكيمياء', 'الفيزياء الحيوية', 'مهارات البحث العلمي'] },
  { id: 'biotech', name: 'كلية بايوتكنولوجي', icon: '<path d="M7 2.5c0 4.5 10 5 10 9.5s-10 5-10 9.5"/><path d="M17 2.5c0 4.5-10 5-10 9.5s10 5 10 9.5"/><path d="M8 5h8M7.5 12h9M8 19h8"/>',
    specs: ['الهندسة الوراثية', 'المعلوماتية الحيوية', 'الأحياء التركيبية', 'التكنولوجيا الحيوية الطبية', 'التكنولوجيا الحيوية النباتية', 'التكنولوجيا الحيوية الصناعية', 'تقنيات النانو الحيوية'] },
  { id: 'pharmacy', name: 'كلية الصيدلة', icon: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    specs: ['علم الأدوية', 'الصيدلة الإكلينيكية', 'الكيمياء الصيدلية', 'الصيدلانيات', 'العقاقير', 'الميكروبيولوجيا الصيدلية'] },
  { id: 'agriculture', name: 'كلية الزراعة', icon: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8Z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2Z"/>',
    specs: ['علوم الأراضي والمياه', 'وقاية النبات', 'تربية النبات', 'الإنتاج الحيواني', 'علوم وتكنولوجيا الأغذية', 'الهندسة الزراعية'] },
  { id: 'medicine', name: 'كلية الطب', icon: '<path d="M11 2v2M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
    specs: ['التشريح', 'علم وظائف الأعضاء', 'الباثولوجي', 'المناعة', 'علوم الأعصاب', 'الطب التناسلي', 'البحث السريري', 'الأحياء الدقيقة الطبية'] },
  { id: 'veterinary', name: 'كلية الطب البيطري', icon: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    specs: ['التشريح البيطري', 'الطفيليات', 'الفيروسات البيطرية', 'الأمراض المعدية للحيوان', 'الأدوية البيطرية', 'الرقابة الصحية على الأغذية'] },
  { id: 'dentistry', name: 'كلية طب الأسنان', icon: '<path d="M7 3C4.8 3 3 4.8 3 7.2c0 2.3 1 3.6 1.6 5.6.6 2 .9 4.4 1.6 6.6.4 1.3 1.1 2.6 2.1 2.6 1.6 0 1.4-3.2 2-5 .3-.9.9-1.5 1.7-1.5s1.4.6 1.7 1.5c.6 1.8.4 5 2 5 1 0 1.7-1.3 2.1-2.6.7-2.2 1-4.6 1.6-6.6.6-2 1.6-3.3 1.6-5.6C21 4.8 19.2 3 17 3c-2 0-3 1-5 1S9 3 7 3Z"/>',
    specs: ['علم أمراض الفم', 'تقويم الأسنان', 'علاج الجذور', 'جراحة الفم والوجه والفكين', 'المواد السنية', 'طب أسنان الأطفال'] },
  { id: 'health_tech', name: 'كلية تكنولوجيا العلوم الصحية التطبيقية', icon: '<path d="M6 18h8M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
    specs: ['المختبرات الطبية', 'الأشعة والتصوير الطبي', 'العلاج التنفسي', 'تكنولوجيا الأجهزة الطبية', 'الإسعاف والطوارئ', 'البصريات'] },
];
window.FAC_ALL = { id: 'all', name: 'لكل الكليات', icon: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>', specs: [] };
window.facultyOf = (c) => c.faculty || ((window.FACULTIES.find((f) => f.specs.includes(c.specialty)) || {}).id) || '';
// phone country codes for the signup form (Egypt first, then the region, then the rest alphabetically)
window.COUNTRIES = [
  ['EG', 'مصر', '20'], ['SA', 'السعودية', '966'], ['AE', 'الإمارات', '971'], ['KW', 'الكويت', '965'], ['QA', 'قطر', '974'],
  ['BH', 'البحرين', '973'], ['OM', 'عُمان', '968'], ['JO', 'الأردن', '962'], ['LB', 'لبنان', '961'], ['PS', 'فلسطين', '970'],
  ['SY', 'سوريا', '963'], ['IQ', 'العراق', '964'], ['YE', 'اليمن', '967'], ['LY', 'ليبيا', '218'], ['SD', 'السودان', '249'],
  ['TN', 'تونس', '216'], ['DZ', 'الجزائر', '213'], ['MA', 'المغرب', '212'], ['MR', 'موريتانيا', '222'], ['SO', 'الصومال', '252'],
  ['TR', 'تركيا', '90'], ['GB', 'المملكة المتحدة', '44'], ['DE', 'ألمانيا', '49'], ['FR', 'فرنسا', '33'], ['IT', 'إيطاليا', '39'],
  ['NL', 'هولندا', '31'], ['SE', 'السويد', '46'], ['US', 'الولايات المتحدة', '1'], ['CA', 'كندا', '1'], ['AU', 'أستراليا', '61'],
  ['MY', 'ماليزيا', '60'], ['IN', 'الهند', '91'], ['PK', 'باكستان', '92'], ['NG', 'نيجيريا', '234'], ['KE', 'كينيا', '254'],
];
