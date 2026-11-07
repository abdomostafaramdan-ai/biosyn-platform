-- Home page «دقيقة مشاهدة»: lifetime Bunny Stream watch minutes (site_content.bunny_stats, refreshed daily
-- by the bunny-stats edge function via cron); falls back to on-platform progress minutes if higher.
create or replace function public.public_stats()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  select json_build_object(
    'students',    (a->>'students')::int,
    'countries',   (a->>'countries')::int,
    'courses',     (select count(*) from courses where status::text = 'published'),
    'instructors', (a->>'instructors')::int,
    'minutes',     greatest(
                     coalesce((select (data->>'minutes')::bigint from site_content where key = 'bunny_stats'), 0),
                     (select coalesce(round(sum(least(lp.max_pct,100) / 100.0 * coalesce(l.duration_seconds,0)) / 60), 0)
                        from lecture_progress lp join lectures l on l.id = lp.lecture_id)))
  from (select about_stats()::jsonb a) x;
$function$;

select cron.unschedule('bunny-stats-refresh') where exists (select 1 from cron.job where jobname = 'bunny-stats-refresh');
select cron.schedule('bunny-stats-refresh', '17 2 * * *', $$
  select net.http_post(url := 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/bunny-stats',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
