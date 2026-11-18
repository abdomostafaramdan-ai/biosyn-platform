-- Scheduled forms/exams + per-form rate limits (settings.max_per_minute, default 20 submissions / 40 starts a minute,
-- so a big class finishing an exam together is not turned away).
-- Scheduled forms/exams: settings.opens_at (no start or submit before it) and settings.closes_at (no new start after it;
-- an attempt already running may still be submitted up to total_minutes later). Both are ISO timestamps with a zone.
create or replace function public.form_window_ok(f forms, p_for_submit boolean default false)
returns void
language plpgsql stable set search_path = public
as $function$
declare v_open timestamptz := nullif(f.settings->>'opens_at', '')::timestamptz;
        v_close timestamptz := nullif(f.settings->>'closes_at', '')::timestamptz;
        v_grace interval := make_interval(mins => coalesce(nullif(f.settings->>'total_minutes', '')::int, 0) + 2);
begin
  if v_open is not null and now() < v_open then raise exception 'form not open yet'; end if;
  if not p_for_submit then v_grace := interval '0'; end if;
  if v_close is not null and now() > v_close + v_grace then raise exception 'form closed'; end if;
end $function$;

create or replace function public.form_start(p_slug text)
returns json
language plpgsql security definer set search_path = public
as $function$
declare f forms; v_id uuid;
begin
  select * into f from forms where slug = p_slug and active;
  if f.id is null then raise exception 'form not found'; end if;
  perform form_window_ok(f, false);
  if auth.uid() is not null and coalesce((f.settings->>'lock_on_leave')::boolean, false)
     and exists (select 1 from form_attempts where form_id = f.id and user_id = auth.uid() and (left_at is not null or submitted_at is not null)) then
    raise exception 'form locked';
  end if;
  if (select count(*) from form_attempts where form_id = f.id and started_at > now() - interval '1 minute') >= greatest(40, coalesce(nullif(f.settings->>'max_per_minute', '')::int, 0)) then raise exception 'too many submissions'; end if;
  insert into form_attempts (form_id, user_id) values (f.id, auth.uid()) returning id into v_id;
  return json_build_object('attempt', v_id, 'started_at', now());
end $function$;

create or replace function public.submit_form(p_slug text, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare f forms; fld jsonb; v text; clean jsonb := '{}'::jsonb; new_id uuid; meta jsonb; a form_attempts; v_left boolean; v_timed jsonb; v_sec int; v_late boolean := false;
begin
  select * into f from forms where slug = p_slug and active;
  if f.id is null then raise exception 'form not found'; end if;
  perform form_window_ok(f, true);
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then raise exception 'invalid data'; end if;
  if (select count(*) from form_submissions where form_id = f.id and created_at > now() - interval '1 minute') >= coalesce(nullif(f.settings->>'max_per_minute', '')::int, 20) then raise exception 'too many submissions'; end if;
  if not chat_hit('sf:' || f.id || ':' || coalesce(auth.uid()::text, nullif(current_setting('request.headers', true)::json->>'cf-connecting-ip', ''), split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'na'), ',', 1)), 40) then raise exception 'too many submissions'; end if;
  meta := case when jsonb_typeof(p_data->'__meta') = 'object' then p_data->'__meta' else '{}'::jsonb end;
  v_left := coalesce((meta->>'left_page')::boolean, false);
  v_timed := case when jsonb_typeof(meta->'timed_out') = 'array' then meta->'timed_out' else '[]'::jsonb end;
  if meta ? 'attempt' and (meta->>'attempt') ~ '^[0-9a-f-]{36}$' then
    select * into a from form_attempts where id = (meta->>'attempt')::uuid and form_id = f.id and submitted_at is null for update;
    if a.id is not null then
      v_sec := extract(epoch from now() - a.started_at)::int;
      v_late := (f.settings->>'total_minutes') is not null and v_sec > (f.settings->>'total_minutes')::int * 60 + 60;
      update form_attempts set submitted_at = now(), left_at = case when v_left then now() else left_at end where id = a.id;
    end if;
  end if;
  for fld in select * from jsonb_array_elements(f.fields) loop
    v := btrim(coalesce(p_data ->> (fld ->> 'id'), ''));
    if coalesce((fld ->> 'required')::boolean, false) and v = '' and not v_left and not (v_timed ? (fld ->> 'id')) then raise exception 'missing: %', fld ->> 'label'; end if;
    if v <> '' then clean := clean || jsonb_build_object(fld ->> 'label', left(v, 4000)); end if;
  end loop;
  if v_left then clean := clean || jsonb_build_object('⚠️ ملاحظة', 'غادر صاحب الرد الصفحة قبل الإكمال، فأُغلق النموذج وأُرسلت إجاباته حتى تلك اللحظة.'); end if;
  if jsonb_array_length(v_timed) > 0 then
    clean := clean || jsonb_build_object('⏱ أسئلة انتهى وقتها', (select string_agg(x->>'label', '، ') from jsonb_array_elements(f.fields) x where v_timed ? (x->>'id')));
  end if;
  if v_sec is not null then clean := clean || jsonb_build_object('⏱ المدة المستغرقة', (v_sec / 60) || ' دقيقة و' || (v_sec % 60) || ' ثانية' || case when v_late then ' (تجاوز الوقت المسموح)' else '' end); end if;
  insert into form_submissions (form_id, data, user_id) values (f.id, clean, auth.uid()) returning id into new_id;
  return new_id;
end $function$;

revoke all on function public.form_window_ok(forms, boolean) from public, anon, authenticated;
