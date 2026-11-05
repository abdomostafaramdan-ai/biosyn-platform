-- Instructor contracts (click-wrap e-signature) + "not recorded yet" instructor requests.
-- How it works (same pattern big marketplaces use): the instructor reads the agreement inside the submit step,
-- types their full name, draws a signature and ticks consent. The server renders the agreement itself, stores the exact
-- text with a SHA-256 hash, version, time, IP and user agent (audit trail), and refuses to submit a recorded course
-- without a signed agreement. A PDF copy is generated in the browser and kept in a private bucket for the admin.

alter type request_type add value if not exists 'instructor_recording_help';

create table if not exists contract_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  version    int  not null,
  title      text not null,
  body       text not null,          -- plain text; {{name}} {{email}} {{phone}} {{course}} {{date}} {{version}} placeholders
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, version)
);
alter table contract_templates enable row level security;
create policy ct_read on contract_templates for select using (auth.role() = 'authenticated');
create policy ct_admin on contract_templates for all using (is_admin()) with check (is_admin());

create table if not exists contracts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  template_id    uuid not null references contract_templates(id),
  version        int  not null,
  user_id        uuid not null references profiles(id),
  proposal_id    uuid references course_proposals(id) on delete set null,
  signer_name    text not null,
  signer_email   text not null,
  signer_phone   text,
  course_title   text,
  body           text not null,      -- the exact text that was signed
  body_sha256    text not null,
  signature_png  text not null,      -- drawn signature (data URL)
  signed_at      timestamptz not null default now(),
  ip             text,
  user_agent     text,
  pdf_path       text,
  status         text not null default 'signed' check (status in ('signed', 'void'))
);
create index if not exists contracts_user_idx on contracts (user_id, signed_at desc);
create unique index if not exists contracts_proposal_once on contracts (proposal_id) where status = 'signed';
alter table contracts enable row level security;
create policy contracts_read on contracts for select using (user_id = auth.uid() or is_staff());
create policy contracts_admin on contracts for update using (is_admin()) with check (is_admin());

