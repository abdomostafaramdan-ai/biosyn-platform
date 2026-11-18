-- E-mail analytics for the reactivation campaign and e-mail campaigns: opens (1x1 image) and clicks (redirect), both
-- through the email-track edge function, keyed by the recipient token already used for unsubscribe links.
-- Links never carry a destination: the server maps (token, link name) to the URL, so there is no open redirect.
-- The reactivation e-mail also invites people to apply as instructors (teach.html).
-- Also: browser roles get no access at all to the new internal tables.

revoke all on public.nurture_state, public.security_incidents, public.subscription_events from anon;

create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  source text not null check (source in ('reactivation', 'campaign')),
  ref_id uuid not null,                -- legacy_users.id or campaign_recipients.id
  campaign_id uuid,                    -- email_campaigns.id (campaigns only)
  kind text not null check (kind in ('open', 'click')),
  link text,                           -- 'cta' | 'teach' for clicks
  ua text,
  at timestamptz not null default now()
);
create index if not exists email_events_ref_idx on public.email_events (ref_id, kind);
create index if not exists email_events_campaign_idx on public.email_events (campaign_id, kind);
create index if not exists email_events_at_idx on public.email_events (at);
alter table public.email_events enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'email_events' and policyname = 'email_events_admin') then
    create policy email_events_admin on public.email_events for select to authenticated using (is_admin());
  end if;
end $do$;
revoke all on public.email_events from anon;
revoke insert, update, delete, truncate on public.email_events from authenticated;

create or replace function public.email_track_url(p_token uuid, p_link text default null)
returns text
language sql immutable set search_path = public
as $function$
  select 'https://qdlvvwwlsofcngedoaya.supabase.co/functions/v1/email-track?t=' || p_token
         || case when p_link is null then '&o=1' else '&l=' || p_link end;
$function$;

-- called only by the email-track function (service role): records the event, returns where a click should go
create or replace function public.log_email_event(p_token uuid, p_link text, p_ua text)
returns text
language plpgsql security definer set search_path = public
as $function$
declare
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  lu legacy_users; cr campaign_recipients; c email_campaigns; v_src text; v_ref uuid; v_camp uuid; v_to text;
begin
  if p_link is not null and p_link not in ('cta', 'teach') then p_link := 'cta'; end if;
  select * into lu from legacy_users where token = p_token;
  if lu.id is not null then
    v_src := 'reactivation'; v_ref := lu.id;
    v_to := case when p_link = 'teach' then v_site || '/teach.html?utm_source=reactivation&utm_medium=email&utm_campaign=teach'
                 else v_site || '/login.html?mode=signup&email=' || replace(replace(replace(replace(lower(btrim(lu.email)), '%', '%25'), '+', '%2B'), '&', '%26'), '#', '%23')
                      || '&utm_source=reactivation&utm_medium=email&utm_campaign=legacy_' || lower(coalesce(lu.variant, 'a')) end;
  else
    select * into cr from campaign_recipients where token = p_token;
    -- unknown token (e.g. a test send): send the click somewhere sensible, record nothing
    if cr.id is null then return case p_link when 'teach' then v_site || '/teach.html' when 'cta' then v_site || '/login.html?mode=signup' else v_site end; end if;
    select * into c from email_campaigns where id = cr.campaign_id;
    v_src := 'campaign'; v_ref := cr.id; v_camp := cr.campaign_id;
    v_to := case when nullif(btrim(coalesce(c.cta_url, '')), '') is null then v_site
                 when c.cta_url ~* '^https://' then c.cta_url else v_site || '/' || ltrim(c.cta_url, '/') end;
  end if;
  if (select count(*) from email_events where ref_id = v_ref and at > now() - interval '1 hour') < 50 then
    insert into email_events (source, ref_id, campaign_id, kind, link, ua)
    values (v_src, v_ref, v_camp, case when p_link is null then 'open' else 'click' end, p_link, left(p_ua, 200));
  end if;
  return v_to;
end $function$;
revoke all on function public.log_email_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_email_event(uuid, text, text) to service_role;

create or replace function public.reactivation_mail(r legacy_users, p_variant text)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_name text := legacy_first_name(r.full_name);
  v_days int := coalesce((cfg->>'founder_days')::int, 14);
  v_subj text := coalesce(nullif(cfg->>case when p_variant = 'B' then 'subject_b' else 'subject_a' end, ''), 'حسابك في Biosyn ما زال بانتظارك 👀');
  v_unsub text := v_site || '/unsubscribe.html?t=' || r.token;
  v_cta text := email_track_url(r.token, 'cta');
  v_teach text := email_track_url(r.token, 'teach');
