-- 0112: backups + storage retention (security review 2026-11-21)
-- * The project is on Supabase's FREE plan: no automatic daily backups. Every night backup.take_snapshot() copies the
--   business tables into the private «backup» schema (not reachable through the API), keeping 14 nights.
--   Admin → «مركز الأمان» → «تنزيل نسخة احتياطية» downloads the same data as a file to keep off the platform.
-- * email_outbox kept the full HTML of every e-mail (≈6,000/day during campaigns) and would fill the 500 MB free quota
--   in weeks. Sent e-mails older than 3 days keep their row (dedupe, analytics) but drop the HTML body.
-- * Watchdog: «إيميلات متأخرة» counted campaign waves that are scheduled for later; it now counts only e-mails that are due.
--   The mass-deletion alert no longer promises a Supabase backup.

alter function public.valid_email(text) set search_path = public;

-- ---------- retention ----------
create or replace function public.purge_email_bodies() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update email_outbox set body_html = '' where status = 'sent' and sent_at < now() - interval '3 days' and body_html <> '';
  get diagnostics n = row_count;
  update email_outbox set body_html = '' where status = 'failed' and created_at < now() - interval '14 days' and body_html <> '';
  return n;
end $$;
revoke execute on function public.purge_email_bodies() from public, anon, authenticated;

-- ---------- backups ----------
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.snapshots (
  id bigserial primary key, taken_at timestamptz not null default now(), tbl text not null, n int not null, data jsonb not null
);
create index if not exists snapshots_taken on backup.snapshots (taken_at desc, tbl);
revoke all on all tables in schema backup from public, anon, authenticated;

create or replace function public.backup_tables() returns text[] language sql immutable as $$
  select array['profiles', 'payments', 'subscriptions', 'enrollments', 'plans', 'price_regions', 'coupons', 'courses', 'lectures',
               'lecture_videos', 'lecture_files', 'lecture_progress', 'course_views', 'course_watch', 'certificates', 'earnings', 'month_pools',
               'payouts', 'contracts', 'contract_templates', 'featured_instructors', 'course_faculties', 'course_proposals', 'proposal_lessons',
               'requests', 'threads', 'thread_messages', 'forms', 'form_submissions', 'form_answer_keys', 'referral_grants', 'referral_qualified',
               'referral_rewards', 'legacy_users', 'newsletter_subscribers', 'email_optouts', 'site_content', 'text_overrides', 'seo_settings',
               'posts', 'news_items', 'testimonials', 'app_settings', 'payment_deletions']
     || array[]::text[];
$$;

create or replace function public.backup_take_snapshot() returns int language plpgsql security definer set search_path = public as $$
declare t text; n int; d jsonb; total int := 0; v_at timestamptz := now();
begin
  foreach t in array backup_tables() loop
    if to_regclass('public.' || t) is null then continue; end if;
    if t = 'app_settings' then
      -- keys and tokens stay out of backups
      select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]') into n, d from app_settings x where x.key !~* '(key|secret|token|password)';
    else
      execute format('select count(*), coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into n, d;
    end if;
    insert into backup.snapshots (taken_at, tbl, n, data) values (v_at, t, n, d);
    total := total + n;
  end loop;
  -- auth e-mails (no password hashes) so profiles can be matched back to sign-ins
  insert into backup.snapshots (taken_at, tbl, n, data)
  select v_at, 'auth_users', count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'email_confirmed_at', email_confirmed_at)), '[]') from auth.users;
  delete from backup.snapshots where taken_at < now() - interval '14 days';
  insert into security_state (key, value) values ('last_backup', jsonb_build_object('at', v_at, 'rows', total))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return total;
end $$;
revoke execute on function public.backup_take_snapshot(), public.backup_tables() from public, anon, authenticated;

