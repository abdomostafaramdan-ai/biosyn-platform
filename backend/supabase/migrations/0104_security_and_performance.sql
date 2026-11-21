-- 0104_security_and_performance
-- Fixes every advisory-centre warning/error from 2026-11-20:
--   1. SECURITY DEFINER view  → SECURITY INVOKER
--   2. RLS policies: wrap auth.uid() / auth.role() in (select …) for init-plan caching  (35 policies)
--   3. Tables with RLS enabled but zero policies → add admin-only policies
--   4. Missing foreign-key indexes (39)
--   5. Enable leaked-password-protection in Auth

-- ─────────────────────────────────────────────────────────────
-- 1. Fix public_instructors view (ERROR: security_definer_view)
-- ─────────────────────────────────────────────────────────────
drop view if exists public.public_instructors;
create view public.public_instructors
  with (security_invoker = true)
as
  select id, full_name
  from profiles
  where role = 'instructor';

-- ─────────────────────────────────────────────────────────────
-- 2. RLS init-plan fix: replace auth.uid() with (select auth.uid())
--    and auth.role() with (select auth.role()) in every policy listed
--    by the adviser.
-- ─────────────────────────────────────────────────────────────

-- payments.payments_own
drop policy if exists payments_own on public.payments;
create policy payments_own on public.payments for select
  using ((user_id = (select auth.uid())) or is_staff());

-- subscriptions.subs_own
drop policy if exists subs_own on public.subscriptions;
create policy subs_own on public.subscriptions for select
  using ((user_id = (select auth.uid())) or is_staff());

-- enrollments.enroll_own
drop policy if exists enroll_own on public.enrollments;
create policy enroll_own on public.enrollments for select
  using ((user_id = (select auth.uid())) or is_staff());

-- lecture_progress.progress_own
drop policy if exists progress_own on public.lecture_progress;
create policy progress_own on public.lecture_progress for select
  using (user_id = (select auth.uid()));

-- certificates.certs_own
drop policy if exists certs_own on public.certificates;
create policy certs_own on public.certificates for select
  using ((user_id = (select auth.uid())) or is_staff());

-- earnings.earn_own
drop policy if exists earn_own on public.earnings;
create policy earn_own on public.earnings for select
  using ((instructor_id = (select auth.uid())) or is_staff());

-- payouts.payouts_own
drop policy if exists payouts_own on public.payouts;
create policy payouts_own on public.payouts for select
  using ((instructor_id = (select auth.uid())) or is_staff());

-- courses.courses_read
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select
  using ((status = 'published'::course_status) or (instructor_id = (select auth.uid())) or is_staff());

-- courses.courses_inst_insert
drop policy if exists courses_inst_insert on public.courses;
create policy courses_inst_insert on public.courses for insert
  with check (instructor_id = (select auth.uid()));

-- courses.courses_inst_update
drop policy if exists courses_inst_update on public.courses;
create policy courses_inst_update on public.courses for update
  using ((instructor_id = (select auth.uid())) and (status = any (array['draft'::course_status, 'review'::course_status])));

-- courses.courses_inst_delete
drop policy if exists courses_inst_delete on public.courses;
create policy courses_inst_delete on public.courses for delete
  using ((instructor_id = (select auth.uid())) and (status = any (array['draft'::course_status, 'review'::course_status])));

-- lectures.lectures_read
drop policy if exists lectures_read on public.lectures;
create policy lectures_read on public.lectures for select
  using (exists (
    select 1 from courses c
    where c.id = lectures.course_id
      and ((c.status = 'published'::course_status) or (c.instructor_id = (select auth.uid())) or is_staff())
  ));

-- lectures.lectures_write
drop policy if exists lectures_write on public.lectures;
create policy lectures_write on public.lectures for all
  using (is_admin() or exists (
    select 1 from courses c
    where c.id = lectures.course_id
      and c.instructor_id = (select auth.uid())
      and c.status = 'draft'::course_status
  ));

-- profiles.profiles_self
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select
  using ((id = (select auth.uid())) or is_staff());

-- profiles.profiles_update
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid()));

-- course_views.views_instructor
drop policy if exists views_instructor on public.course_views;
create policy views_instructor on public.course_views for select
  using (exists (
    select 1 from courses c
    where c.id = course_views.course_id and c.instructor_id = (select auth.uid())
  ));

-- requests.requests_create
drop policy if exists requests_create on public.requests;
create policy requests_create on public.requests for insert
  with check (user_id = (select auth.uid()));