begin
  if v_name is null then
    v_subj := btrim(replace(replace(replace(v_subj, '{name}، ', ''), ' يا {name}', ''), '{name}', ''));
  else
    v_subj := replace(v_subj, '{name}', v_name);
  end if;
  subject := v_subj;
  html := email_html(
    'مرحبًا' || coalesce(' ' || esc_html(v_name), '') || ' 👋',
    array[
      'هل تتذكر Biosyn؟ نحن نتذكرك جيدًا 😄',
      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية عملنا على بناء شيء أكبر بكثير: <b>منصة Biosyn الجديدة</b>. دورات مسجلة وتفاعلية لكليات العلوم، والصيدلة، والبايوتكنولوجي، والزراعة، والطب البشري، والطب البيطري، وطب الأسنان، والعلاج الطبيعي، والعلوم الصحية والتطبيقية، وشهادات برمز تحقق يمكنك إضافتها إلى سيرتك الذاتية بثقة.',
      'مكانك محفوظ، ويكفي أن تفعّل حسابك على المنصة الجديدة بالبريد الإلكتروني نفسه، ولن يستغرق ذلك أكثر من دقيقة.',
      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي ←</a>',
      '🏅 <b>هدية لمن كانوا معنا من البداية:</b> فعّل حسابك خلال ' || v_days || ' يومًا لتحصل على شارة <b>«عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم، ولن تُمنح مرة أخرى، و<b>خصم 50٪ على جميع الباقات</b> باستخدام كود <b dir="ltr" style="font-size:16px;letter-spacing:1px">biox</b>.',
      '🎁 <b>وأيضًا:</b> بعد التفعيل ستجد في حسابك رابط دعوة خاصًا بك. كل 3 أصدقاء يشتركون عبره = <b>شهر مجاني لك</b>، وإذا وصلوا إلى 10 تحصل على 6 أشهر مجانًا.',
      '👩‍🏫 <b>لديك خبرة في مجالك؟</b> يمكنك أيضًا الانضمام إلى Biosyn كمحاضر وتقديم دوراتك المسجلة أو التفاعلية لطلاب المنصة، مع نسبة من أرباحها. <a href="' || v_teach || '" target="_blank" style="color:#1d2050;font-weight:700;text-decoration:underline">قدّم كمحاضر من هنا</a>'
    ],
    null, null, v_unsub);
  html := replace(html, '</body>', '<img src="' || email_track_url(r.token) || '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0"></body>');
  return next;
end $function$;

create or replace function public.campaign_mail(c email_campaigns, p_name text, p_token uuid)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_first text := legacy_first_name(p_name);
  v_lines text[] := array[]::text[]; l text; v_href text;
