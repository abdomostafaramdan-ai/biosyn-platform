-- 0126: operating costs flow to the CRM as expenses (category «رواتب ومحاضرين»), signed like every CRM event.
--   * each closed month: one expense per instructor (earnings row) — pending, then paid when the payout is paid.
--   * the month still open: one estimated expense, refreshed nightly (subscription income × instructor % × share of watch
--     time on instructor courses, as close_month computes it). It is removed as soon as the month's real earnings exist.

create or replace function public.crm_expense(p_id text, p_amt numeric, p_date date, p_item text, p_status text, p_ref text, p_note text, p_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  v := jsonb_build_object('id', p_id, 'biosyn_event', 'expense', 'amt', round(coalesce(p_amt, 0), 2), 'date', p_date::text,
    'cat', 'رواتب ومحاضرين', 'method', 'تحويل بنكي', 'item', left(coalesce(p_item, ''), 200), 'status', p_status,
    'ref', left(coalesce(p_ref, ''), 60), 'note', left(coalesce(p_note, ''), 160), 'delete', p_delete);
  insert into crm_outbox (dedupe_key, kind, payload) values ('exp:' || p_id || ':' || md5(v::text), 'order', v)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function public.crm_expense(text, numeric, date, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.month_ar(p_month date) returns text language sql immutable as $$
  select (array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from p_month)::int]
         || ' ' || extract(year from p_month)::int $$;

-- one closed month for one instructor
create or replace function public.crm_earning(p_earning uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e record; v_name text; v_paid boolean;
begin
  select * into e from earnings where id = p_earning;
  if not found then return; end if;
  select full_name into v_name from profiles where id = e.instructor_id;
  select (status::text = 'paid') into v_paid from payouts where id = e.payout_id;
  perform crm_expense('pe-earn-' || e.id, e.amount_egp, (e.month + interval '1 month - 1 day')::date,
    'حصة المحاضر: ' || coalesce(nullif(v_name, ''), 'محاضر') || ' (' || month_ar(e.month) || ')',
    case when coalesce(v_paid, false) then 'paid' else 'pending' end, 'منصة · ' || to_char(e.month, 'YYYY-MM'),
    'منصة Biosyn · حصة المحاضرين حسب دقائق المشاهدة', false);
  -- the month is closed: its estimate goes away
  perform crm_expense('pe-est-' || to_char(e.month, 'YYYY-MM'), 0, e.month, '', 'pending', '', '', true);
end $$;
revoke all on function public.crm_earning(uuid) from public, anon, authenticated;

create or replace function public.trg_crm_earning() returns trigger language plpgsql security definer set search_path = public as $$
begin perform crm_earning(new.id); return new; end $$;
revoke all on function public.trg_crm_earning() from public, anon, authenticated;
create or replace trigger crm_earning after insert or update of amount_egp, payout_id on public.earnings for each row execute function public.trg_crm_earning();

create or replace function public.trg_crm_payout() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  for r in select id from earnings where payout_id = new.id loop perform crm_earning(r.id); end loop;
  return new;
end $$;
revoke all on function public.trg_crm_payout() from public, anon, authenticated;
create or replace trigger crm_payout after insert or update of status on public.payouts for each row execute function public.trg_crm_payout();

-- the month still open: estimated instructor share
create or replace function public.crm_instructor_estimate(p_month date default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_m date := coalesce(p_month, date_trunc('month', now())::date); v_income numeric; v_all numeric; v_ins numeric; v_pct numeric; v_amt numeric;
begin
  if exists (select 1 from earnings where month = v_m) then return null; end if;
  select coalesce(sum(amount_egp), 0) into v_income from payments
   where purpose = 'subscription' and status = 'paid' and date_trunc('month', paid_at)::date = v_m;
  select coalesce(sum(cw.seconds), 0), coalesce(sum(cw.seconds) filter (where c.instructor_id is not null), 0) into v_all, v_ins
    from course_watch cw join courses c on c.id = cw.course_id where cw.month = v_m and c.kind = 'recorded';
  select coalesce((select instructor_pct from month_pools order by month desc limit 1), 30) into v_pct;
  v_amt := case when v_all > 0 then round(v_income * v_pct / 100 * v_ins / v_all, 2) else 0 end;
  perform crm_expense('pe-est-' || to_char(v_m, 'YYYY-MM'), v_amt, least((v_m + interval '1 month - 1 day')::date, (now() at time zone 'Africa/Cairo')::date),
    'حصة المحاضرين التقديرية (' || month_ar(v_m) || ')', 'pending', 'منصة · ' || to_char(v_m, 'YYYY-MM'),
    'تقديري: ' || v_pct || '% من إيراد الاشتراكات (' || round(v_income) || ' ج) حسب دقائق المشاهدة · يتحدّث يوميًا حتى تقفيل الشهر', v_amt <= 0);
  return v_amt;
end $$;
revoke all on function public.crm_instructor_estimate(date) from public, anon, authenticated;

select cron.schedule('crm-instructor-estimate', '50 21 * * *', 'select public.crm_instructor_estimate()');

-- now: closed months already on file, and this month's estimate
select public.crm_earning(id) from earnings;
select public.crm_instructor_estimate();