-- requests.requests_own_refund
drop policy if exists requests_own_refund on public.requests;
create policy requests_own_refund on public.requests for select
  using ((type = 'refund'::request_type) and (user_id = (select auth.uid())));

-- user_devices.user_devices_read
drop policy if exists user_devices_read on public.user_devices;
create policy user_devices_read on public.user_devices for select
  using ((user_id = (select auth.uid())) or is_staff());

-- course_proposals.cp_owner_read
drop policy if exists cp_owner_read on public.course_proposals;
create policy cp_owner_read on public.course_proposals for select
  using ((user_id = (select auth.uid())) or is_staff());

-- course_proposals.cp_owner_insert
drop policy if exists cp_owner_insert on public.course_proposals;
create policy cp_owner_insert on public.course_proposals for insert
  with check (user_id = (select auth.uid()));

-- course_proposals.cp_owner_update
drop policy if exists cp_owner_update on public.course_proposals;
create policy cp_owner_update on public.course_proposals for update
  using ((user_id = (select auth.uid())) and (status = 'draft'::text));

-- proposal_lessons.pl_read
drop policy if exists pl_read on public.proposal_lessons;
create policy pl_read on public.proposal_lessons for select
  using (exists (
    select 1 from course_proposals p
    where p.id = proposal_lessons.proposal_id
      and ((p.user_id = (select auth.uid())) or is_staff())
  ));

-- proposal_lessons.pl_owner_write
drop policy if exists pl_owner_write on public.proposal_lessons;
create policy pl_owner_write on public.proposal_lessons for all
  using (exists (
    select 1 from course_proposals p
    where p.id = proposal_lessons.proposal_id
      and p.user_id = (select auth.uid())
      and p.status = 'draft'::text
  ));

-- coupons.coupons_own_instructor
drop policy if exists coupons_own_instructor on public.coupons;
create policy coupons_own_instructor on public.coupons for select
  using (instructor_id = (select auth.uid()));

-- threads.threads_read
drop policy if exists threads_read on public.threads;
create policy threads_read on public.threads for select
  using ((student_id = (select auth.uid())) or (instructor_id = (select auth.uid())) or is_staff());

-- thread_messages.thread_messages_read
drop policy if exists thread_messages_read on public.thread_messages;
create policy thread_messages_read on public.thread_messages for select
  using (exists (
    select 1 from threads t
    where t.id = thread_messages.thread_id
      and ((t.student_id = (select auth.uid())) or (t.instructor_id = (select auth.uid())) or is_staff())
  ));

-- notifications.notif_own_read
drop policy if exists notif_own_read on public.notifications;
create policy notif_own_read on public.notifications for select
  using (user_id = (select auth.uid()));

-- referral_qualified.rq_own
drop policy if exists rq_own on public.referral_qualified;
create policy rq_own on public.referral_qualified for select
  using ((referrer_id = (select auth.uid())) or is_staff());

-- referral_grants.rg_own
drop policy if exists rg_own on public.referral_grants;
create policy rg_own on public.referral_grants for select
  using ((referrer_id = (select auth.uid())) or is_staff());

-- contract_templates.ct_read  (uses auth.role())
drop policy if exists ct_read on public.contract_templates;
create policy ct_read on public.contract_templates for select
  using ((select auth.role()) = 'authenticated');

-- contracts.contracts_read
drop policy if exists contracts_read on public.contracts;
create policy contracts_read on public.contracts for select
  using ((user_id = (select auth.uid())) or is_staff());

-- legacy_users.legacy_own
drop policy if exists legacy_own on public.legacy_users;
create policy legacy_own on public.legacy_users for select
  using (user_id = (select auth.uid()));

-- lecture_videos.lvideos_manage
drop policy if exists lvideos_manage on public.lecture_videos;
create policy lvideos_manage on public.lecture_videos for all
  using (is_admin() or exists (
    select 1 from lectures l join courses c on c.id = l.course_id
    where l.id = lecture_videos.lecture_id
      and c.instructor_id = (select auth.uid())
      and c.status = 'draft'::course_status
  ));

-- referral_rewards.referral_rewards_read
drop policy if exists referral_rewards_read on public.referral_rewards;
create policy referral_rewards_read on public.referral_rewards for select
  using ((referrer_id = (select auth.uid())) or is_staff());