begin
  subject := btrim(replace(replace(replace(c.subject, '{name}، ', case when v_first is null then '' else v_first || '، ' end), ' يا {name}', case when v_first is null then '' else ' يا ' || v_first end), '{name}', coalesce(v_first, '')));
  foreach l in array regexp_split_to_array(c.body, E'\\n+') loop
    if btrim(l) <> '' then
      v_lines := v_lines || regexp_replace(replace(esc_html(btrim(l)), '{name}', coalesce(esc_html(v_first), '')), '\*\*(.+?)\*\*', '<b>\1</b>', 'g');
    end if;
  end loop;
  if nullif(btrim(coalesce(c.cta_label, '')), '') is not null and nullif(btrim(coalesce(c.cta_url, '')), '') is not null then
    -- test sends have no token: link straight to the destination
    v_href := case when p_token is not null then email_track_url(p_token, 'cta')
                   when c.cta_url ~* '^https?://' then c.cta_url else v_site || '/' || ltrim(c.cta_url, '/') end;
    v_lines := v_lines || ('<a href="' || esc_html(v_href) || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">' || esc_html(c.cta_label) || '</a>');
  end if;
  html := email_html(replace(c.heading, '{name}', coalesce(v_first, '')), v_lines, null, null, v_site || '/unsubscribe.html?t=' || coalesce(p_token::text, ''));
  if p_token is not null then
    html := replace(html, '</body>', '<img src="' || email_track_url(p_token) || '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0"></body>');
  end if;
  return next;
end $function$;

-- analytics: reactivation campaign
create or replace function public.reactivation_analytics()
returns json
language sql stable security definer set search_path = public
as $function$
  with lu as (
    select l.*,
           exists (select 1 from email_events e where e.ref_id = l.id and e.kind = 'open') opened,
           exists (select 1 from email_events e where e.ref_id = l.id and e.kind = 'click' and e.link = 'cta') clicked,
           exists (select 1 from email_events e where e.ref_id = l.id and e.kind = 'click' and e.link = 'teach') teach,
           exists (select 1 from payments p where p.user_id = l.user_id and p.status::text = 'paid' and p.created_at >= coalesce(l.sent_at, l.activated_at)) paid
      from legacy_users l),
  days as (select generate_series((now() at time zone 'Africa/Cairo')::date - 13, (now() at time zone 'Africa/Cairo')::date, interval '1 day')::date d)
  select case when not is_admin() then null else json_build_object(
    'total', (select count(*) from lu),
    'queued', (select count(*) from lu where status = 'queued'),
    'sent', (select count(*) from lu where sent_at is not null),
    'opened', (select count(*) from lu where sent_at is not null and opened),
    'clicked', (select count(*) from lu where sent_at is not null and clicked),
    'teach_clicks', (select count(*) from lu where teach),
    'activated', (select count(*) from lu where status = 'activated'),
    'activated_after_email', (select count(*) from lu where status = 'activated' and sent_at is not null and activated_at >= sent_at),
    'paid', (select count(*) from lu where status = 'activated' and paid),
    'unsubscribed', (select count(*) from lu where status = 'unsubscribed'),
    'failed', (select count(*) from lu where status = 'failed'),
    'variants', (select json_agg(json_build_object('v', v, 'sent', s, 'opened', o, 'clicked', c, 'activated', a) order by v)
                   from (select coalesce(variant, '-') v, count(*) filter (where sent_at is not null) s, count(*) filter (where sent_at is not null and opened) o,
                                count(*) filter (where sent_at is not null and clicked) c, count(*) filter (where status = 'activated' and sent_at is not null) a
                           from lu where variant is not null group by 1) x),
    'daily', (select json_agg(json_build_object('d', d,
                 'sent', (select count(*) from legacy_users l where (l.sent_at at time zone 'Africa/Cairo')::date = d),
                 'opened', (select count(distinct e.ref_id) from email_events e where e.source = 'reactivation' and e.kind = 'open' and (e.at at time zone 'Africa/Cairo')::date = d),
                 'activated', (select count(*) from legacy_users l where l.status = 'activated' and (l.activated_at at time zone 'Africa/Cairo')::date = d)) order by d) from days)
  ) end;
$function$;

-- analytics: one row per e-mail campaign
create or replace function public.campaign_analytics()
returns table (id uuid, name text, status text, audience text, total int, sent bigint, opened bigint, clicked bigint,
               new_accounts bigint, purchases bigint, revenue numeric, unsubscribed bigint, started_at timestamptz)
language sql stable security definer set search_path = public
as $function$
  select c.id, c.name, c.status, c.audience, c.total,
         count(r.id) filter (where r.status = 'sent'),
         count(r.id) filter (where r.status = 'sent' and exists (select 1 from email_events e where e.ref_id = r.id and e.kind = 'open')),
         count(r.id) filter (where r.status = 'sent' and exists (select 1 from email_events e where e.ref_id = r.id and e.kind = 'click')),
         count(r.id) filter (where r.status = 'sent' and exists (select 1 from auth.users u where lower(u.email) = lower(r.email) and u.created_at >= r.sent_at)),
         count(r.id) filter (where r.status = 'sent' and exists (select 1 from auth.users u join payments p on p.user_id = u.id
                                                             where lower(u.email) = lower(r.email) and p.status::text = 'paid' and p.created_at >= r.sent_at)),
         coalesce((select sum(p.amount_egp) from campaign_recipients r2 join auth.users u on lower(u.email) = lower(r2.email)
                     join payments p on p.user_id = u.id and p.status::text = 'paid' and p.created_at >= r2.sent_at
                    where r2.campaign_id = c.id and r2.status = 'sent'), 0),
         count(r.id) filter (where exists (select 1 from email_optouts o where o.email = lower(r.email) and o.created_at >= coalesce(r.sent_at, c.started_at))),
         c.started_at
    from email_campaigns c left join campaign_recipients r on r.campaign_id = c.id
   where is_admin()
   group by c.id
   order by c.created_at desc;
$function$;

revoke all on function public.reactivation_analytics(), public.campaign_analytics() from public, anon;
grant execute on function public.reactivation_analytics(), public.campaign_analytics() to authenticated;

-- test sends of a campaign: no token, so the button links straight to its destination and nothing is tracked
create or replace function public.campaign_send_test(p_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public
as $function$
declare c email_campaigns; m record;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into c from email_campaigns where id = p_id;
  if c.id is null then raise exception 'not found'; end if;
  select * into m from campaign_mail(c, 'عبده مصطفى', null);
  perform enqueue_email('campaign-test:' || gen_random_uuid(), p_email, '[تجربة] ' || m.subject, m.html);
end $function$;