-- private bucket for the PDF copies: <user_id>/<contract_id>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 15728640, array['application/pdf']) on conflict (id) do nothing;
create policy contracts_pdf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contracts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy contracts_pdf_read on storage.objects for select to authenticated
  using (bucket_id = 'contracts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

-- the agreement text exactly as the signer will see it (rendered on the server, so nobody can sign an edited copy)
create or replace function render_contract(p_kind text, p_proposal uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare t contract_templates; p course_proposals; v_phone text; b text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into t from contract_templates where kind = p_kind and active order by version desc limit 1;
  if t.id is null then raise exception 'no contract template'; end if;
  select * into p from course_proposals where id = p_proposal and user_id = auth.uid();
  if p.id is null then raise exception 'not found'; end if;
  v_phone := coalesce(nullif(p.phone, ''), (select phone from profiles where id = auth.uid()), '—');
  b := replace(replace(replace(replace(replace(replace(t.body,
        '{{name}}', coalesce(nullif(btrim(p.name), ''), '—')), '{{email}}', coalesce(p.email, '—')), '{{phone}}', v_phone),
        '{{course}}', coalesce(nullif(btrim(p.title), ''), '—')), '{{date}}', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
        '{{version}}', t.version::text);
  return json_build_object('template_id', t.id, 'version', t.version, 'title', t.title, 'body', b,
                           'sha256', encode(digest(b, 'sha256'), 'hex'), 'name', p.name, 'email', p.email, 'phone', v_phone, 'course', p.title);
end $$;
revoke execute on function render_contract(text, uuid) from public, anon;
grant execute on function render_contract(text, uuid) to authenticated;

create or replace function sign_contract(p_kind text, p_proposal uuid, p_sha256 text, p_name text, p_signature text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare r json; v_id uuid; h json; v_ip text; v_ua text; v_name text := btrim(coalesce(p_name, ''));
begin
  r := render_contract(p_kind, p_proposal);
  if r->>'sha256' <> p_sha256 then raise exception 'contract changed, reload the page'; end if;
  if length(v_name) < 5 or position(' ' in v_name) = 0 then raise exception 'type your full name'; end if;
  if p_signature !~ '^data:image/png;base64,' or length(p_signature) < 1500 or length(p_signature) > 400000 then raise exception 'draw your signature'; end if;
  if exists (select 1 from contracts where proposal_id = p_proposal and status = 'signed') then
    select id into v_id from contracts where proposal_id = p_proposal and status = 'signed'; return v_id;
  end if;
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  v_ip := split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1);
  v_ua := left(coalesce(h->>'user-agent', ''), 300);
  insert into contracts (kind, template_id, version, user_id, proposal_id, signer_name, signer_email, signer_phone, course_title, body, body_sha256, signature_png, ip, user_agent)
  values (p_kind, (r->>'template_id')::uuid, (r->>'version')::int, auth.uid(), p_proposal, v_name, r->>'email', r->>'phone', r->>'course',
          r->>'body', r->>'sha256', p_signature, nullif(v_ip, ''), nullif(v_ua, ''))
  returning id into v_id;
  perform enqueue_email('contract:' || v_id, r->>'email', 'نسخة من اتفاقية المحاضر · Biosyn',
    email_html('اتفاقيتك مع Biosyn اتسجلت ✓', array[
      'أهلاً ' || esc_html(split_part(v_name, ' ', 1)) || '، وقّعت إلكترونيًا على <b>' || esc_html(r->>'title') || '</b> (الإصدار ' || (r->>'version') || ') الخاصة بكورس <b>' || esc_html(coalesce(r->>'course', '')) || '</b>.',
      'تاريخ التوقيع: <span dir="ltr">' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || '</span> (بتوقيت القاهرة) · رقم الاتفاقية: <span dir="ltr">' || upper(left(v_id::text, 8)) || '</span>',
      'نسخة PDF من الاتفاقية متاحة في لوحة المحاضر. لو عندك أي سؤال عن البنود رد على الإيميل ده.'], 'لوحة المحاضر', 'instructor.html'));
  return v_id;
end $$;
revoke execute on function sign_contract(text, uuid, text, text, text) from public, anon;
grant execute on function sign_contract(text, uuid, text, text, text) to authenticated;

create or replace function set_contract_pdf(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]+\.pdf$') then raise exception 'bad path'; end if;
  update contracts set pdf_path = p_path where id = p_id and user_id = auth.uid() and pdf_path is null;
end $$;
revoke execute on function set_contract_pdf(uuid, text) from public, anon;
grant execute on function set_contract_pdf(uuid, text) to authenticated;

-- a recorded course can't be submitted without the signed agreement
create or replace function submit_course_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p course_proposals; n int; v_contract uuid;
begin
  select * into p from course_proposals where id = p_id and user_id = auth.uid() for update;
  if p.id is null then raise exception 'not found'; end if;
  if p.status <> 'draft' then raise exception 'already submitted'; end if;
  if coalesce(btrim(p.title), '') = '' or coalesce(btrim(p.name), '') = '' or coalesce(btrim(p.email), '') = '' then raise exception 'missing info'; end if;
  select count(*) into n from proposal_lessons where proposal_id = p_id;
  if n = 0 then raise exception 'no lessons'; end if;
  select id into v_contract from contracts where proposal_id = p_id and status = 'signed';
  if v_contract is null then raise exception 'contract not signed'; end if;
  update course_proposals set status = 'submitted', submitted_at = now(), updated_at = now() where id = p_id;
  insert into requests (type, name, email, phone, payload, user_id)
  values ('instructor_recorded', p.name, p.email, p.phone,
          jsonb_strip_nulls(jsonb_build_object('عنوان الكورس', p.title, 'التخصص', p.specialty, 'المستوى', p.level, 'الفئة المستهدفة', p.audience,
                             'نبذة قصيرة', p.summary, 'الوصف الكامل', p.description,
                             'عدد الدروس', n, 'الدروس بفيديو', (select count(*) from proposal_lessons where proposal_id = p_id and (uploaded or video_url is not null)),
                             'الاتفاقية', 'موقّعة · ' || upper(left(v_contract::text, 8)),
                             'proposal_id', p_id, 'contract_id', v_contract)), p.user_id);
end $$;

-- version 1 of the recorded-course instructor agreement
insert into contract_templates (kind, version, title, body) values ('instructor_recorded', 1, 'اتفاقية نشر كورس مسجل على منصة Biosyn Egypt', $t$
اتفاقية نشر كورس مسجل — الإصدار {{version}}
تاريخ الاتفاقية: {{date}}

الطرف الأول: منصة Biosyn Egypt (biosyneg.com)، ويُشار إليها بـ «المنصة».
الطرف الثاني: {{name}} — البريد الإلكتروني: {{email}} — الهاتف: {{phone}}، ويُشار إليه بـ «المحاضر».
الكورس محل الاتفاقية: «{{course}}».

1) موضوع الاتفاقية
يتيح المحاضر للمنصة نشر الكورس المسجل المذكور أعلاه وعرضه على المشتركين ضمن باقات الاشتراك، وتسويقه بالطرق التي تراها المنصة مناسبة.

2) ملكية المحتوى والترخيص
2.1 يقر المحاضر بأنه صاحب المحتوى أو يملك حق نشره، وأن المحتوى لا يعتدي على حقوق ملكية فكرية أو حقوق أي طرف آخر، ويتحمل وحده المسؤولية عن أي ادعاء بخلاف ذلك.
2.2 يحتفظ المحاضر بملكية المحتوى، ويمنح المنصة ترخيصًا غير حصري طوال مدة الاتفاقية لاستضافة المحتوى وعرضه وتسويقه، واستخدام اسمه وصورته ونبذته التعريفية في صفحة الكورس وفي التسويق المرتبط به.
2.3 تلتزم المنصة بحماية المحتوى من التنزيل والنسخ بالوسائل التقنية المتاحة لها، ولا تبيع المحتوى منفصلًا لأي طرف آخر.

3) المراجعة والنشر
3.1 للمنصة حق مراجعة المحتوى علميًا وفنيًا، وطلب تعديلات، أو الاعتذار عن النشر دون إلزام بإبداء الأسباب.
3.2 تحدد المنصة أسعار الباقات وطريقة الاشتراك، ولا يحدد المحاضر سعرًا منفردًا للكورس.

4) العائد المالي
4.1 يستحق المحاضر 30% من قيمة المشاهدات المعتمدة لكورسه، وتحصل المنصة على 70% مقابل التشغيل والاستضافة والتسويق والدفع الإلكتروني.
4.2 قيمة المشاهدة = إجمالي دخل الاشتراكات خلال الشهر ÷ إجمالي المشاهدات المعتمدة لكل الكورسات المسجلة على المنصة في نفس الشهر.
4.3 المشاهدة المعتمدة: أن يشاهد المشترك 50% على الأقل من المحاضرة، وتُحتسب المشاهدة على الكورس كله، ومشاهدة نفس المشترك لنفس الكورس أكثر من مرة في الشهر تُحتسب مرة واحدة.
4.4 إذا اشترك الطالب باستخدام كود ترويجي خاص بالمحاضر تسلمه له المنصة، تصبح نسبة المحاضر 50% عن هذا الاشتراك.
4.5 تُحسب الأرباح شهريًا وتظهر في لوحة المحاضر، ويكون السحب كل 3 أشهر دون حد أدنى، على وسيلة الدفع التي يحددها المحاضر. رسوم بوابات الدفع يتحملها المشترك ولا تُخصم من نصيب المحاضر.

