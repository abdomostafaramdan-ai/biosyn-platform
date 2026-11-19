-- Reminder series cover everyone, not only the last few days:
--   * abandoned checkout: any student with a pending/failed gateway subscription payment (no age limit),
--   * sign-up reminders: every student without a paid payment or an active subscription (any sign-up date),
--     unless they're in the abandoned-checkout series or have a manual transfer waiting for review.
-- The owner's personal/test accounts (app_settings 'view_exclude') never get these emails.
-- The offer block shows the running promo code (site_content.promo_popup.promo_code → coupons) with prices after discount.

create or replace function public.is_excluded_email(p_email text)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select lower(btrim(coalesce(p_email, ''))) in (
    select lower(e) from jsonb_array_elements_text(coalesce(
      (select value::jsonb -> 'emails' from app_settings where key = 'view_exclude' and value ~ '^\s*\{'), '[]')) e);
$function$;
revoke all on function public.is_excluded_email(text) from public, anon, authenticated;

create or replace function public.plan_offer_line()
returns text
language plpgsql stable security definer set search_path = public
as $function$
declare v_code text; c coupons; v_lines text; v_pct numeric;
  fmt constant text := 'FM999,999';
begin
  select nullif(btrim(data->>'promo_code'), '') into v_code from site_content where key in ('promo_popup', 'promo') and coalesce((data->>'on')::boolean, false);
  if v_code is not null then
    select * into c from coupons where lower(code) = lower(v_code) and active and applies_to = 'subscription'
       and (starts_at is null or starts_at <= now()) and (expires_at is null or expires_at > now()) and coalesce(percent_off, 0) > 0;
  end if;
  v_pct := c.percent_off;
  if v_pct is null then
    select '💡 <b>أسعار الباقات:</b><br>' || string_agg(esc_html(name) || ': <b>' || to_char(price_egp, fmt) || ' ج.م</b>', '<br>' order by duration_months)
      into v_lines from plans where active and price_egp > 0;
    return v_lines;
  end if;
  select string_agg(esc_html(name) || ': <s>' || to_char(price_egp, fmt) || '</s> ← <b>'
           || case when round(price_egp * (1 - v_pct / 100), 2) = trunc(price_egp * (1 - v_pct / 100))
                   then to_char(price_egp * (1 - v_pct / 100), fmt) else to_char(round(price_egp * (1 - v_pct / 100), 2), 'FM999,990.00') end
           || ' ج.م</b>', '<br>' order by duration_months)
    into v_lines from plans where active and price_egp > 0 and (c.plan_ids is null or id = any (c.plan_ids)) and (c.plan_id is null or id = c.plan_id);
  return '🎁 <b>عرض الجمعة البيضاء: خصم ' || round(v_pct) || '٪ على الباقات</b><br>استخدم كود <b style="font-size:17px;letter-spacing:1px">'
         || upper(esc_html(c.code)) || '</b> عند الدفع' || case when c.expires_at is not null
              then '، والعرض متاح حتى ' || to_char(c.expires_at at time zone 'Africa/Cairo', 'DD') || ' '
                   || (array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from c.expires_at at time zone 'Africa/Cairo')::int]
              else '' end || ':<br>' || v_lines;
end $function$;
revoke all on function public.plan_offer_line() from public, anon, authenticated;

do $do$
declare d text; n int := 0;
  r1_old text := 'and p.created_at > now() - interval ''5 days'' and p.created_at < now() - interval ''2 hours''';
  r1_new text := 'and p.created_at < now() - interval ''2 hours'' and not is_excluded_email((select email from auth.users au where au.id = p.user_id))';
  r2_old text := 'where pr.role::text = ''student'' and u.created_at > now() - interval ''3 days''
     and not exists (select 1 from payments q where q.user_id = pr.id)
     and not exists (select 1 from subscriptions s where s.user_id = pr.id)';
  r2_new text := 'where pr.role::text = ''student'' and u.created_at < now() - interval ''2 hours'' and not is_excluded_email(u.email)
     and not exists (select 1 from payments q where q.user_id = pr.id and (q.status::text = ''paid'' or (q.gateway::text = ''manual'' and q.status::text = ''pending'')))
     and not exists (select 1 from subscriptions s where s.user_id = pr.id and s.ends_at > now())
     and not exists (select 1 from nurture_state a where a.user_id = pr.id and a.kind = ''abandon'' and not a.done)';
  r3_old text := 'where ns.kind = ''nurture'' and not ns.done and exists (select 1 from payments q where q.user_id = ns.user_id);';
  r3_new text := 'where ns.kind = ''nurture'' and not ns.done and (exists (select 1 from payments q where q.user_id = ns.user_id and q.status::text = ''paid'')
                       or exists (select 1 from nurture_state a where a.user_id = ns.user_id and a.kind = ''abandon'' and not a.done));';
  r4_old text := 'where not ns.done and u.email is not null';
  r4_new text := 'where not ns.done and u.email is not null and not is_excluded_email(u.email)';
begin
  d := pg_get_functiondef('public.enqueue_nurture_emails()'::regprocedure);
  if position(r1_old in d) > 0 then d := replace(d, r1_old, r1_new); n := n + 1; end if;
  if position(r2_old in d) > 0 then d := replace(d, r2_old, r2_new); n := n + 1; end if;
  if position(r3_old in d) > 0 then d := replace(d, r3_old, r3_new); n := n + 1; end if;
  if position(r4_old in d) > 0 then d := replace(d, r4_old, r4_new); n := n + 1; end if;
  if n <> 4 then raise exception 'nurture function changed: % of 4 edits matched', n; end if;
  execute d;
end $do$;
