-- Receipts, certificate verification, lecture files, device limit, referrals, blog,
-- manual payments (InstaPay / Vodafone Cash), webhook alerts, support-chat rate limit.

alter type gateway add value if not exists 'manual';

-- ======================= receipts =======================
create sequence if not exists receipt_seq start 1001;
alter table payments add column if not exists receipt_no bigint unique;
alter table payments add column if not exists manual_method text check (manual_method in ('instapay','vodafone_cash'));
alter table payments add column if not exists manual_ref text;

create or replace function trg_receipt_no() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'paid' and new.receipt_no is null then new.receipt_no := nextval('receipt_seq'); end if;
  return new;
end $$;
drop trigger if exists receipt_no on payments;
create trigger receipt_no before insert or update of status on payments for each row execute function trg_receipt_no();
update payments set receipt_no = nextval('receipt_seq') where status in ('paid','refunded') and receipt_no is null;

-- ======================= certificate verification =======================
alter table certificates add column if not exists code text unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
update certificates set code = upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)) where code is null;
alter table certificates alter column code set not null;

create or replace function verify_certificate(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', p.full_name, 'course', c.title, 'issued_at', ce.issued_at, 'code', ce.code)
    from certificates ce join profiles p on p.id = ce.user_id join courses c on c.id = ce.course_id
   where ce.code = upper(btrim(p_code));
$$;
revoke execute on function verify_certificate(text) from public;
grant execute on function verify_certificate(text) to anon, authenticated;

-- ======================= lecture files =======================
grant execute on function can_watch_lecture(uuid, uuid) to authenticated;

create or replace function can_edit_lecture(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from lectures l join courses c on c.id = l.course_id where l.id = lid and c.instructor_id = auth.uid());
$$;
revoke execute on function can_edit_lecture(uuid) from public, anon;
grant execute on function can_edit_lecture(uuid) to authenticated;

create table if not exists lecture_files (
  id          uuid primary key default gen_random_uuid(),
  lecture_id  uuid not null references lectures(id) on delete cascade,
  name        text not null,
  path        text not null unique,
  size_bytes  bigint,
  created_at  timestamptz not null default now()
);
alter table lecture_files enable row level security;
create policy lecture_files_read on lecture_files for select to authenticated
  using (is_staff() or can_edit_lecture(lecture_id) or can_watch_lecture(auth.uid(), lecture_id));
create policy lecture_files_write on lecture_files for all to authenticated
  using (can_edit_lecture(lecture_id)) with check (can_edit_lecture(lecture_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('lecture-files', 'lecture-files', false, 52428800) on conflict (id) do nothing;

-- object path: <lecture_id>/<random>-<filename>
create or replace function storage_lecture_id(p_name text) returns uuid
language plpgsql immutable set search_path = public as $$
begin return split_part(p_name, '/', 1)::uuid; exception when others then return null; end $$;

create policy lecture_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'lecture-files' and (is_staff() or can_edit_lecture(storage_lecture_id(name)) or can_watch_lecture(auth.uid(), storage_lecture_id(name))));
create policy lecture_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lecture-files' and can_edit_lecture(storage_lecture_id(name)));
create policy lecture_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lecture-files' and can_edit_lecture(storage_lecture_id(name)));

-- ======================= device limit (2 devices per account) =======================
create table if not exists user_devices (
  user_id    uuid not null references profiles(id) on delete cascade,
  device_id  text not null check (length(device_id) between 8 and 80),
  label      text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table user_devices enable row level security;
create policy user_devices_read on user_devices for select to authenticated using (user_id = auth.uid() or is_staff());
create policy user_devices_admin_delete on user_devices for delete to authenticated using (is_admin());

create table if not exists device_removals (user_id uuid not null references profiles(id) on delete cascade, removed_at timestamptz not null default now());
alter table device_removals enable row level security;

-- called by get-playback (service role). Staff are never limited.
create or replace function claim_device(p_user uuid, p_device text, p_label text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int; v_role user_role;
begin
  select role into v_role from profiles where id = p_user;
  if v_role in ('admin','support','instructor') then return true; end if;
  if p_device is null or length(p_device) < 8 then return false; end if;
  update user_devices set last_seen = now(), label = coalesce(p_label, label) where user_id = p_user and device_id = p_device;
  if found then return true; end if;
  select count(*) into v_n from user_devices where user_id = p_user and last_seen > now() - interval '60 days';
  if v_n >= 2 then return false; end if;
  insert into user_devices (user_id, device_id, label) values (p_user, p_device, left(p_label, 80)) on conflict do nothing;
  return true;
end $$;
revoke execute on function claim_device(uuid, text, text) from public, anon, authenticated;
grant execute on function claim_device(uuid, text, text) to service_role;

-- student removes a device: at most once every 7 days (stops "rotating" a shared account)
create or replace function remove_my_device(p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if exists (select 1 from device_removals where user_id = auth.uid() and removed_at > now() - interval '7 days') then
    raise exception 'يمكنك إزالة جهاز مرة واحدة كل 7 أيام. تواصل معنا إذا احتجت المساعدة.';
  end if;
  delete from user_devices where user_id = auth.uid() and device_id = p_device;
  if found then insert into device_removals (user_id) values (auth.uid()); end if;
end $$;
revoke execute on function remove_my_device(text) from public, anon;
grant execute on function remove_my_device(text) to authenticated;

-- ======================= referrals =======================
alter table profiles add column if not exists ref_code text unique;
alter table profiles add column if not exists referred_by uuid references profiles(id);
update profiles set ref_code = upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)) where ref_code is null;
alter table profiles alter column ref_code set default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

-- users must not be able to change these themselves
create or replace function trg_profiles_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(),'') = 'authenticated' then
    new.ref_code := old.ref_code; new.referred_by := old.referred_by;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles for each row execute function trg_profiles_guard();

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  select id into v_ref from profiles where ref_code = upper(btrim(coalesce(new.raw_user_meta_data->>'ref','')));
  insert into profiles (id, full_name, referred_by) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), v_ref);
  return new;
