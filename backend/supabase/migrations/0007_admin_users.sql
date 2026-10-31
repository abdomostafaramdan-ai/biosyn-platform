create or replace function public.admin_users()
returns table(id uuid, email text, full_name text, phone text, role user_role, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select p.id, u.email::text, p.full_name, p.phone, p.role, p.created_at
    from profiles p join auth.users u on u.id = p.id
   where is_staff()
   order by p.created_at desc limit 500;
$$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
