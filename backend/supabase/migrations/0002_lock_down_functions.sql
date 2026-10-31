revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_staff(), public.is_admin(), public.my_role() to authenticated;
grant execute on function public.record_progress(uuid, numeric) to authenticated;
grant execute on function public.request_payout(text) to authenticated;
grant execute on function public.close_month(date) to authenticated;
create policy webhook_events_no_client on public.webhook_events for all to anon, authenticated using (false) with check (false);
