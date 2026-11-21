-- 1) reactivation_mail: 0105 dropped open/click tracking and the "teach on Biosyn" line from 0093. Both are back,
--    keeping 0105's copy (semiannual plan highlight, biox code).
-- 2) reactivation_blast(): sends the reactivation email to every old-platform user who hasn't activated yet
--    (queued AND already-emailed ones; skips activated, unsubscribed, opt-outs, invalid addresses, the owner's accounts),
--    paced like the campaigns: 1 email/second with a 10-minute pause after every 1,000.

create or replace function public.reactivation_mail(r legacy_users, p_variant text)
returns table(subject text, html text)
language plpgsql stable security definer set search_path = public
as $function$
declare
  cfg    jsonb := coalesce((select data from site_content where key = 'reactivation'), '{}');
  v_site text  := rtrim(coalesce(nullif((select value from app_settings where key = 'site_url'), ''), 'https://biosyneg.com'), '/');
  v_name text  := legacy_first_name(r.full_name);
  v_days int   := coalesce((cfg->>'founder_days')::int, 14);
  v_subj text  := coalesce(nullif(cfg->>case when p_variant = 'B' then 'subject_b' else 'subject_a' end, ''),
                           case when p_variant = 'B' then 'عدنا بمنصة جديدة… ومقعدك محجوز يا {name}' else '{name}، حسابك في Biosyn ما زال بانتظارك 👀' end);
  v_unsub text := v_site || '/unsubscribe.html?t=' || r.token;
  v_cta   text := email_track_url(r.token, 'cta');
  v_teach text := email_track_url(r.token, 'teach');
  v_semi_orig numeric; v_semi_disc numeric;
begin
  if v_name is null then
    v_subj := btrim(replace(replace(replace(v_subj, '{name}، ', ''), ' يا {name}', ''), '{name}', ''));
  else
    v_subj := replace(v_subj, '{name}', v_name);
  end if;
  subject := v_subj;

  select price_egp into v_semi_orig from plans where active and duration_months = 6 order by price_egp limit 1;
  v_semi_disc := round(coalesce(v_semi_orig, 1499) * 0.50);

  html := email_html(
    'مرحبًا' || coalesce(' ' || esc_html(v_name), '') || ' 👋',
    array[
      'هل تتذكر Biosyn؟ نحن نتذكرك 😄',
      'كنت من أوائل من سجّلوا معنا، وخلال الفترة الماضية أطلقنا <b>منصة Biosyn الجديدة</b>: دورات مسجلة وتفاعلية لطلاب كليات العلوم والصيدلة والبايوتكنولوجي والزراعة والطب والتمريض والعلوم الصحية، مع <b>شهادات برمز تحقق</b> تُضيفها لسيرتك الذاتية بثقة.',
      'مكانك محفوظ، ويكفي أن تفعّل حسابك على المنصة الجديدة بالبريد الإلكتروني نفسه، ولن يستغرق ذلك أكثر من دقيقة.',
      '<div dir="rtl" style="background:#f0ffd6;border:2px solid #c6f84a;border-radius:14px;padding:16px 20px;margin:4px 0">'
      || '<p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#010232">⭐ الباقة الأوفر: نصف سنوية (6 أشهر)</p>'
      || '<p style="margin:0 0 4px;font-size:14px;color:#1d2050">وصول كامل لجميع الدورات لمدة 6 أشهر متواصلة</p>'
      || '<p style="margin:0;font-size:17px;color:#010232"><s style="color:#888">' || to_char(coalesce(v_semi_orig, 1499), 'FM999,999') || ' ج.م</s>'
      || ' &nbsp;←&nbsp; <b style="color:#2d7a00;font-size:19px">' || to_char(v_semi_disc, 'FM999,999') || ' ج.م</b> فقط مع كود <b dir="ltr" style="letter-spacing:1px;color:#010232">biox</b></p>'
      || '</div>',
      'هدية لمن كانوا معنا من البداية: فعّل حسابك خلال <b>' || v_days || ' يومًا</b> لتحصل على:'
      || '<br>✦ <b>شارة «عضو مؤسس»</b> تظهر في حسابك وعلى شهاداتك بشكل دائم، ولن تُمنح مرة أخرى.'
      || '<br>✦ <b>خصم 50٪</b> على جميع الباقات باستخدام كود <b dir="ltr" style="font-size:17px;letter-spacing:1px">biox</b> عند الدفع.',
      '<a href="' || v_cta || '" target="_blank" style="display:inline-block;margin:6px 0 4px;padding:14px 30px;background:#c6f84a;border-radius:12px;font-size:16px;font-weight:700;color:#010232;text-decoration:none">فعّل حسابي واستخدم الكود ←</a>',
      '🤝 <b>ادعُ أصدقاءك واكسب:</b> بعد التفعيل ستجد رابط دعوة خاصًا بك. كل 3 أصدقاء يشتركون = <b>شهر مجاني لك</b>، و10 أصدقاء = <b>6 أشهر مجانًا</b>.',
      '👩‍🏫 <b>لديك خبرة في مجالك؟</b> يمكنك أيضًا الانضمام إلى Biosyn كمحاضر وتقديم دوراتك المسجلة أو التفاعلية لطلاب المنصة، مع نسبة من أرباحها. <a href="' || v_teach || '" target="_blank" style="color:#1d2050;font-weight:700;text-decoration:underline">قدّم كمحاضر من هنا</a>'
    ],
    null, null, v_unsub);
  html := replace(html, '</body>', '<img src="' || email_track_url(r.token) || '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0"></body>');
  return next;
end $function$;

create or replace function public.reactivation_blast(p_start timestamptz default null)
returns json
language plpgsql security definer set search_path = public
as $function$
declare
  r record; lu legacy_users; m record; v_var text; v_n int := 0; v_bad int := 0; v_linked int;
  v_start timestamptz := coalesce(p_start, now() + interval '30 seconds'); v_key text;
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated')) and not is_admin() then raise exception 'not allowed'; end if;
  v_linked := legacy_link_existing();   -- marks users who already signed up on the new platform as activated
  for r in
    select l.*, (row_number() over (order by l.priority desc, coalesce(l.last_active_at, l.legacy_created_at) desc nulls last, l.created_at) - 1) as i
      from legacy_users l
     where l.status in ('queued', 'sent')
       and btrim(l.email) ~* '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
       and not is_excluded_email(l.email)
       and not exists (select 1 from email_optouts o where o.email = lower(btrim(l.email)))
  loop
    v_var := coalesce(r.variant, case when abs(hashtext(lower(r.email))) % 2 = 0 then 'A' else 'B' end);
    select * into lu from legacy_users where id = r.id;
    select * into m from reactivation_mail(lu, v_var);
    v_key := 'reactivation-blast-1:' || r.id;
    perform enqueue_email(v_key, btrim(r.email), m.subject, m.html);
    update email_outbox set send_after = v_start + r.i * interval '1 second' + (r.i / 1000) * interval '10 minutes'
     where dedupe_key = v_key;
    update legacy_users set status = 'sent', sent_at = now(), variant = v_var where id = r.id;
    v_n := v_n + 1;
  end loop;
  update legacy_users set status = 'skipped', note = 'invalid email'
   where status = 'queued' and btrim(email) !~* '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$';
  get diagnostics v_bad = row_count;
  return json_build_object('queued', v_n, 'invalid', v_bad, 'newly_activated', v_linked, 'first_at', v_start,
    'last_at', v_start + greatest(v_n - 1, 0) * interval '1 second' + (greatest(v_n - 1, 0) / 1000) * interval '10 minutes');
end $function$;
revoke all on function public.reactivation_blast(timestamptz) from public, anon, authenticated;
