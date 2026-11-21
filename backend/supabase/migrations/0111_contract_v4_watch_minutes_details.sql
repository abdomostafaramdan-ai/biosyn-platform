-- Contract v4 (recorded courses), not signed by anyone yet: spell out how the watch-minutes payout works in practice.
--   1.4 minutes are recorded automatically and skipping ahead is blocked
--   1.5 a plan's full price counts in the month it is paid, whatever its length
--   1.7 / 8.4 live minutes on the dashboard; earnings appear only after the month closes
--   8.2 the equivalent "share of the 30% pool" wording
do $do$
declare b text; n int := 0;
  r text[][] := array[
    array['1.4 دقائق المشاهدة المعتمدة: مدة المحتوى التي شاهدها المشترك فعليًا من محاضرات الكورس المدفوعة خلال الشهر. وتُحتسب كل دقيقة من المحاضرة مرة واحدة فقط لكل مشترك مهما أعاد مشاهدتها، ولا تُحتسب المحاضرة المجانية الأولى ولا مشاهدات المحاضر لكورسه أو مشاهدات فريق المنصة.',
          '1.4 دقائق المشاهدة المعتمدة: مدة المحتوى التي شاهدها المشترك فعليًا من محاضرات الكورس المدفوعة خلال الشهر، ويسجّلها نظام المنصة آليًا مع منع تخطي أجزاء الفيديو للأمام. وتُحتسب كل دقيقة من المحاضرة مرة واحدة فقط لكل مشترك مهما أعاد مشاهدتها، ولا تُحتسب المحاضرة المجانية الأولى ولا مشاهدات المحاضر لكورسه أو مشاهدات فريق المنصة.'],
    array['1.5 قيمة دقيقة المشاهدة: صافي دخل الاشتراكات المحصّل خلال الشهر مقسومًا على إجمالي دقائق المشاهدة المعتمدة لكل الكورسات المسجلة على المنصة في الشهر نفسه.',
          '1.5 قيمة دقيقة المشاهدة: صافي دخل الاشتراكات المحصّل خلال الشهر مقسومًا على إجمالي دقائق المشاهدة المعتمدة لكل الكورسات المسجلة على المنصة في الشهر نفسه. ويدخل مبلغ الباقة كاملًا في دخل الشهر الذي دُفع فيه، أيًّا كانت مدتها (شهرية أو نصف سنوية أو سنوية).'],
    array['1.7 لوحة المحاضر: الصفحة الخاصة بالمحاضر على المنصة، ويظهر فيها دقائق المشاهدة وأرباحه ورصيده وأسئلة الطلاب ونسخة من هذا العقد.',
          '1.7 لوحة المحاضر: الصفحة الخاصة بالمحاضر على المنصة، وتظهر فيها دقائق المشاهدة على كورساته لحظيًا، وأرباحه بعد إقفال كل شهر، ورصيده وطلبات السحب وأسئلة الطلاب ونسخة من هذا العقد.'],
    array['8.2 نصيب المحاضر الشهري = دقائق المشاهدة المعتمدة للكورس × قيمة دقيقة المشاهدة × 30٪.',
          '8.2 نصيب المحاضر الشهري = دقائق المشاهدة المعتمدة للكورس × قيمة دقيقة المشاهدة × 30٪. ويعادل ذلك 30٪ من صافي دخل الاشتراكات في الشهر مضروبًا في نسبة دقائق مشاهدة الكورس إلى إجمالي دقائق المشاهدة المعتمدة على المنصة.'],
    array['8.4 تُحسب الأرباح في بداية كل شهر عن الشهر السابق، وتظهر في لوحة المحاضر بتفاصيلها.',
          '8.4 يُقفل حساب كل شهر في بداية الشهر التالي، فتُحسب قيمة دقيقة المشاهدة النهائية وأرباح المحاضر عنه، وتُضاف إلى رصيده وتظهر في لوحة المحاضر بتفاصيلها. ولا تُعرض أرباح الشهر الجاري قبل إقفاله لأنها تتغير حتى آخر يوم فيه.']
  ];
begin
  select body into b from contract_templates where id = '555d5fcc-b49a-4db0-bb95-7d0ee9edf702' and version = 4;
  if b is null then raise exception 'contract v4 not found'; end if;
  if exists (select 1 from contracts where template_id = '555d5fcc-b49a-4db0-bb95-7d0ee9edf702') then raise exception 'v4 already signed, make v5 instead'; end if;
  for i in 1 .. array_length(r, 1) loop
    if position(r[i][1] in b) > 0 then b := replace(b, r[i][1], r[i][2]); n := n + 1;
    elsif position(r[i][2] in b) > 0 then n := n + 1;   -- already applied
    end if;
  end loop;
  if n <> array_length(r, 1) then raise exception 'contract text changed: % of % clauses matched', n, array_length(r, 1); end if;
  update contract_templates set body = b where id = '555d5fcc-b49a-4db0-bb95-7d0ee9edf702';
end $do$;
