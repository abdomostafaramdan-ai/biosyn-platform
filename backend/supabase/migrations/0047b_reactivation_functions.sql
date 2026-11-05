-- First word of a name, only when it looks like a real given name (Arabic or Latin letters).
create or replace function public.legacy_first_name(p text) returns text language sql immutable as $$
  select case when w ~ '^[A-Za-z؀-ۿ]{2,20}$' then w end
    from (select split_part(btrim(regexp_replace(coalesce(p, ''), '^(د\.|دكتور|د/|Dr\.?|Mr\.?|Ms\.?)\s*', '', 'i')), ' ', 1) w) x;
$$;

create or replace function public.reactivation_mail(r public.legacy_users, p_variant text)
returns table (subject text, html text) language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_name text := legacy_first_name(r.full_name);
  v_days int := coalesce((cfg->>'founder_days')::int, 14);
  v_mail text := replace(replace(replace(replace(lower(btrim(r.email)), '%', '%25'), '+', '%2B'), '&', '%26'), '#', '%23');
  v_subj text := coalesce(nullif(cfg->>case when p_variant = 'B' then 'subject_b' else 'subject_a' end, ''), 'حسابك في Biosyn ما زال بانتظارك 👀');
  v_unsub text := v_site || '/unsubscribe.html?t=' || r.token;
  v_cta text := v_site || '/login.html?mode=signup&email=' || v_mail || '&utm_source=reactivation&utm_medium=email&utm_campaign=legacy_' || lower(coalesce(p_variant, 'a'));
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
      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية عملنا على بناء شيء أكبر بكثير: <b>منصة Biosyn الجديدة</b>. دورات في الطب والأحياء والمعلوماتية الحيوية والبرمجة، يقدّمها محاضرون يعملون في المجال فعلًا، وشهادات برمز تحقق يمكنك إضافتها إلى سيرتك الذاتية بثقة.',
      'مكانك محفوظ، ويكفي أن تفعّل حسابك على المنصة الجديدة بالبريد الإلكتروني نفسه، ولن يستغرق ذلك أكثر من دقيقة.',
      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي ←</a>',
      '🏅 <b>هدية لمن كانوا معنا من البداية:</b> فعّل حسابك خلال ' || v_days || ' يومًا لتحصل على شارة <b>«عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم، ولن تُمنح مرة أخرى.',
      '🎁 <b>وأيضًا:</b> بعد التفعيل ستجد في حسابك رابط دعوة خاصًا بك. كل 3 أصدقاء يشتركون عبره = <b>شهر مجاني لك</b>، وإذا وصلوا إلى 10 تحصل على 6 أشهر مجانًا.',
      'لديك سؤال؟ ردّ على هذه الرسالة مباشرة، فنحن أشخاص حقيقيون ونرد بأنفسنا 🙂',
      'إلى اللقاء داخل المنصة،<br><b>عبده مصطفى</b><br>مؤسس Biosyn Egypt',
      '<span style="font-size:12px;line-height:20px;color:#5d6088">وصلتك هذه الرسالة لأنك سجّلت سابقًا على منصة Biosyn. إذا لم ترغب في تلقي رسائل أخرى منا، <a href="' || v_unsub || '" style="color:#5d6088;text-decoration:underline">ألغِ الاشتراك من هنا</a>.</span>'
    ],
    null, null);
  return next;
end $$;

-- Mark legacy contacts who already have an account on the new platform.
create or replace function public.legacy_link_existing() returns int language sql security definer set search_path = public as $$
  with m as (
    update legacy_users l set status = 'activated', user_id = u.id, activated_at = coalesce(l.activated_at, now()),
           founding = now() <= coalesce(l.sent_at, now()) + make_interval(days => coalesce((select (data->>'founder_days')::int from site_content where key = 'reactivation'), 14))
      from auth.users u
     where lower(btrim(u.email)) = lower(btrim(l.email)) and l.status in ('queued', 'sent', 'failed', 'unsubscribed') returning 1)
  select count(*)::int from m;