5) التزامات المحاضر
5.1 تقديم محتوى دقيق علميًا وبجودة صوت وصورة مقبولة، وتحديثه أو تصحيحه عند ظهور أخطاء.
5.2 الرد على أسئلة الطلاب الخاصة بالكورس عبر أدوات المنصة خلال فترة معقولة.
5.3 الالتزام بآداب التعامل مع الطلاب، وعدم توجيههم للدفع أو التعامل خارج المنصة بخصوص محتوى الكورس.

6) المدة والإنهاء
6.1 مدة الاتفاقية سنة من تاريخ نشر الكورس، وتتجدد تلقائيًا لمدد مماثلة ما لم يخطر أحد الطرفين الآخر برغبته في الإنهاء.
6.2 يجوز لأي طرف إنهاء الاتفاقية بإخطار كتابي (بالبريد الإلكتروني) قبل 30 يومًا. ويحتفظ المشتركون الحاليون بإمكانية مشاهدة الكورس حتى نهاية اشتراكاتهم القائمة وقت الإنهاء، ويُصرف للمحاضر أي عائد مستحق حتى تاريخ الإنهاء.
6.3 يحق للمنصة إيقاف الكورس فورًا إذا ثبت انتهاك المحتوى لحقوق الغير أو مخالفته للقانون أو لسياسات المنصة.

7) السرية والبيانات
يلتزم الطرفان بسرية البيانات المالية وبيانات الطلاب، ولا يستخدم المحاضر بيانات الطلاب لأي غرض خارج المنصة.

8) القانون والنزاعات
تخضع هذه الاتفاقية لقوانين جمهورية مصر العربية، ويسعى الطرفان لحل أي خلاف وديًا، فإن تعذر ذلك تختص به المحاكم المصرية المختصة.

9) التوقيع الإلكتروني
يقر المحاضر بأن كتابة اسمه الكامل ورسم توقيعه والموافقة الإلكترونية على هذه الاتفاقية من خلال حسابه على المنصة توقيعٌ منه عليها، وبأن سجل التوقيع (التاريخ والوقت وعنوان IP والبصمة الرقمية لنص الاتفاقية) يُعد دليلًا على موافقته. وتحتفظ المنصة بنسخة من الاتفاقية يمكن للمحاضر الاطلاع عليها في أي وقت.
$t$) on conflict (kind, version) do nothing;