end $$;

alter table subscriptions alter column payment_id drop not null;
alter table subscriptions add column if not exists source text not null default 'payment' check (source in ('payment','referral','admin'));

create table if not exists referral_rewards (
  referred_id  uuid primary key references profiles(id) on delete cascade,
  referrer_id  uuid not null references profiles(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table referral_rewards enable row level security;
create policy referral_rewards_read on referral_rewards for select to authenticated using (referrer_id = auth.uid() or is_staff());

-- reward: referrer gets +1 month when the friend's first PAID subscription (amount > 0) is created
create or replace function trg_referral_reward() returns trigger language plpgsql security definer set search_path = public as $$
declare v_referrer uuid; v_amount numeric; v_plan uuid; v_start timestamptz; v_sub uuid;
begin
  if new.source <> 'payment' or new.payment_id is null then return new; end if;
  select referred_by into v_referrer from profiles where id = new.user_id;
  if v_referrer is null or v_referrer = new.user_id then return new; end if;
  select amount_egp into v_amount from payments where id = new.payment_id;
  if coalesce(v_amount,0) <= 0 then return new; end if;
  if exists (select 1 from referral_rewards where referred_id = new.user_id) then return new; end if;
  select id into v_plan from plans order by duration_months, price_egp limit 1;
  select coalesce(max(ends_at), now()) into v_start from subscriptions where user_id = v_referrer and ends_at > now();
  insert into subscriptions (user_id, plan_id, payment_id, starts_at, ends_at, source)
  values (v_referrer, v_plan, null, v_start, v_start + interval '1 month', 'referral') returning id into v_sub;
  insert into referral_rewards (referred_id, referrer_id, subscription_id) values (new.user_id, v_referrer, v_sub);
  return new;
end $$;
drop trigger if exists referral_reward on subscriptions;
create trigger referral_reward after insert on subscriptions for each row execute function trg_referral_reward();

create or replace function my_referrals() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', (select ref_code from profiles where id = auth.uid()),
    'signed_up', (select count(*) from profiles where referred_by = auth.uid()),
    'rewarded', (select count(*) from referral_rewards where referrer_id = auth.uid()));
$$;
revoke execute on function my_referrals() from public, anon;
grant execute on function my_referrals() to authenticated;

-- ======================= emails: receipt number + referral bonus =======================
create or replace function trg_mail_subscription() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_plan text; v_p payments; v_name text;
begin
  select email into v_email from auth.users where id = new.user_id;
  select name into v_plan from plans where id = new.plan_id;
  select coalesce(full_name,'') into v_name from profiles where id = new.user_id;
  if new.payment_id is null then
    if new.source = 'referral' then
      perform enqueue_email('ref:' || new.id, v_email, 'هدية: شهر إضافي في Biosyn 🎁',
        email_html('شكرًا لدعوتك!', array[
          'أحد أصدقائك اشترك في Biosyn من رابط دعوتك، فأضفنا لك <b>شهرًا مجانيًا</b>.',
          'اشتراكك المجاني ساري حتى <b>' || to_char(new.ends_at at time zone 'Africa/Cairo','YYYY-MM-DD') || '</b>.'], 'ابدأ التعلّم', 'courses.html'));
    end if;
    return new;
  end if;
  select * into v_p from payments where id = new.payment_id;
  perform enqueue_email('pay:' || new.payment_id, v_email, 'تم تأكيد اشتراكك في Biosyn',
    email_html('تم تأكيد الدفع ✓', array[
      'أهلاً ' || esc_html(v_name) || '،',
      'تم استلام دفعتك وتفعيل اشتراكك في <b>' || esc_html(v_plan) || '</b>.',
      'المبلغ المدفوع: <b>' || (coalesce(v_p.amount_egp,0) + coalesce(v_p.fee_egp,0)) || ' ج.م</b>' ||
        case when coalesce(v_p.discount_egp,0) > 0 then ' (بعد خصم ' || v_p.discount_egp || ' ج.م)' else '' end ||
        case when v_p.receipt_no is not null then ' · رقم الإيصال: <b>' || v_p.receipt_no || '</b>' else '' end,
      'اشتراكك ساري من ' || to_char(new.starts_at at time zone 'Africa/Cairo','YYYY-MM-DD') || ' حتى <b>' || to_char(new.ends_at at time zone 'Africa/Cairo','YYYY-MM-DD') || '</b>.',
      'الاشتراك لا يتجدد تلقائيًا، وسنذكّرك قبل انتهائه. يمكنك طباعة الإيصال من صفحة «الاشتراك والمدفوعات».'], 'ابدأ التعلّم', 'courses.html'));
  perform notify_team('pay-team:' || new.payment_id, 'دفعة جديدة: ' || coalesce(v_plan,''),
    email_html('دفعة اشتراك جديدة', array[esc_html(v_plan) || ' · ' || coalesce(v_p.amount_egp,0) || ' ج.م · ' || v_p.gateway::text || ' · ' || esc_html(v_email)]));
  return new;
end $$;

-- ======================= blog =======================
create table if not exists posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9؀-ۿ-]+$'),
  title        text not null,
  excerpt      text,
  body         text not null default '',
  tag          text,
  published    boolean not null default false,
  published_at timestamptz,
  author_id    uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table posts enable row level security;