$$;

create or replace function public.reactivation_send_batch(p_max int default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_today int; v_all int; v_n int; v_sent int := 0; v_bad int := 0; v_linked int; r legacy_users; m record; v_var text;
begin
  if session_user = 'authenticator' and not is_admin() then raise exception 'not allowed'; end if;
  v_linked := legacy_link_existing();
  if not coalesce((cfg->>'enabled')::boolean, false) then
    return json_build_object('skipped', 'disabled', 'linked', v_linked, 'queued', (select count(*) from legacy_users where status = 'queued'));
  end if;
  select count(*) into v_today from legacy_users where sent_at is not null and (sent_at at time zone 'Africa/Cairo')::date = v_day;
  select count(*) into v_all from email_outbox where created_at > now() - interval '24 hours';
  v_n := least(coalesce(p_max, 1000), coalesce((cfg->>'daily_limit')::int, 80) - v_today, coalesce((cfg->>'total_daily_cap')::int, 95) - v_all);
  if v_n > 0 then
    for r in select * from legacy_users where status = 'queued'
              order by priority desc, coalesce(last_active_at, legacy_created_at) desc nulls last, created_at limit v_n for update skip locked loop
      if r.email !~* '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
        update legacy_users set status = 'skipped', note = 'invalid email' where id = r.id; v_bad := v_bad + 1; continue;
      end if;
      v_var := case when abs(hashtext(lower(r.email))) % 2 = 0 then 'A' else 'B' end;
      select * into m from reactivation_mail(r, v_var);
      perform enqueue_email('reactivation:' || r.id, btrim(r.email), m.subject, m.html);
      update legacy_users set status = 'sent', sent_at = now(), variant = v_var where id = r.id;
      v_sent := v_sent + 1;
    end loop;
  end if;
  return json_build_object('sent', v_sent, 'invalid', v_bad, 'linked', v_linked, 'today', v_today + v_sent,
    'emails_24h', v_all + v_sent, 'queued', (select count(*) from legacy_users where status = 'queued'),
    'activated', (select count(*) from legacy_users where status = 'activated'),
    'days_left', ceil((select count(*) from legacy_users where status = 'queued')::numeric / greatest(coalesce((cfg->>'daily_limit')::int, 80), 1)));
end $$;
revoke all on function public.reactivation_send_batch(int) from public, anon;
grant execute on function public.reactivation_send_batch(int) to authenticated;
revoke all on function public.legacy_link_existing() from public, anon, authenticated;
revoke all on function public.reactivation_mail(public.legacy_users, text) from public, anon, authenticated;

create or replace function public.reactivation_stats() returns json language sql stable security definer set search_path = public as $$
  select case when not is_admin() then null else json_build_object(
    'total', count(*), 'queued', count(*) filter (where status = 'queued'), 'sent', count(*) filter (where sent_at is not null),
    'activated', count(*) filter (where status = 'activated'), 'founding', count(*) filter (where founding),
    'unsubscribed', count(*) filter (where status = 'unsubscribed'), 'invalid', count(*) filter (where status = 'skipped'),
    'today', count(*) filter (where (sent_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date),
    'a_sent', count(*) filter (where variant = 'A'), 'a_act', count(*) filter (where variant = 'A' and status = 'activated'),
    'b_sent', count(*) filter (where variant = 'B'), 'b_act', count(*) filter (where variant = 'B' and status = 'activated'),
    'last_sent', max(sent_at)) end from legacy_users;
$$;

-- Admin import: [{email, name, phone, created_at, last_active_at, legacy_id, priority}]
create or replace function public.reactivation_import(p_rows jsonb) returns json language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int;
begin
  if not is_admin() and session_user = 'authenticator' then raise exception 'not allowed'; end if;
  select count(*) into v_before from legacy_users;
  insert into legacy_users (email, full_name, phone, legacy_id, legacy_created_at, last_active_at, priority)
  select lower(btrim(x->>'email')), nullif(btrim(x->>'name'), ''), nullif(btrim(x->>'phone'), ''), nullif(btrim(x->>'legacy_id'), ''),
         case when x->>'created_at' ~ '^\d{4}-\d{2}-\d{2}' then (x->>'created_at')::timestamptz end,
         case when x->>'last_active_at' ~ '^\d{4}-\d{2}-\d{2}' then (x->>'last_active_at')::timestamptz end,
         coalesce(nullif(x->>'priority', '')::int, 0)
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'email'), '') like '%@%'
  on conflict ((lower(btrim(email)))) do nothing;
  select count(*) into v_after from legacy_users;
  return json_build_object('added', v_after - v_before, 'total', v_after, 'already_on_platform', legacy_link_existing());