-- download for the admin: the latest snapshot as one JSON document
create or replace function public.admin_backup_export() returns json language plpgsql security definer set search_path = public as $$
declare v_at timestamptz; r json;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  perform backup_take_snapshot();
  select max(taken_at) into v_at from backup.snapshots;
  select json_build_object('platform', 'Biosyn Eg', 'taken_at', v_at,
           'tables', coalesce(json_object_agg(tbl, data), '{}'), 'counts', coalesce(json_object_agg(tbl || '_n', n), '{}'))
    into r from backup.snapshots where taken_at = v_at;
  return r;
end $$;

create or replace function public.admin_backup_state() returns json language sql stable security definer set search_path = public as $$
  select case when is_admin() then json_build_object(
    'last', (select value from security_state where key = 'last_backup'),
    'nights', (select count(distinct taken_at) from backup.snapshots),
    'db_size', pg_size_pretty(pg_database_size(current_database())),
    'db_bytes', pg_database_size(current_database())) end;
$$;
revoke execute on function public.admin_backup_export(), public.admin_backup_state() from public, anon;
grant execute on function public.admin_backup_export(), public.admin_backup_state() to authenticated;

-- ---------- watchdog patches ----------
do $$
declare d text := pg_get_functiondef('public.security_watchdog()'::regprocedure);
begin
  d := replace(d, $q$select count(*) into n from email_outbox where status = 'pending' and created_at < now() - interval '45 minutes' and created_at > now() - interval '2 days';$q$,
                  $q$select count(*) into n from email_outbox where status = 'pending' and coalesce(send_after, created_at) < now() - interval '45 minutes' and created_at > now() - interval '2 days';$q$);
  d := replace(d, $q$' إيميل مستني أكتر من 45 دقيقة. غالبًا وصلنا للحد اليومي المجاني أو خدمة الإرسال واقفة.'$q$,
                  $q$' إيميل جه ميعاد إرساله من أكتر من 45 دقيقة ولسه ما اتبعتش. غالبًا وصلنا للحد اليومي في Resend أو خدمة الإرسال واقفة.'$q$);
  d := replace(d, $q$'راجع من عنده صلاحية أدمن فورًا. Supabase بيحتفظ بنسخة احتياطية يومية تقدر ترجّع منها.'$q$,
                  $q$'راجع من عنده صلاحية أدمن فورًا. فيه نسخة احتياطية ليلية جوه القاعدة (آخر 14 ليلة) نقدر نرجّع منها.'$q$);
  -- database close to the free 500 MB limit
  d := replace(d, $q$  perform sec_clear('cond:', v_seen);$q$,
                  $q$  if pg_database_size(current_database()) > 400 * 1024 * 1024 then
    perform sec_alert('cond:dbsize', 'critical', 'bug', 'قاعدة البيانات قربت تتملي',
      'الحجم ' || pg_size_pretty(pg_database_size(current_database())) || ' من 500 ميجا في الباقة المجانية. لو اتملت المنصة هتقف عن الكتابة.', null);
    v_seen := array_append(v_seen, 'cond:dbsize');
  end if;
  perform sec_clear('cond:', v_seen);$q$);
  if position('coalesce(send_after, created_at)' in d) = 0 or position('cond:dbsize' in d) = 0 or position('نسخة احتياطية ليلية' in d) = 0 then
    raise exception 'watchdog patch did not apply';
  end if;
  execute d;
end $$;
update security_alerts set status = 'resolved', resolved_at = now(), resolved_by = 'إصلاح 0112: موجات الحملة مجدولة، مش متأخرة'
 where key = 'cond:mailstuck' and status = 'open';

-- ---------- schedules ----------
select cron.unschedule(j) from unnest(array['purge-email-bodies', 'nightly-backup']) j where exists (select 1 from cron.job where jobname = j);
select cron.schedule('purge-email-bodies', '23 2 * * *', 'select public.purge_email_bodies()');
select cron.schedule('nightly-backup', '13 1 * * *', 'select public.backup_take_snapshot()');

select public.purge_email_bodies();
select public.backup_take_snapshot();
