-- RLS policies on public tables (posts, …) call is_staff()/is_admin(); for visitors they simply return false,
-- but without EXECUTE the whole query fails with "permission denied" (blog for signed-out visitors, SEO build).
grant execute on function is_staff() to anon;
grant execute on function is_admin() to anon;
