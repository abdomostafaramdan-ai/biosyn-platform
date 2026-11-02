-- Refund requests: reason, student can see their own requests, student gets an email on the decision.

-- students read their own refund requests (to show "قيد المراجعة / مرفوض" on the payments page)
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'requests' and policyname = 'requests_own_refund') then
    create policy requests_own_refund on requests for select to authenticated using (type = 'refund' and user_id = auth.uid());
  end if;
end $$;

-- reason + snapshot of the amount/item so the admin list reads well even before joining payments
-- (the old 2-arg request_refund(uuid,text) stays for older clients)
create or replace function request_refund(p_payment uuid, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p payments; v_name text; v_email text; v_item text;
begin
  select * into v_p from payments where id = p_payment and user_id = auth.uid();
  if v_p.id is null then raise exception 'payment not found'; end if;
  if not is_refundable(v_p) then raise exception 'refund window (7 days) has passed or payment is not eligible'; end if;
  if exists (select 1 from requests where type = 'refund' and (payload->>'payment_id') = p_payment::text and status in ('new','in_review')) then
    raise exception 'refund already requested';
  end if;
  select full_name into v_name from profiles where id = auth.uid();
  select email into v_email from auth.users where id = auth.uid();
  select title into v_item from courses where id = v_p.course_id;
  insert into requests (type, user_id, name, email, payload)
  values ('refund', auth.uid(), coalesce(nullif(v_name,''), 'طالب'), v_email,
          jsonb_strip_nulls(jsonb_build_object('payment_id', p_payment, 'reason', left(nullif(btrim(p_reason),''), 120),
            'note', left(nullif(btrim(p_note),''), 1000), 'amount_egp', v_p.amount_egp, 'item', v_item)));
end $$;
revoke execute on function request_refund(uuid, text, text) from public, anon;
grant execute on function request_refund(uuid, text, text) to authenticated;

-- email the student when a refund request is accepted or rejected
create or replace function trg_mail_refund_decision() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'refund' and new.status is distinct from old.status and new.status in ('accepted','rejected') and new.email is not null then
    perform enqueue_email('refund:' || new.id || ':' || new.status, new.email,
      case when new.status = 'accepted' then 'تم استرداد المبلغ' else 'بخصوص طلب الاسترداد' end,
      email_html(case when new.status = 'accepted' then 'تم تنفيذ طلب الاسترداد' else 'لم نتمكن من قبول طلب الاسترداد' end,
        array_remove(array[
          'الكورس: ' || esc_html(coalesce(new.payload->>'item', '—')),
          case when new.status = 'accepted' then 'المبلغ هيرجع على نفس وسيلة الدفع خلال أيام العمل المعتادة للبوابة، وتم إلغاء تسجيلك في الكورس.' end,
          case when new.payload ? 'decision_note' then 'ملاحظة الفريق: ' || esc_html(new.payload->>'decision_note') end], null),
        'المدفوعات', 'account.html#payments'));
  end if;
  return new;
end $$;
create or replace trigger mail_refund_decision after update of status on requests for each row execute function trg_mail_refund_decision();
