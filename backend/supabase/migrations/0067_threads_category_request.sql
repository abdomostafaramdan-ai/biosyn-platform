-- request_thread() (admin «مراسلة عبر المنصة» on a request) opens a thread with category 'request',
-- which the check constraint did not allow, so the button failed with threads_category_check.
alter table public.threads drop constraint if exists threads_category_check;
alter table public.threads add constraint threads_category_check
  check (category is null or category in ('payment','technical','content','instructor','account','other','request'));
