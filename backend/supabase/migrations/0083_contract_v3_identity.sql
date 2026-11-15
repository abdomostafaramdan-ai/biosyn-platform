-- Instructor agreement v3 (merged with the paper contract) + identity document at signing.
--  * contract_templates: v3 becomes the active instructor_recorded template ({{national_id}}, {{id_label}} placeholders)
--  * id-cards: private bucket; instructors upload into their own folder, only they and staff can read
--  * contracts: id type/number, front/back paths, the browser OCR result and a review status
--  * render_contract/sign_contract take the identity document; the number is validated server-side

-- 1) template
update public.contract_templates set active = false where kind = 'instructor_recorded' and active;
insert into public.contract_templates (kind, title, version, active, body)
select 'instructor_recorded', 'عقد نشر واستخدام مواد تدريبية مسجلة على منصة Biosyn Eg',
       coalesce((select max(version) from public.contract_templates where kind = 'instructor_recorded'), 0) + 1, true,
       $k3$
عقد اتفاق لنشر واستخدام مواد تدريبية مسجلة عبر منصة Biosyn Eg — الإصدار {{version}}
تاريخ العقد: {{date}}
الطرف الأول: منصة Biosyn Eg (biosyneg.com)، وهي شركة تحت التأسيس، ومقرها مركز الإبداع الرقمي بمدينة الزقازيق (جامعة الزقازيق، شيبة النكارية، قسم ثان الزقازيق، محافظة الشرقية)، ويمثلها مؤسسها السيد/ عبده مصطفى، ويُشار إليها في هذا العقد بـ «المنصة». وتحل الشركة محل مؤسسها في جميع حقوق والتزامات هذا العقد فور قيدها في السجل التجاري، وتُضاف بيانات السجل التجاري والبطاقة الضريبية بملحق يُرسل للمحاضر دون حاجة إلى توقيع جديد.
الطرف الثاني: {{name}}، البريد الإلكتروني: {{email}}، الهاتف: {{phone}}، {{id_label}}: {{national_id}}، ويُشار إليه في هذا العقد بـ «المحاضر».
الكورس محل العقد: «{{course}}».
التمهيد
تدير المنصة منصة تعليمية وبحثية إلكترونية تعمل وسيطًا بين المحاضرين والمتعلمين، فتستضيف الدورات التي يقدّمها المحاضرون في المجالات العلمية والطبية، وتتيحها للمشتركين من خلال باقات الاشتراك، وتتولى تسويقها وتحصيل الاشتراكات. ويمتلك المحاضر الخبرة العلمية والمحتوى التدريبي المسجل في مجال تخصصه. ولما كانت المنصة قد رغبت في نشر هذا المحتوى على مشتركيها ولاقت هذه الرغبة قبولًا لدى المحاضر، فقد أقر الطرفان بأهليتهما القانونية للتعاقد، واتفقا على البنود الآتية.
1) التمهيد والتعريفات
1.1 يُعتبر التمهيد السابق جزءًا لا يتجزأ من هذا العقد.
1.2 الكورس: المحتوى التدريبي المسجل المذكور أعلاه، بما يشمله من فيديوهات وعروض وملفات مرفقة وأسئلة، وأي تحديث له.
1.3 المشترك: كل شخص لديه اشتراك سارٍ في إحدى باقات المنصة.
1.4 المشاهدة المعتمدة: أن يشاهد المشترك 50٪ على الأقل من إحدى محاضرات الكورس خلال الشهر، وتُحتسب مشاهدة واحدة لكل مشترك عن الكورس كله في الشهر الواحد مهما تكررت مشاهداته.
1.5 قيمة المشاهدة: صافي دخل الاشتراكات المحصّل خلال الشهر مقسومًا على إجمالي المشاهدات المعتمدة لكل الكورسات المسجلة على المنصة في الشهر نفسه.
1.6 صافي دخل الاشتراكات: ما تحصّله المنصة فعليًا من الاشتراكات بعد الخصومات الترويجية والمبالغ المستردة والضرائب المستحقة عليها، ولا تُخصم منه رسوم بوابات الدفع التي يتحملها المشترك.
1.7 لوحة المحاضر: الصفحة الخاصة بالمحاضر على المنصة، ويظهر فيها مشاهداته وأرباحه ورصيده وأسئلة الطلاب ونسخة من هذا العقد.
2) موضوع العقد
يتيح المحاضر للمنصة نشر الكورس وعرضه على المشتركين ضمن باقات الاشتراك، وتسويقه بالطرق التي تراها مناسبة، مقابل نصيب من العائد وفقًا للبند الثامن. وتعمل المنصة في ذلك بصفتها وسيطًا تقنيًا وتسويقيًا، ولا تُعد العلاقة بين الطرفين علاقة عمل أو شراكة أو وكالة، ويظل المحاضر مسؤولًا عن المحتوى العلمي للكورس.
3) مدة العقد
3.1 مدة هذا العقد ثلاث سنوات من تاريخ نشر الكورس على المنصة.
3.2 يتجدد العقد تلقائيًا لمدد متتالية مدة كل منها سنة، ما لم يخطر أحد الطرفين الآخر بعدم رغبته في التجديد قبل انتهاء المدة السارية بـ 60 يومًا على الأقل.
4) الملكية الفكرية والترخيص
4.1 يحتفظ المحاضر بكامل حقوق الملكية الفكرية للكورس.
4.2 يمنح المحاضر المنصة طوال مدة العقد ترخيصًا باستضافة الكورس وعرضه على المشتركين، وإضافة ترجمة نصية أو ملخصات أو أسئلة تقييم له، واقتطاع مقاطع قصيرة منه لأغراض التسويق، واستخدام اسم المحاضر وصورته ونبذته التعريفية في صفحة الكورس وفي التسويق المرتبط به.
4.3 هذا الترخيص غير حصري، ويحق للمحاضر نشر الكورس أو محتوى مشابه له على منصات أو قنوات أخرى، بشرط أن يُخطر المنصة كتابيًا بذلك قبل النشر أو خلال 7 أيام منه على الأكثر، مع ذكر اسم المنصة أو القناة ورابط النشر.
4.4 لا يمنع ما سبق المحاضر من استخدام معرفته ومادته العلمية في التدريس الجامعي أو الحضوري أو المحاضرات المباشرة، ولا من نشر مقاطع تعريفية مجانية قصيرة من الكورس على حساباته الشخصية مع الإشارة إلى المنصة.
4.5 يُحظر على المنصة بيع الكورس أو ترخيصه منفصلًا لأي طرف ثالث، أو استخدامه في غير الأغراض المذكورة في هذا العقد، دون موافقة كتابية من المحاضر.
4.6 تلتزم المنصة بحماية الكورس من التنزيل والنسخ بالوسائل التقنية المتاحة لها، ويتعاون الطرفان في التبليغ عن أي نسخة مقرصنة والمطالبة بحذفها.
5) إقرارات المحاضر وضماناته
5.1 يقر المحاضر بأنه مؤلف الكورس أو يملك حق نشره، وأن الكورس لا يتضمن نصوصًا أو صورًا أو فيديوهات أو موسيقى أو برامج مملوكة للغير دون إذن أو ترخيص صالح.
5.2 يقر المحاضر بأن الكورس لا يتضمن أي بيانات أو صور تتيح التعرف على مرضى أو مشاركين في أبحاث دون موافقتهم، ولا محتوى مخالفًا للقانون المصري أو لأخلاقيات المهنة.
5.3 يقر المحاضر بأن المعلومات العلمية الواردة في الكورس دقيقة وفق معرفته وقت النشر، وأنه لم ينشر الكورس نفسه على منصة أخرى بموجب عقد حصري يتعارض مع هذا العقد.
5.4 يتحمل المحاضر وحده المسؤولية عن أي ادعاء من الغير بانتهاك حقوقه بسبب محتوى الكورس، ويعوّض المنصة عما تتحمله من أضرار أو مصاريف نتيجة ذلك، ويحق للمنصة إيقاف الكورس فورًا لحين حسم الأمر.
6) مراجعة الكورس ونشره وتحديثه
6.1 للمنصة حق مراجعة الكورس علميًا وفنيًا قبل نشره، وطلب تعديلات محددة، أو الاعتذار عن النشر.
6.2 تحدد المنصة عنوان صفحة الكورس ووصفه وغلافه وترتيبه ضمن الموقع بالتشاور مع المحاضر، ولها أن تجعل محاضرة أو أكثر منه معاينة مجانية.
6.3 يلتزم المحاضر بتصحيح أي خطأ علمي جوهري يُكتشف في الكورس خلال 30 يومًا من إخطاره. ويخضع أي تحديث لاحق للمراجعة نفسها قبل نشره.
7) التسعير والترويج
7.1 تحدد المنصة أسعار الباقات ومددها وطريقة الاشتراك، ولا يُباع الكورس بسعر منفرد إلا باتفاق كتابي بين الطرفين.
7.2 للمنصة تقديم عروض وخصومات وأكواد ترويجية وفترات مجانية على الباقات، ويُحسب نصيب المحاضر على صافي المبالغ المحصّلة فعليًا.
7.3 يجوز للمحاضر طلب كود ترويجي خاص به من لوحة المحاضر، وتحدد المنصة نسبة الخصم الممنوحة للطالب به.
8) المقابل المالي
8.1 يستحق المحاضر 30٪ من قيمة المشاهدات المعتمدة للكورس كل شهر، وتحصل المنصة على 70٪ مقابل التشغيل والاستضافة والتسويق وخدمة العملاء والدفع الإلكتروني.
8.2 نصيب المحاضر الشهري = عدد المشاهدات المعتمدة للكورس × قيمة المشاهدة × 30٪.
8.3 مشاهدات المشتركين الذين اشتركوا بالكود الترويجي الخاص بالمحاضر تُحتسب له بنسبة 50٪ من قيمة المشاهدة بدلًا من 30٪ طوال مدة اشتراكهم، ما لم تُحدد نسبة أخرى للكود كتابةً.
8.4 تُحسب الأرباح في بداية كل شهر عن الشهر السابق، وتظهر في لوحة المحاضر بتفاصيلها.
8.5 يحق للمحاضر طلب سحب رصيده المتراكم مرة كل ثلاثة أشهر دون حد أدنى، وتحوّل المنصة المبلغ خلال 15 يوم عمل من اعتماد الطلب إلى حساب بنكي أو محفظة إلكترونية في مصر باسم المحاضر.
8.6 تخصم المنصة من المبالغ المحوّلة ما يلزمها القانون بخصمه من ضرائب، وتسلّم المحاضر ما يثبت ذلك. ويتحمل المحاضر ما قد يفرضه البنك أو المحفظة من رسوم استلام.
8.7 للمحاضر الاعتراض على أي بيان مالي خلال 30 يومًا من ظهوره في لوحة المحاضر، وتلتزم المنصة بالرد عليه مع التفاصيل خلال 15 يومًا. وما لم يُعترض عليه خلال هذه المدة يُعد مقبولًا.
9) التزامات المحاضر
9.1 تقديم الكورس بجودة صوت وصورة مقبولة وفق معايير المنصة.
9.2 الرد على أسئلة الطلاب الخاصة بالكورس عبر أدوات المنصة خلال 7 أيام عمل في المعتاد.
9.3 الالتزام بآداب التعامل مع الطلاب، وعدم توجيههم للدفع أو التعامل خارج المنصة بخصوص محتوى الكورس.
9.4 إخطار المنصة بأي تغيير في بيانات التواصل أو بيانات استلام الأرباح.
10) التزامات المنصة
10.1 استضافة الكورس وتشغيله للمشتركين والحفاظ على جودة العرض.
10.2 إتاحة بيانات المشاهدات والأرباح والسحوبات للمحاضر بشفافية من خلال لوحة المحاضر.
10.3 سداد المستحقات في مواعيدها المبيّنة في البند الثامن.
10.4 تقديم الدعم الفني للمشتركين، وإحالة الأسئلة العلمية الخاصة بالكورس إلى المحاضر.
11) الحفاظ على سمعة الطرفين
يلتزم كل طرف بالحفاظ على سمعة الطرف الآخر، وعدم القيام بأي أعمال أو تصريحات علنية من شأنها الإساءة إليه أو تشويه صورته، سواء أثناء مدة العقد أو بعد انتهائه.
12) السرية وحماية البيانات
12.1 يلتزم الطرفان بسرية المعلومات المتعلقة بالمعاملات المالية وغير المالية وبنود هذا العقد، وعدم إفشائها لأي طرف ثالث إلا بموجب القانون.
12.2 بيانات الطلاب ملك للمنصة، ولا يجوز للمحاضر نسخها أو استخدامها لأي غرض خارج المنصة، ولا تشارك المنصة بيانات المحاضر الشخصية إلا بالقدر اللازم لتنفيذ العقد.
13) الإنهاء والفسخ
13.1 لا يجوز للمحاضر إنهاء العقد بإرادته المنفردة خلال الاثني عشر شهرًا الأولى من نشر الكورس دون موافقة كتابية من المنصة. وبعدها يجوز لكل طرف إنهاؤه بإخطار كتابي قبل 60 يومًا.
13.2 إذا أنهى المحاضر العقد بالمخالفة للفقرة السابقة، التزم بأداء غرامة مقدارها عشرة آلاف جنيه مصري (10,000 ج.م) دون الحاجة إلى إنذار أو حكم قضائي.
13.3 يحق لأي طرف فسخ العقد إذا أخل الطرف الآخر بأي من التزاماته الجوهرية ولم يصحح الإخلال خلال 15 يومًا من إخطاره كتابيًا. ويعد تأخر المنصة في سداد مستحقات المحاضر أكثر من 30 يومًا من موعدها إخلالًا جوهريًا.
13.4 يحق للمنصة إيقاف الكورس فورًا إذا ثبت انتهاكه لحقوق الغير أو مخالفته للقانون أو لأخلاقيات المهنة.
13.5 عند انتهاء العقد لأي سبب: يُصرف للمحاضر كل عائد مستحق حتى تاريخ الانتهاء خلال 30 يومًا، بعد خصم أي غرامة مستحقة. ويظل الكورس متاحًا للمشتركين الحاليين حتى نهاية اشتراكاتهم القائمة وقت الانتهاء، ثم تحذفه المنصة. وتستمر صلاحية الشهادات التي صدرت للطلاب قبل الانتهاء.
14) القوة القاهرة
لا يُسأل أي من الطرفين عن تأخر أو تعذّر التنفيذ الناتج عن ظروف خارجة عن إرادته، مثل الكوارث أو القرارات الحكومية أو انقطاع الخدمات العامة أو أعطال مزودي الاستضافة والدفع، مع التزامه بإخطار الطرف الآخر فور زوال المانع.
15) الإخطارات وتعديل العقد
15.1 تُعد الإخطارات المرسلة إلى البريد الإلكتروني المسجل لكل طرف في هذا العقد إخطارات كتابية منتجة لآثارها. وبريد المنصة المعتمد هو contact@biosyneg.com.
15.2 لا يسري أي تعديل على هذا العقد إلا بموافقة الطرفين، سواء بملحق مكتوب أو بتوقيع المحاضر إلكترونيًا على إصدار جديد منه. وتخطر المنصة المحاضر بأي إصدار جديد قبل سريانه بـ 30 يومًا على الأقل.
16) القانون والمحكمة المختصة
يخضع هذا العقد لأحكام القانون المصري. ويسعى الطرفان لحل أي خلاف وديًا خلال 30 يومًا من إخطار أحدهما الآخر به، فإن تعذر ذلك تختص محاكم الزقازيق بنظر أي نزاع ينشأ عن هذا العقد أو تنفيذه.
17) التوقيع الإلكتروني وإثبات الشخصية ونسخ العقد
17.1 يقر المحاضر بأن كتابة اسمه الكامل ورسم توقيعه والموافقة على هذا العقد من خلال حسابه على المنصة توقيع منه عليه، وبأن سجل التوقيع (التاريخ والوقت وعنوان IP والبصمة الرقمية لنص العقد) دليل على موافقته. ويحق لأي طرف طلب توقيع نسخة ورقية مطابقة من نسختين، لكل طرف نسخة للعمل بموجبها.
17.2 يلتزم المحاضر عند التوقيع برفع صورة واضحة من وجه وظهر بطاقة الرقم القومي السارية (أو جواز السفر لغير المصريين)، لإثبات شخصيته ومطابقة اسمه في العقد وبيانات صرف الأرباح، ولا تُصرف أي مستحقات قبل استكمالها. وتحفظ المنصة صورة البطاقة بشكل سري، ولا يطّلع عليها إلا المسؤولون المختصون، ولا تُستخدم لأي غرض آخر غير تنفيذ هذا العقد.
17.3 تحتفظ المنصة بنسخة من العقد يمكن للمحاضر الاطلاع عليها وتحميلها من لوحة المحاضر في أي وقت.
$k3$;

