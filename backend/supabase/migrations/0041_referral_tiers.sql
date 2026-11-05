-- Referral program v2 (cheaper than "1 friend = 1 month"):
--   • 3 friends subscribe (paid) from your link  → 1 free month. After that, once every 6 months, 3 NEW subscribed friends → another month.
--   • 10 subscribed friends in total (once per account) → 6 free months (semiannual plan).
-- A friend counts once: on their first paid subscription.

create table if not exists referral_qualified (
  referred_id  uuid primary key references profiles(id) on delete cascade,
  referrer_id  uuid not null references profiles(id) on delete cascade,
  payment_id   uuid references payments(id),
  qualified_at timestamptz not null default now()
);
create index if not exists referral_qualified_referrer_idx on referral_qualified (referrer_id, qualified_at);

create table if not exists referral_grants (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references profiles(id) on delete cascade,
  kind            text not null check (kind in ('month', 'semiannual')),
  months          int not null,
  subscription_id uuid references subscriptions(id),
  granted_at      timestamptz not null default now()
);
create index if not exists referral_grants_referrer_idx on referral_grants (referrer_id, granted_at);
create unique index if not exists referral_grants_semiannual_once on referral_grants (referrer_id) where kind = 'semiannual';
alter table referral_qualified enable row level security;
alter table referral_grants enable row level security;
drop policy if exists rq_own on referral_qualified;
create policy rq_own on referral_qualified for select using (referrer_id = auth.uid() or is_staff());
drop policy if exists rg_own on referral_grants;
create policy rg_own on referral_grants for select using (referrer_id = auth.uid() or is_staff());

