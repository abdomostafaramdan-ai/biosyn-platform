-- Sign-up: WhatsApp number (defaults to the phone) and «محاضر» accounts.
-- An instructor sign-up stays a student account and files an instructor request in «صندوق الطلبات»;
-- the admin approves it with the existing «ترقية إلى محاضر» button. Role is never taken from user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_ref uuid; m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone text := nullif(left(regexp_replace(coalesce(m->>'phone',''), '[^0-9+]', '', 'g'), 20), '');
  v_wa text := coalesce(nullif(left(regexp_replace(coalesce(m->>'whatsapp',''), '[^0-9+]', '', 'g'), 20), ''), v_phone);
  v_name text := left(coalesce(nullif(m->>'full_name',''), m->>'name', ''), 120);
  v_kind text := case when m->>'teach' = 'interactive' then 'instructor_interactive' else 'instructor_recorded' end;
begin
  select id into v_ref from profiles where ref_code = upper(btrim(coalesce(m->>'ref','')));
  insert into profiles (id, full_name, referred_by, phone, whatsapp, country)
  values (new.id, v_name, v_ref, v_phone, v_wa, nullif(upper(left(coalesce(m->>'country',''), 2)), ''));
  if m->>'account_type' = 'instructor' then
    begin
      insert into requests (type, user_id, name, email, phone, payload)
      values (v_kind::request_type, new.id, coalesce(nullif(v_name,''), new.email), new.email, v_phone,
        jsonb_strip_nulls(jsonb_build_object(
          'المصدر', 'تسجيل حساب جديد كمحاضر',
          'التخصص', nullif(left(btrim(coalesce(m->>'specialty','')), 200), ''),
          'نوع التعاون', case when v_kind = 'instructor_interactive' then 'دورة تفاعلية (مباشرة)' else 'دورة مسجلة' end,
          'رقم الهاتف', v_phone, 'رقم الواتساب', v_wa)));
    exception when others then
      raise warning 'instructor request not filed for %: %', new.id, sqlerrm; -- never block the sign-up itself
    end;
  end if;
  return new;
end $$;

-- Google sign-ups complete their data on login.html (#f-ph); this files the instructor request for them.
create or replace function public.apply_as_instructor(p_specialty text, p_teach text default 'recorded')
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare p profiles%rowtype; v_kind text := case when p_teach = 'interactive' then 'instructor_interactive' else 'instructor_recorded' end; v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  if p.role <> 'student' then return false; end if;
  if exists (select 1 from requests where user_id = auth.uid() and type::text like 'instructor%' and status::text in ('new','in_review')) then return false; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into requests (type, user_id, name, email, phone, payload)
  values (v_kind::request_type, auth.uid(), coalesce(nullif(p.full_name,''), v_email), v_email, p.phone,
    jsonb_strip_nulls(jsonb_build_object('المصدر', 'تسجيل حساب جديد كمحاضر (جوجل)',
      'التخصص', nullif(left(btrim(coalesce(p_specialty,'')), 200), ''),
      'نوع التعاون', case when v_kind = 'instructor_interactive' then 'دورة تفاعلية (مباشرة)' else 'دورة مسجلة' end,
      'رقم الهاتف', p.phone, 'رقم الواتساب', p.whatsapp)));
  return true;
end $$;
revoke all on function public.apply_as_instructor(text, text) from public, anon;
grant execute on function public.apply_as_instructor(text, text) to authenticated;

-- 0066b: admin users list shows the WhatsApp number
drop function if exists public.admin_users();
create function public.admin_users()
returns table(id uuid, email text, full_name text, phone text, whatsapp text, role user_role, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select p.id, u.email::text, p.full_name, p.phone, p.whatsapp, p.role, p.created_at
    from profiles p join auth.users u on u.id = p.id
   where is_staff()
   order by p.created_at desc limit 500;
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
