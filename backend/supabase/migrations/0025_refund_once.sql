-- A subscriber can request a refund for a payment only once (even if that request was rejected).
create or replace function request_refund(p_payment uuid, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p payments; v_name text; v_email text; v_item text;
begin
  select * into v_p from payments where id = p_payment and user_id = auth.uid() for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  if exists (select 1 from requests where type = 'refund' and (payload->>'payment_id') = p_payment::text) then
    raise exception 'refund already requested';
  end if;
  if not is_refundable(v_p) then raise exception 'refund window (7 days) has passed or payment is not eligible'; end if;
  select full_name into v_name from profiles where id = auth.uid();
  select email into v_email from auth.users where id = auth.uid();
  select title into v_item from courses where id = v_p.course_id;
  insert into requests (type, user_id, name, email, payload)
  values ('refund', auth.uid(), coalesce(nullif(v_name,''), 'طالب'), v_email,
          jsonb_strip_nulls(jsonb_build_object('payment_id', p_payment, 'reason', left(nullif(btrim(p_reason),''), 120),
            'note', left(nullif(btrim(p_note),''), 1000), 'amount_egp', v_p.amount_egp, 'item', v_item)));
end $$;

-- old 2-arg signature now goes through the same rules
create or replace function request_refund(p_payment uuid, p_note text default null)
returns void language sql security definer set search_path = public as $$
  select request_refund(p_payment, p_note, null::text);
$$;

-- belt and braces against double clicks / races
create unique index if not exists requests_one_refund_per_payment on requests ((payload->>'payment_id')) where type = 'refund';
