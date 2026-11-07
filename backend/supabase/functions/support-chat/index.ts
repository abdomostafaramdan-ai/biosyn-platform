import { admin } from './_shared/db.ts';
import { cors, json } from './_shared/lib.ts';
import { loadSecrets, sec } from './_shared/secrets.ts';

// Public support assistant. POST { messages: [{role:'user'|'assistant', content}] } -> { reply }
// Needs the ANTHROPIC_API_KEY secret. Answers only from the platform facts below + live plans/catalog.
const MODEL = Deno.env.get('SUPPORT_MODEL') || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(Deno.env.get('SUPPORT_DAILY_LIMIT') || 40);

const POLICIES = `
- Biosyn Eg: منصة تعليم علمي وطبي (علوم حيوية، تعليم طبي، معلوماتية حيوية، برمجة).
- الدورات المسجلة متاحة ضمن باقات اشتراك تُدفع مرة واحدة وتفتح الوصول طوال مدة الباقة. الاشتراك لا يتجدد تلقائيًا. شراء باقة أثناء سريان أخرى يبدأ بعد انتهاء الحالية.
- الدورات التفاعلية (جلسات مباشرة) تُشترى منفصلة ومقاعدها محدودة.
- الاسترداد: الاشتراكات غير قابلة للاسترداد. الدورات التفاعلية قابلة للاسترداد خلال 7 أيام من تاريخ الدفع، من صفحة «حسابي ← الاشتراك والمدفوعات ← اطلب الاسترداد». الاستشارات والخدمات البحثية تُسترد قبل بدء العمل فقط.
- الدفع: بطاقات ومحافظ عبر Paymob وFawaterk وStripe، أو تحويل يدوي عبر إنستاباي/فودافون كاش ويتفعّل بعد مراجعة الفريق. رسوم بوابة الدفع تُضاف على المبلغ. يوجد كوبونات خصم.
- الشهادة: تصدر تلقائيًا عند إنهاء كل محاضرات الدورة، ويمكن التحقق منها برابط/QR.
- الحساب شخصي ويعمل على جهازين كحد أقصى. يمكن إزالة جهاز من «حسابي ← الإعدادات» مرة كل 7 أيام.
- برنامج الإحالة: لكل مشترك رابط دعوة، ويحصل على شهر مجاني عند أول اشتراك مدفوع لصديقه.
- محاضرات «معاينة مجانية» متاحة لأي مستخدم مسجّل دخوله.
- التقديم كمحاضر من صفحة «انضم كمحاضر». المحاضر يحصل على 30% من قيمة مشاهدات دوراته المسجلة، تُحسب شهريًا ويُسحب الرصيد كل 3 أشهر.
- المؤسسات: صفحة «حلول المؤسسات». الاستشارات البحثية: صفحة «الاستشارات».
- التواصل البشري: contact@biosynegypt.com
`;

async function catalog() {
  const sb = admin();
  const [plans, courses] = await Promise.all([
    sb.from('plans').select('name,duration_months,price_egp').eq('active', true).order('duration_months'),
    sb.from('courses').select('title,kind,price_egp,level').eq('status', 'published').limit(60),
  ]);
  const p = (plans.data ?? []).map((x) => `- ${x.name}: ${x.price_egp} ج.م لمدة ${x.duration_months} شهر`).join('\n');
  const c = (courses.data ?? []).map((x) => `- ${x.title} (${x.kind === 'interactive' ? `تفاعلية، ${x.price_egp} ج.م` : 'مسجلة ضمن الاشتراك'})`).join('\n');
  return `الباقات الحالية:\n${p || '- لا توجد'}\n\nالدورات المنشورة:\n${c || '- لا توجد حاليًا'}`;
}

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  await loadSecrets(admin());
  const key = sec('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'not configured' }, 503);
  const body = await req.json().catch(() => null);
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const clean = msgs.slice(-10)
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 1200) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') return json({ error: 'bad request' }, 400);
  while (clean.length && clean[0].role !== 'user') clean.shift();

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const { data: allowed } = await admin().rpc('chat_hit', { p_key: await sha(ip + (Deno.env.get('SUPABASE_URL') ?? '')), p_limit: DAILY_LIMIT });
  if (!allowed) return json({ reply: 'وصلت للحد اليومي للأسئلة. للمساعدة راسلنا على contact@biosynegypt.com' });

  const system = `أنت مساعد الدعم لمنصة Biosyn Eg. رد بالعربية المصرية البسيطة وباختصار (3-6 أسطر)، وبلغة الطالب لو كتب بالإنجليزية.
اعتمد فقط على المعلومات التالية. لو السؤال خارجها، أو يخص حساب أو دفعة بعينها، أو طلب استرداد، أو شكوى، قل إنك هتحوّله لفريق الدعم واطلب منه يراسل contact@biosynegypt.com مع بريد حسابه. لا تخترع أسعارًا أو مواعيد أو سياسات أو دورات. لا تطلب كلمات مرور أو بيانات بطاقات أبدًا. للأسئلة العلمية العامة يمكنك توجيهه لدورة مناسبة من القائمة إن وجدت.

${POLICIES}

${await catalog()}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages: clean }),
  });
  if (!r.ok) { console.error('anthropic', r.status, (await r.text()).slice(0, 300)); return json({ error: 'assistant unavailable' }, 502); }
  const d = await r.json();
  const reply = (d.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  return json({ reply: reply || 'عذرًا، لم أفهم السؤال. ممكن توضّح أكتر؟' });
});