-- give the free time: appended after any running subscription
create or replace function referral_grant(p_uid uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_months int := case when p_kind = 'semiannual' then 6 else 1 end; v_start timestamptz; v_sub uuid;
begin
  select id into v_plan from plans where code = case when p_kind = 'semiannual' then 'semiannual' else 'monthly' end;
  if v_plan is null then select id into v_plan from plans where duration_months = v_months order by price_egp limit 1; end if;
  if v_plan is null then select id into v_plan from plans order by duration_months, price_egp limit 1; end if;
  select coalesce(max(ends_at), now()) into v_start from subscriptions where user_id = p_uid and ends_at > now();
  insert into subscriptions (user_id, plan_id, payment_id, starts_at, ends_at, source)
  values (p_uid, v_plan, null, v_start, v_start + make_interval(months => v_months), 'referral') returning id into v_sub;
  insert into referral_grants (referrer_id, kind, months, subscription_id) values (p_uid, p_kind, v_months, v_sub);
  return v_sub;
end $$;
revoke execute on function referral_grant(uuid, text) from public, anon, authenticated;

-- decide what a referrer has earned (called on every new qualified friend and daily for cool-downs that just ended)
create or replace function referral_evaluate(p_uid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_total int; v_last timestamptz; v_since int;
begin
  perform pg_advisory_xact_lock(hashtext('referral:' || p_uid));
  select count(*) into v_total from referral_qualified where referrer_id = p_uid;
  if v_total >= 10 and not exists (select 1 from referral_grants where referrer_id = p_uid and kind = 'semiannual') then
    perform referral_grant(p_uid, 'semiannual');
    return 'semiannual';
  end if;
  select max(granted_at) into v_last from referral_grants where referrer_id = p_uid;
  select count(*) into v_since from referral_qualified where referrer_id = p_uid and qualified_at > coalesce(v_last, '-infinity'::timestamptz);
  if v_since >= 3 and (v_last is null or now() >= v_last + interval '6 months') then
    perform referral_grant(p_uid, 'month');
    return 'month';
  end if;
  return null;
end $$;
revoke execute on function referral_evaluate(uuid) from public, anon, authenticated;

-- a referred friend's first paid subscription qualifies them (replaces the old "1 friend = 1 month" trigger)
create or replace function trg_referral_reward() returns trigger language plpgsql security definer set search_path = public as $$
declare v_referrer uuid; v_amount numeric;
begin
  if new.source <> 'payment' or new.payment_id is null then return new; end if;
  select referred_by into v_referrer from profiles where id = new.user_id;
  if v_referrer is null or v_referrer = new.user_id then return new; end if;
  select amount_egp into v_amount from payments where id = new.payment_id;
  if coalesce(v_amount, 0) <= 0 then return new; end if;
  insert into referral_qualified (referred_id, referrer_id, payment_id) values (new.user_id, v_referrer, new.payment_id) on conflict do nothing;
  if found then
    perform referral_evaluate(v_referrer);
    -- progress nudge for the referrer (only when this friend didn't just unlock a reward: the reward has its own email)
    if not exists (select 1 from referral_grants where referrer_id = v_referrer and granted_at > now() - interval '5 seconds') then
      perform notify_user(v_referrer, 'n:refq:' || new.user_id, 'gift', 'صاحبك اشترك من رابطك 🎉', referral_progress_text(v_referrer), 'account.html#settings');
    end if;
  end if;
  return new;
end $$;
revoke execute on function trg_referral_reward() from public, anon, authenticated;

create or replace function referral_progress_text(p_uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_last timestamptz; v_since int; v_semi boolean;
begin
  select count(*) into v_total from referral_qualified where referrer_id = p_uid;
  select max(granted_at) into v_last from referral_grants where referrer_id = p_uid;
  select count(*) into v_since from referral_qualified where referrer_id = p_uid and qualified_at > coalesce(v_last, '-infinity'::timestamptz);
  v_semi := exists (select 1 from referral_grants where referrer_id = p_uid and kind = 'semiannual');
  return case
    when v_since < 3 then 'فاضل ' || (3 - v_since) || ' أصحاب يشتركوا وتاخد شهر مجاني.'
    when v_last is not null and now() < v_last + interval '6 months' then 'الشهر المجاني الجاي بيتفتح يوم ' || to_char(v_last + interval '6 months', 'YYYY-MM-DD') || '.'
    else 'كسبت شهر مجاني!' end
    || case when not v_semi then ' (' || least(v_total, 10) || ' من 10 للـ 6 شهور المجانية)' else '' end;
end $$;
revoke execute on function referral_progress_text(uuid) from public, anon, authenticated;

-- cool-downs that ended today
create or replace function referral_process_all() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select distinct referrer_id from referral_qualified loop
    if referral_evaluate(r.referrer_id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function referral_process_all() from public, anon, authenticated;
select cron.unschedule('referral-process') where exists (select 1 from cron.job where jobname = 'referral-process');
select cron.schedule('referral-process', '17 5 * * *', 'select referral_process_all()');

-- dashboard numbers for the student
create or replace function my_referrals() returns json
language sql stable security definer set search_path = public as $$
  with q as (select count(*) total from referral_qualified where referrer_id = auth.uid()),
       g as (select max(granted_at) last_at, bool_or(kind = 'semiannual') semi, coalesce(sum(months), 0) months from referral_grants where referrer_id = auth.uid())
  select json_build_object(
    'code', (select ref_code from profiles where id = auth.uid()),
    'signed_up', (select count(*) from profiles where referred_by = auth.uid()),
    'subscribed', (select total from q),
    'since_last', (select count(*) from referral_qualified, g where referrer_id = auth.uid() and qualified_at > coalesce(g.last_at, '-infinity'::timestamptz)),
    'next_month_at', (select case when last_at is null then null else last_at + interval '6 months' end from g),
    'semiannual_done', (select coalesce(semi, false) from g),
    'months_earned', (select months from g),
    'rewarded', (select count(*) from referral_grants where referrer_id = auth.uid()));
$$;
revoke execute on function my_referrals() from public, anon;
grant execute on function my_referrals() to authenticated;

-- copy in the existing emails/notifications: new rules
do $$
declare f text; d text; pairs text[][] := array[
  array['''هدية: شهر مجاني في Biosyn 🎁''', '''هدية: اشتراك مجاني في Biosyn 🎁'''],
  array['''صديقك اشترك في Biosyn من رابط دعوتك، فأضفنا لك <b>شهرًا مجانيًا</b> على اشتراكك.''',
        '''أصحابك اشتركوا في Biosyn من رابط دعوتك، فأضفنا لك <b>'' || case when new.ends_at - new.starts_at > interval ''40 days'' then ''6 شهور مجانًا'' else ''شهر مجاني'' end || ''</b> على اشتراكك.'''],
  array['''كل صديق جديد يشترك من رابطك = شهر مجاني جديد ليك.''', '''كمّل: كل 3 أصحاب يشتركوا من رابطك = شهر مجاني (مرة كل 6 شهور)، ولما يوصلوا 10 = 6 شهور مجانًا.'''],
  array['''كسبت شهر مجاني 🎁''', '''كسبت اشتراك مجاني 🎁'''],
  array['ابعت رابط الدعوة بتاعك لصحابك، وكل صديق يشترك لأول مرة في أي باقة مدفوعة بتاخد عنه <b>شهر مجاني</b> يتضاف على اشتراكك تلقائي.',
        'ابعت رابط الدعوة بتاعك لصحابك: لما <b>3 منهم يشتركوا</b> بتاخد <b>شهر مجاني</b> (ومرة كمان كل 6 شهور)، ولو وصلوا <b>10</b> بتاخد <b>6 شهور مجانًا</b>.'],
  array['''ادعُ صديق وخُد شهر مجاني 🎁''', '''ادعُ أصحابك واكسب شهور مجانية 🎁'''],
  array['كل صديق يشترك لأول مرة من رابط دعوتك بيضيف لك شهر مجاني تلقائي. انسخ رابطك من الإعدادات.', '3 أصحاب يشتركوا من رابطك = شهر مجاني، و10 = 6 شهور مجانًا. انسخ رابطك من الإعدادات.'],
  array['🎁 متنساش: كل صديق يشترك من', '🎁 متنساش: كل 3 أصحاب يشتركوا من'],
  array['رابط دعوتك</a> = شهر مجاني ليك.', 'رابط دعوتك</a> = شهر مجاني ليك، و10 = 6 شهور.'],
  array['وكمان: كل صديق يشترك من رابط دعوتك بيضيف لك شهر مجاني، يعني ممكن تكمّل من غير ما تدفع.', 'وكمان: لو 3 من أصحابك اشتركوا من رابط دعوتك بتاخد شهر مجاني، يعني ممكن تكمّل من غير ما تدفع.'],
  array['<b>🎁 شهر مجاني ليك:</b> ابعت رابط دعوتك لصحابك، وكل صديق يشترك لأول مرة بياخد لك شهر مجاني.',
        '<b>🎁 شهور مجانية ليك:</b> ابعت رابط دعوتك لصحابك. لما 3 منهم يشتركوا بتاخد شهر مجاني (ومرة كمان كل 6 شهور)، ولو وصلوا 10 بتاخد 6 شهور مجانًا.']];
  i int;
begin
  foreach f in array array['trg_mail_subscription()', 'enqueue_expiry_reminders()', 'trg_welcome_user()'] loop
    d := pg_get_functiondef(f::regprocedure);
    for i in 1 .. array_length(pairs, 1) loop d := replace(d, pairs[i][1], pairs[i][2]); end loop;
    execute d;
  end loop;
end $$;
revoke execute on function trg_mail_subscription(), trg_welcome_user() from public, anon, authenticated;

-- (applied as 0041d) the reward notification body
do $$
declare d text := pg_get_functiondef('trg_mail_subscription()'::regprocedure);
begin
  d := replace(d, '''صديقك اشترك من رابط دعوتك، واشتراكك اتمدّ لحد '' || v_end || ''.''',
                  '''أصحابك اشتركوا من رابط دعوتك، واشتراكك اتمدّ مجانًا لحد '' || v_end || ''.''');
  execute d;
end $$;
revoke execute on function trg_mail_subscription() from public, anon, authenticated;
-- (0041e) friendlier progress wording: «فاضل صاحب واحد / اتنين / 3 أصحاب» — see referral_progress_text in the database
