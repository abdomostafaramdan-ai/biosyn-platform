-- 1) InstaPay / Vodafone Cash: a screenshot of the transfer is required.
--    Private bucket payment-proofs/<user id>/<file>; the owner uploads, admins/staff read (signed URLs).
-- 2) Fawaterk signs webhooks with the *Vendor Key* (not the API token): new integration key FAWATERK_VENDOR_KEY.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 6291456, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'proofs_insert_own') then
    create policy proofs_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin() or is_staff()));
  end if;
end $$;

alter table payments add column if not exists proof_path text;

create or replace function create_manual_payment_v3(p_method text, p_ref text, p_proof text default null, p_plan_code text default null, p_course uuid default null,
                                                    p_coupon text default null, p_request uuid default null, p_currency text default 'EGP', p_amount_local numeric default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_p payments; v_email text; v_purpose pay_purpose; v_cur text := upper(coalesce(nullif(p_currency,''), 'EGP')); v_rate numeric;
        v_proof text := nullif(btrim(coalesce(p_proof,'')), '');
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_method not in ('instapay','vodafone_cash','paypal') then raise exception 'bad method'; end if;
  if nullif(btrim(coalesce(p_ref,'')),'') is null or length(p_ref) > 120 then raise exception 'اكتب رقم العملية أو الرقم الذي حوّلت منه'; end if;
  if p_method in ('instapay','vodafone_cash') then
    if v_proof is null then raise exception 'ارفع صورة (سكرين) التحويل'; end if;
    if split_part(v_proof, '/', 1) <> auth.uid()::text
       or not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = v_proof) then
      raise exception 'صورة التحويل مش موجودة، ارفعها تاني';
    end if;
    if exists (select 1 from payments where proof_path = v_proof) then raise exception 'الصورة دي مستخدمة في طلب تاني'; end if;
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
    if v_rate is null or p_amount_local is null or p_amount_local <= 0 then raise exception 'bad currency'; end if;
    update payments set currency = v_cur, amount_local = round(p_amount_local, 2), fee_local = 0, fx_egp = v_rate,
           amount_egp = round(p_amount_local * v_rate, 2) where id = v_p.id returning * into v_p;
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
        'راجع وصول المبلغ ثم أكّد الدفعة من لوحة الإدارة، والتفعيل بيحصل لوحده بعد التأكيد.'], 'المدفوعات', 'admin.html#payments'));
  end if;
  return json_build_object('id', v_p.id, 'amount', coalesce(v_p.amount_local, v_p.amount_egp), 'currency', v_cur, 'status', v_p.status);
end $$;
revoke execute on function create_manual_payment_v3(text, text, text, text, uuid, text, uuid, text, numeric) from public, anon;
grant execute on function create_manual_payment_v3(text, text, text, text, uuid, text, uuid, text, numeric) to authenticated;

-- old entry point: PayPal only (InstaPay / Vodafone Cash now need the screenshot)
create or replace function create_manual_payment_v2(p_method text, p_ref text, p_plan_code text default null, p_course uuid default null,
                                                    p_coupon text default null, p_request uuid default null, p_currency text default 'EGP', p_amount_local numeric default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if p_method <> 'paypal' then raise exception 'حدّث الصفحة وارفع صورة (سكرين) التحويل'; end if;
  return create_manual_payment_v3(p_method, p_ref, null, p_plan_code, p_course, p_coupon, p_request, p_currency, p_amount_local);
end $$;
create or replace function create_manual_payment(p_method text, p_ref text, p_plan_code text default null, p_course uuid default null, p_coupon text default null)
returns json language plpgsql security definer set search_path = public as $$
begin raise exception 'حدّث الصفحة وارفع صورة (سكرين) التحويل'; end $$;

create or replace function integration_keys() returns text[] language sql immutable set search_path = public as $$
  select array[
    'PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','FEE_PAYMOB_PCT','FEE_PAYMOB_FIXED',
    'FAWATERK_API_KEY','FAWATERK_VENDOR_KEY','FAWATERK_BASE_URL','FEE_FAWATERK_PCT','FEE_FAWATERK_FIXED',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FEE_STRIPE_PCT','FEE_STRIPE_FIXED',
    'BUNNY_LIBRARY_ID','BUNNY_TOKEN_KEY','BUNNY_API_KEY','BUNNY_ACCOUNT_KEY',
    'RESEND_API_KEY','MAIL_FROM',
    'META_PIXEL_ID','META_CAPI_TOKEN','GA4_ID',
    'ANTHROPIC_API_KEY',
    'CRM_URL','CRM_WOO_SECRET'
  ]::text[];
$$;
revoke execute on function integration_keys() from public, anon, authenticated;

-- every 5 minutes: ask Fawaterk about pending invoices (covers a missed or late webhook)
select cron.schedule('fawaterk-sweep', '*/5 * * * *', $c$
  select net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/webhook-fawaterk',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"sweep":true}'::jsonb)
   where exists (select 1 from public.payments where gateway::text = 'fawaterk' and status = 'pending'
                 and gateway_ref is not null and created_at > now() - interval '3 days')
$c$);
