-- 0073: security fixes from the security-audit run (2026-11)

-- 1) create_manual_payment_v3: the caller-supplied foreign amount must never lower the price.
--    Before: amount_egp was overwritten with p_amount_local * rate, so a tiny amount made it 0 and
--    the payment was fulfilled as "free". Now amount_egp stays the server quote, and the local
--    amount must be at least the quote (5% tolerance for rounding of the displayed rate).
create or replace function public.create_manual_payment_v3(p_method text, p_ref text, p_proof text default null, p_plan_code text default null, p_course uuid default null, p_coupon text default null, p_request uuid default null, p_currency text default 'EGP', p_amount_local numeric default null)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_plan uuid; v_p payments; v_email text; v_purpose pay_purpose; v_cur text := upper(coalesce(nullif(p_currency,''), 'EGP')); v_rate numeric;
        v_proof text := nullif(btrim(coalesce(p_proof,'')), '');
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_method not in ('instapay','vodafone_cash','paypal') then raise exception 'bad method'; end if;
  if nullif(btrim(coalesce(p_ref,'')),'') is null or length(p_ref) > 120 then raise exception 'اكتب رقم العملية أو الرقم الذي حوّلت منه'; end if;
  if p_method in ('instapay','vodafone_cash') then
    if v_proof is null then raise exception 'ارفع لقطة شاشة للتحويل'; end if;
    if split_part(v_proof, '/', 1) <> auth.uid()::text
       or not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = v_proof) then
      raise exception 'صورة التحويل غير موجودة، ارفعها مرة أخرى';
    end if;
    if exists (select 1 from payments where proof_path = v_proof) then raise exception 'هذه الصورة مستخدمة في طلب آخر'; end if;
  end if;
  if (select count(*) from payments where user_id = auth.uid() and gateway::text = 'manual' and status = 'pending') >= 3 then
    raise exception 'لديك طلبات تحويل قيد المراجعة بالفعل، انتظر تأكيدها.';
  end if;
  if p_request is not null and not exists (select 1 from requests where id = p_request and user_id = auth.uid() and type = 'consultation') then raise exception 'not found'; end if;
  v_purpose := case when p_plan_code is not null then 'subscription' when p_request is not null then 'consultation' else 'interactive_course' end;
  if p_plan_code is not null then select id into v_plan from plans where code = p_plan_code and active; end if;
  v_p := create_pending_payment(auth.uid(), 'manual'::text::gateway, v_purpose, v_plan, case when v_purpose = 'interactive_course' then p_course end, 0, p_coupon);
  update payments set manual_method = p_method, manual_ref = btrim(p_ref), fee_egp = 0, request_id = p_request, proof_path = v_proof
   where id = v_p.id returning * into v_p;

  if v_cur <> 'EGP' and v_p.amount_egp > 0 then
    select egp_rate into v_rate from price_regions where currency = v_cur and active order by country = '*' limit 1;
    if v_rate is null or v_rate <= 0 or p_amount_local is null or p_amount_local <= 0 then raise exception 'bad currency'; end if;
    if round(p_amount_local * v_rate, 2) < v_p.amount_egp * 0.95 then raise exception 'bad amount'; end if;
    -- keep the server-quoted amount_egp; only record the local figure the customer will transfer
    update payments set currency = v_cur, amount_local = round(p_amount_local, 2), fee_local = 0, fx_egp = v_rate
     where id = v_p.id returning * into v_p;
  end if;

  if v_p.amount_egp = 0 then
    v_p := fulfil_payment(v_p.id, 'free:' || v_p.id);
  else
    select email into v_email from auth.users where id = auth.uid();
    perform notify_team('manual:' || v_p.id, 'تحويل يدوي ينتظر التأكيد: ' || coalesce(v_p.amount_local, v_p.amount_egp) || ' ' || v_cur,
      email_html('تحويل يدوي جديد', array[
        'الطريقة: <b>' || case p_method when 'instapay' then 'إنستاباي' when 'paypal' then 'PayPal' else 'فودافون كاش' end || '</b>',
        'المبلغ المطلوب: <b>' || coalesce(v_p.amount_local, v_p.amount_egp) || ' ' || v_cur || '</b>', 'المرجع: ' || esc_html(p_ref), 'العميل: ' || esc_html(v_email),
        case when v_proof is not null then 'صورة التحويل مرفوعة، افتحها من صفحة المدفوعات.' else '' end,
        'راجع وصول المبلغ ثم أكّد الدفعة من لوحة الإدارة، ويتم التفعيل تلقائيًا بعد التأكيد.'], 'المدفوعات', 'admin.html#payments'));
  end if;
  return json_build_object('id', v_p.id, 'amount', coalesce(v_p.amount_local, v_p.amount_egp), 'currency', v_cur, 'status', v_p.status);
end $function$;

-- 2) legacy manual-payment RPCs are unused by the frontend (only v3 is called)
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_manual_payment','create_manual_payment_v2') loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 3) trigger functions must not be callable as RPCs
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'trg\_%' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
