-- close_month(): signed-in callers must be admin; pg_cron / service role (no auth.uid()) may run it.
-- (function body identical to 0001 except the admin check below)
--   if auth.uid() is not null and not is_admin() then raise exception 'admin only'; end if;
-- Applied to the project via the Supabase MCP. Schedules the close on the 1st of each month, 01:00 UTC:
create extension if not exists pg_cron;
select cron.schedule('close-previous-month', '0 1 1 * *',
  $$select public.close_month((date_trunc('month', now()) - interval '1 month')::date)$$);