-- 2) storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-cards', 'id-cards', false, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists id_cards_insert on storage.objects;
create policy id_cards_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'id-cards' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists id_cards_read on storage.objects;
create policy id_cards_read on storage.objects for select to authenticated
  using (bucket_id = 'id-cards' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
-- the founder's fixed signature lives at contracts/brand/…; any signed-in user may read it to render the agreement
drop policy if exists contracts_brand_read on storage.objects;
create policy contracts_brand_read on storage.objects for select to authenticated
  using (bucket_id = 'contracts' and (storage.foldername(name))[1] = 'brand');

-- 3) contract columns
alter table public.contracts
  add column if not exists id_type text check (id_type in ('national_id','passport')),
  add column if not exists id_number text,
  add column if not exists id_front_path text,
  add column if not exists id_back_path text,
  add column if not exists id_check jsonb,
  add column if not exists id_status text check (id_status in ('auto_verified','needs_review','approved','rejected')),
  add column if not exists id_reviewed_at timestamptz;

-- 4) Egyptian national ID: C YYMMDD GG SSSS X (century 2/3, real birth date, known governorate code)
create or replace function public.valid_egyptian_nid(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d date;
begin
  if p is null or p !~ '^[23][0-9]{13}$' then return false; end if;
  begin
    d := make_date((case substr(p,1,1) when '2' then 1900 else 2000 end) + substr(p,2,2)::int, substr(p,4,2)::int, substr(p,6,2)::int);
  exception when others then return false; end;
  if d > current_date - interval '16 years' or d < current_date - interval '100 years' then return false; end if;
  return substr(p,8,2) in ('01','02','03','04','11','12','13','14','15','16','17','18','19','21','22','23','24','25','26','27','28','29','31','32','33','34','35','88');
end $$;

-- 5) render with the identity number filled in (empty dots until the instructor types it)
create or replace function public.render_contract_id(p_kind text, p_proposal uuid, p_id_type text, p_id_number text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare t contract_templates; p course_proposals; v_phone text; b text; v_idn text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into t from contract_templates where kind = p_kind and active order by version desc limit 1;
  if t.id is null then raise exception 'no contract template'; end if;
  select * into p from course_proposals where id = p_proposal and user_id = auth.uid();
  if p.id is null then raise exception 'not found'; end if;
  v_phone := coalesce(nullif(p.phone, ''), (select phone from profiles where id = auth.uid()), '—');
  v_idn := coalesce(nullif(upper(regexp_replace(coalesce(p_id_number, ''), '[^0-9A-Za-z]', '', 'g')), ''), '................');
  b := replace(replace(replace(replace(replace(replace(replace(replace(t.body,
        '{{name}}', coalesce(nullif(btrim(p.name), ''), '—')), '{{email}}', coalesce(p.email, '—')), '{{phone}}', v_phone),
        '{{course}}', coalesce(nullif(btrim(p.title), ''), '—')), '{{date}}', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
        '{{version}}', t.version::text),
        '{{id_label}}', case when p_id_type = 'passport' then 'رقم جواز السفر' else 'رقم بطاقة الرقم القومي' end),
        '{{national_id}}', v_idn);
  return json_build_object('template_id', t.id, 'version', t.version, 'title', t.title, 'body', b,
                           'sha256', encode(digest(b, 'sha256'), 'hex'), 'name', p.name, 'email', p.email, 'phone', v_phone, 'course', p.title,
                           'needs_id', position('{{national_id}}' in t.body) > 0);
end $$;
revoke all on function public.render_contract_id(text, uuid, text, text) from public, anon;
grant execute on function public.render_contract_id(text, uuid, text, text) to authenticated;

create or replace function public.render_contract(p_kind text, p_proposal uuid)
returns json language sql stable security definer set search_path = public as $$
  select render_contract_id(p_kind, p_proposal, 'national_id', null);
$$;

-- 6) sign: identity document required when the template asks for it
create or replace function public.sign_contract_id(p_kind text, p_proposal uuid, p_sha256 text, p_name text, p_signature text,
                                     p_id_type text, p_id_number text, p_id_front text, p_id_back text, p_id_check jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare r json; v_id uuid; h json; v_ip text; v_ua text; v_name text := btrim(coalesce(p_name, ''));
        v_type text := coalesce(p_id_type, 'national_id');
        v_num text := upper(regexp_replace(coalesce(p_id_number, ''), '[^0-9A-Za-z]', '', 'g'));
        v_status text;
begin
  r := render_contract_id(p_kind, p_proposal, v_type, v_num);
  if r->>'sha256' <> p_sha256 then raise exception 'contract changed, reload the page'; end if;
  if length(v_name) < 5 or position(' ' in v_name) = 0 then raise exception 'type your full name'; end if;
  if p_signature !~ '^data:image/png;base64,' or length(p_signature) < 1500 or length(p_signature) > 400000 then raise exception 'draw your signature'; end if;
  if exists (select 1 from contracts where proposal_id = p_proposal and status = 'signed') then
    select id into v_id from contracts where proposal_id = p_proposal and status = 'signed'; return v_id;
  end if;
  if (r->>'needs_id')::boolean then
    if v_type not in ('national_id','passport') then raise exception 'id type'; end if;
    if v_type = 'national_id' and not valid_egyptian_nid(v_num) then raise exception 'invalid national id'; end if;
    if v_type = 'passport' and v_num !~ '^[A-Z0-9]{6,15}$' then raise exception 'invalid passport number'; end if;
    if p_id_front is null or p_id_back is null
       or split_part(p_id_front, '/', 1) <> auth.uid()::text or split_part(p_id_back, '/', 1) <> auth.uid()::text
       or not exists (select 1 from storage.objects where bucket_id = 'id-cards' and name = p_id_front)
       or not exists (select 1 from storage.objects where bucket_id = 'id-cards' and name = p_id_back) then
      raise exception 'upload your id card';
    end if;
    v_status := case when coalesce((p_id_check->>'verdict') = 'match', false) then 'auto_verified' else 'needs_review' end;
  end if;
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  v_ip := split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1);
  v_ua := left(coalesce(h->>'user-agent', ''), 300);
  insert into contracts (kind, template_id, version, user_id, proposal_id, signer_name, signer_email, signer_phone, course_title, body, body_sha256, signature_png, ip, user_agent,
                         id_type, id_number, id_front_path, id_back_path, id_check, id_status)
  values (p_kind, (r->>'template_id')::uuid, (r->>'version')::int, auth.uid(), p_proposal, v_name, r->>'email', r->>'phone', r->>'course',
          r->>'body', r->>'sha256', p_signature, nullif(v_ip, ''), nullif(v_ua, ''),
          case when v_status is not null then v_type end, case when v_status is not null then v_num end,
          case when v_status is not null then p_id_front end, case when v_status is not null then p_id_back end,
          case when v_status is not null then p_id_check end, v_status)
  returning id into v_id;
  perform enqueue_email('contract:' || v_id, r->>'email', 'نسخة من اتفاقية المحاضر · Biosyn',
    email_html('تم تسجيل اتفاقيتك مع Biosyn ✓', array[
      'أهلاً ' || esc_html(split_part(v_name, ' ', 1)) || '، وقّعت إلكترونيًا على <b>' || esc_html(r->>'title') || '</b> (الإصدار ' || (r->>'version') || ') الخاصة بالدورة <b>' || esc_html(coalesce(r->>'course', '')) || '</b>.',
      'تاريخ التوقيع: <span dir="ltr">' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || '</span> (بتوقيت القاهرة) · رقم الاتفاقية: <span dir="ltr">' || upper(left(v_id::text, 8)) || '</span>',
      'نسخة PDF من الاتفاقية متاحة في لوحة المحاضر. إذا كان لديك أي سؤال عن البنود فردّ على هذه الرسالة.'], 'لوحة المحاضر', 'instructor.html'));
  return v_id;
end $$;
revoke all on function public.sign_contract_id(text, uuid, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.sign_contract_id(text, uuid, text, text, text, text, text, text, text, jsonb) to authenticated;

-- old entry point (cached pages): works only while the active template needs no identity document
create or replace function public.sign_contract(p_kind text, p_proposal uuid, p_sha256 text, p_name text, p_signature text)
returns uuid language sql security definer set search_path = public as $$
  select sign_contract_id(p_kind, p_proposal, p_sha256, p_name, p_signature, null, null, null, null, null);
$$;

-- 7) staff review of the identity document
create or replace function public.review_contract_id(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('approved','rejected','needs_review') then raise exception 'bad status'; end if;
  update contracts set id_status = p_status, id_reviewed_at = now() where id = p_id and id_front_path is not null;
end $$;
revoke all on function public.review_contract_id(uuid, text) from public, anon;
grant execute on function public.review_contract_id(uuid, text) to authenticated;

-- admins upload the founder's fixed signature to contracts/brand/
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='contracts_brand_write') then
    create policy contracts_brand_write on storage.objects for insert to authenticated
      with check (bucket_id = 'contracts' and (storage.foldername(name))[1] = 'brand' and public.is_admin());
  end if;
end $do$;