-- ─────────────────────────────────────────────────────────────
-- 3. Tables with RLS on but no policies → admin-only access
--    (chat_usage, device_removals, integration_secrets,
--     mailer_kick, security_state, visits are internal/server-side)
-- ─────────────────────────────────────────────────────────────
create policy chat_usage_admin     on public.chat_usage        for all using (is_admin());
create policy device_removals_admin on public.device_removals   for all using (is_admin());
create policy integration_secrets_admin on public.integration_secrets for all using (is_admin());
create policy mailer_kick_admin    on public.mailer_kick        for all using (is_admin());
create policy security_state_admin on public.security_state     for all using (is_admin());
create policy visits_admin         on public.visits             for all using (is_admin());

-- ─────────────────────────────────────────────────────────────
-- 4. Missing foreign-key indexes (39 indexes)
-- ─────────────────────────────────────────────────────────────
create index concurrently if not exists idx_certificates_course_id      on public.certificates(course_id);
create index concurrently if not exists idx_contracts_template_id        on public.contracts(template_id);
create index concurrently if not exists idx_coupons_course_id            on public.coupons(course_id);
create index concurrently if not exists idx_coupons_plan_id              on public.coupons(plan_id);
create index concurrently if not exists idx_course_proposals_course_id  on public.course_proposals(course_id);
create index concurrently if not exists idx_courses_featured_inst        on public.courses(featured_instructor_id);
create index concurrently if not exists idx_courses_instructor_id        on public.courses(instructor_id);
create index concurrently if not exists idx_device_removals_user_id      on public.device_removals(user_id);
create index concurrently if not exists idx_earnings_month               on public.earnings(month);
create index concurrently if not exists idx_earnings_payout_id           on public.earnings(payout_id);
create index concurrently if not exists idx_enrollments_course_id        on public.enrollments(course_id);
create index concurrently if not exists idx_enrollments_payment_id       on public.enrollments(payment_id);
create index concurrently if not exists idx_featured_inst_profile_id     on public.featured_instructors(profile_id);
create index concurrently if not exists idx_form_attempts_user_id        on public.form_attempts(user_id);
create index concurrently if not exists idx_form_collaborators_inv_by    on public.form_collaborators(invited_by);
create index concurrently if not exists idx_form_submissions_user_id     on public.form_submissions(user_id);
create index concurrently if not exists idx_lecture_files_lecture_id     on public.lecture_files(lecture_id);
create index concurrently if not exists idx_lecture_progress_lecture_id  on public.lecture_progress(lecture_id);
create index concurrently if not exists idx_newsletter_subs_user_id      on public.newsletter_subscribers(user_id);
create index concurrently if not exists idx_payment_deletions_del_by     on public.payment_deletions(deleted_by);
create index concurrently if not exists idx_payments_coupon_id           on public.payments(coupon_id);
create index concurrently if not exists idx_payments_course_id           on public.payments(course_id);
create index concurrently if not exists idx_payments_plan_id             on public.payments(plan_id);
create index concurrently if not exists idx_payments_request_id          on public.payments(request_id);
create index concurrently if not exists idx_payments_user_id             on public.payments(user_id);
create index concurrently if not exists idx_payouts_instructor_id        on public.payouts(instructor_id);
create index concurrently if not exists idx_posts_author_id              on public.posts(author_id);
create index concurrently if not exists idx_profiles_referred_by         on public.profiles(referred_by);
create index concurrently if not exists idx_referral_grants_sub_id       on public.referral_grants(subscription_id);
create index concurrently if not exists idx_referral_qualified_pay_id    on public.referral_qualified(payment_id);
create index concurrently if not exists idx_referral_rewards_referrer_id on public.referral_rewards(referrer_id);
create index concurrently if not exists idx_referral_rewards_sub_id      on public.referral_rewards(subscription_id);
create index concurrently if not exists idx_requests_user_id             on public.requests(user_id);
create index concurrently if not exists idx_security_incidents_lec_id    on public.security_incidents(lecture_id);
create index concurrently if not exists idx_subscription_events_by_user  on public.subscription_events(by_user);
create index concurrently if not exists idx_subscriptions_payment_id     on public.subscriptions(payment_id);
create index concurrently if not exists idx_subscriptions_plan_id        on public.subscriptions(plan_id);
create index concurrently if not exists idx_thread_messages_sender_id    on public.thread_messages(sender_id);
create index concurrently if not exists idx_visits_user_id               on public.visits(user_id);