create policy posts_public_read on posts for select to anon, authenticated using (published or is_staff());
create policy posts_admin_write on posts for all to authenticated using (is_admin()) with check (is_admin());
create or replace function trg_posts_publish() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.published and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists posts_publish on posts;
create trigger posts_publish before insert or update on posts for each row execute function trg_posts_publish();

-- ======================= manual payments (InstaPay / Vodafone Cash) =======================
insert into app_settings (key, value) values ('instapay_handle', null), ('vodafone_cash_number', null) on conflict do nothing;

create or replace function payment_instructions() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'instapay', (select nullif(value,'') from app_settings where key = 'instapay_handle'),
    'vodafone_cash', (select nullif(value,'') from app_settings where key = 'vodafone_cash_number'));
$$;
revoke execute on function payment_instructions() from public;
grant execute on function payment_instructions() to anon, authenticated;

create or replace function create_manual_payment(p_method text, p_ref text, p_plan_code text default null, p_course uuid default null, p_coupon text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_p payments; v_email text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_method not in ('instapay','vodafone_cash') then raise exception 'bad method'; end if;
  if nullif(btrim(coalesce(p_ref,'')),'') is null or length(p_ref) > 120 then raise exception 'اكتب رقم العملية أو الرقم الذي حوّلت منه'; end if;
  if (select count(*) from payments where user_id = auth.uid() and gateway::text = 'manual' and status = 'pending') >= 3 then
    raise exception 'لديك طلبات تحويل قيد المراجعة بالفعل، انتظر تأكيدها.';
  end if;
  if p_plan_code is not null then
    select id into v_plan from plans where code = p_plan_code and active;
    v_p := create_pending_payment(auth.uid(), 'manual'::text::gateway, 'subscription', v_plan, null, 0, p_coupon);
  else
    v_p := create_pending_payment(auth.uid(), 'manual'::text::gateway, 'interactive_course', null, p_course, 0, p_coupon);
  end if;
  update payments set manual_method = p_method, manual_ref = btrim(p_ref), fee_egp = 0 where id = v_p.id returning * into v_p;
  if v_p.amount_egp = 0 then
    v_p := fulfil_payment(v_p.id, 'free:' || v_p.id);
  else
    select email into v_email from auth.users where id = auth.uid();
    perform notify_team('manual:' || v_p.id, 'تحويل يدوي ينتظر التأكيد: ' || v_p.amount_egp || ' ج.م',
      email_html('تحويل يدوي جديد', array[
        'الطريقة: <b>' || case p_method when 'instapay' then 'إنستاباي' else 'فودافون كاش' end || '</b>',
        'المبلغ المطلوب: <b>' || v_p.amount_egp || ' ج.م</b>', 'المرجع: ' || esc_html(p_ref), 'العميل: ' || esc_html(v_email),
        'راجع وصول المبلغ ثم أكّد الدفعة من لوحة الإدارة.'], 'المدفوعات', 'admin.html#payments'));
  end if;
  return json_build_object('id', v_p.id, 'amount', v_p.amount_egp, 'status', v_p.status);
end $$;
revoke execute on function create_manual_payment(text, text, text, uuid, text) from public, anon;
grant execute on function create_manual_payment(text, text, text, uuid, text) to authenticated;

create or replace function admin_review_manual(p_payment uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_p payments;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into v_p from payments where id = p_payment;
  if v_p.id is null or v_p.gateway::text <> 'manual' or v_p.status <> 'pending' then raise exception 'هذه الدفعة ليست تحويلًا يدويًا قيد المراجعة'; end if;
  if p_approve then perform fulfil_payment(p_payment, 'manual:' || p_payment);
  else perform fail_payment(p_payment); end if;
end $$;
revoke execute on function admin_review_manual(uuid, boolean) from public, anon;
grant execute on function admin_review_manual(uuid, boolean) to authenticated;

-- ======================= webhook alerts =======================
create or replace function alert_stuck_webhooks() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select gateway, event_id, received_at from webhook_events
            where processed_at is null and received_at < now() - interval '10 minutes' and received_at > now() - interval '3 days'
  loop
    perform notify_team('wh:' || r.gateway || ':' || r.event_id, '⚠️ إشعار دفع لم يُعالَج (' || r.gateway || ')',
      email_html('إشعار دفع لم يكتمل', array[
        'وصل إشعار من بوابة <b>' || r.gateway || '</b> ولم يُعالَج منذ ' || to_char(r.received_at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') || '.',
        'رقم الحدث: <span dir="ltr">' || esc_html(r.event_id) || '</span>',
        'غالبًا العميل دفع ولم يتفعّل اشتراكه. راجع سجل الدالة webhook-' || r.gateway || ' في Supabase، وفعّل الاشتراك يدويًا إذا لزم.']));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function alert_stuck_webhooks() from public, anon, authenticated;
select cron.schedule('alert-stuck-webhooks', '*/15 * * * *', $$select alert_stuck_webhooks()$$);

-- ======================= support chat rate limit =======================
create table if not exists chat_usage (key text not null, day date not null default current_date, n int not null default 0, primary key (key, day));
alter table chat_usage enable row level security;
create or replace function chat_hit(p_key text, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into chat_usage (key, day, n) values (p_key, current_date, 1)
  on conflict (key, day) do update set n = chat_usage.n + 1 returning n into v;
  delete from chat_usage where day < current_date - 7;
  return v <= p_limit;
end $$;
revoke execute on function chat_hit(text, int) from public, anon, authenticated;
grant execute on function chat_hit(text, int) to service_role;

revoke execute on function trg_referral_reward(), trg_mail_subscription(), handle_new_user() from public, anon, authenticated;