end $$;
revoke all on function public.reactivation_import(jsonb) from public, anon;
grant execute on function public.reactivation_import(jsonb) to authenticated;

-- Preview the campaign email in your own inbox.
create or replace function public.reactivation_send_test(p_email text, p_variant text default 'A') returns void
language plpgsql security definer set search_path = public as $$
declare r legacy_users; m record;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  r.email := p_email; r.full_name := 'عبده'; r.token := gen_random_uuid();
  select * into m from reactivation_mail(r, upper(p_variant));
  perform enqueue_email('reactivation-test:' || gen_random_uuid(), p_email, '[تجربة] ' || m.subject, m.html);
end $$;
revoke all on function public.reactivation_send_test(text, text) from public, anon;
grant execute on function public.reactivation_send_test(text, text) to authenticated;

-- Public: one-click unsubscribe from the link in the email.
create or replace function public.reactivation_unsubscribe(p_token uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (update legacy_users set status = 'unsubscribed', note = 'unsubscribed ' || now()::date
              where token = p_token and status in ('queued', 'sent', 'failed') returning 1)
  select exists (select 1 from u) or exists (select 1 from legacy_users where token = p_token);
$$;
grant execute on function public.reactivation_unsubscribe(uuid) to anon, authenticated;

-- New sign-up → link to the legacy contact and award «عضو مؤسس» inside the window.
create or replace function public.trg_legacy_activate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update legacy_users set status = 'activated', user_id = new.id, activated_at = now(),
         founding = now() <= coalesce(sent_at, now()) + make_interval(days => coalesce((select (data->>'founder_days')::int from site_content where key = 'reactivation'), 14))
   where lower(btrim(email)) = lower(btrim(new.email)) and user_id is null;
  return new;
exception when others then return new;
end $$;
create trigger legacy_activate after insert on auth.users for each row execute function public.trg_legacy_activate();

-- Certificates show the badge.
create or replace function public.verify_certificate(p_code text)
 returns json language sql stable security definer set search_path to 'public' as $function$
  select json_build_object(
      'name', coalesce(nullif(btrim(ce.holder_name), ''), nullif(btrim(p.cert_name), ''), p.full_name),
      'course', c.title, 'kind', c.kind, 'issued_at', ce.issued_at, 'code', ce.code,
      'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'hours', coalesce(c.hours, case when c.kind = 'recorded' then
                 round((select sum(l.duration_seconds) from lectures l where l.course_id = c.id) / 3600.0, 1) end),
      'founding', exists (select 1 from legacy_users lu where lu.user_id = ce.user_id and lu.founding))
    from certificates ce join profiles p on p.id = ce.user_id join courses c on c.id = ce.course_id
   where ce.code = upper(btrim(p_code));
$function$;

-- Shared email footer: neutral wording (campaign recipients may not have an account yet).
do $x$ declare d text := pg_get_functiondef('public.email_html'::regproc);
begin d := replace(d, 'وصلتك هذه الرسالة لأن لديك حسابًا على منصة Biosyn Egypt.', 'وصلتك هذه الرسالة من منصة Biosyn Egypt.'); execute d; end $x$;
