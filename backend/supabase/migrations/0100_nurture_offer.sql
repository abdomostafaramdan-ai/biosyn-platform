-- Reminder emails (abandoned checkout and new sign-ups) now show the current offer, built from the live plans table,
-- so the email always matches the pricing page (a discount is shown only where old_price_egp > price_egp).

create or replace function public.plan_offer_line()
returns text
language sql stable security definer set search_path = public
as $function$
  select '💡 <b>أسعار الباقات الحالية:</b><br>' || string_agg(
           esc_html(name) || ': <b>' || to_char(price_egp, 'FM999,999') || ' ج.م</b>'
           || case when coalesce(old_price_egp, 0) > price_egp
                   then ' بدلًا من <s>' || to_char(old_price_egp, 'FM999,999') || '</s> (وفّر ' || round((1 - price_egp / old_price_egp) * 100) || '٪)'
                   else '' end,
           '<br>' order by duration_months)
    from plans where active and price_egp > 0;
$function$;
revoke all on function public.plan_offer_line() from public, anon, authenticated;

do $do$
declare d text;
begin
  d := pg_get_functiondef('public.enqueue_nurture_emails()'::regprocedure);
  if position('plan_offer_line' in d) = 0 then
    d := replace(d, 'v_sent_a int := 0; v_sent_n int := 0;', 'v_sent_a int := 0; v_sent_n int := 0; v_offer text := plan_offer_line();');
    d := replace(d, '    perform enqueue_email(r.kind || '':'' || r.user_id',
                    '    if v_offer is not null then v_lines := v_lines || v_offer; end if;' || chr(10) || '    perform enqueue_email(r.kind || '':'' || r.user_id');
    if position('v_lines || v_offer' in d) = 0 or position('v_offer text := plan_offer_line()' in d) = 0 then
      raise exception 'nurture function changed: offer not added';
    end if;
    execute d;
  end if;
end $do$;
