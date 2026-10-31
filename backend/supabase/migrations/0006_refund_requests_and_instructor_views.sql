alter type request_type add value if not exists 'refund';

create policy views_instructor on course_views for select to authenticated
  using (exists (select 1 from courses c where c.id = course_id and c.instructor_id = auth.uid()));
create policy pools_instructor on month_pools for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'instructor'));

create or replace function request_refund(p_payment uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p payments; v_name text; v_email text;
begin
  select * into v_p from payments where id = p_payment and user_id = auth.uid();
  if v_p.id is null then raise exception 'payment not found'; end if;
  if not is_refundable(v_p) then raise exception 'refund window (7 days) has passed or payment is not eligible'; end if;
  if exists (select 1 from requests where type = 'refund' and (payload->>'payment_id') = p_payment::text and status in ('new','in_review')) then
    raise exception 'refund already requested';
  end if;
  select full_name into v_name from profiles where id = auth.uid();
  select email into v_email from auth.users where id = auth.uid();
  insert into requests (type, user_id, name, email, payload)
  values ('refund', auth.uid(), coalesce(nullif(v_name,''), 'طالب'), v_email, jsonb_build_object('payment_id', p_payment, 'note', p_note));
end $$;
revoke execute on function request_refund(uuid, text) from public, anon;
grant execute on function request_refund(uuid, text) to authenticated;
