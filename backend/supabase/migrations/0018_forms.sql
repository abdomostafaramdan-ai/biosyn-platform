-- Custom forms built in the admin dashboard; anyone can submit through submit_form(); staff read submissions.
create table if not exists forms (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title         text not null check (length(btrim(title)) between 2 and 120),
  description   text check (description is null or length(description) <= 2000),
  fields        jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  submit_label  text,
  success_message text,
  active        boolean not null default true,
  notify        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table forms enable row level security;
create policy forms_anon_read on forms for select to anon using (active);
create policy forms_auth_read on forms for select to authenticated using (active or is_staff());
create policy forms_admin_write on forms for all to authenticated using (is_admin()) with check (is_admin());

create table if not exists form_submissions (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid not null references forms(id) on delete cascade,
  data        jsonb not null,
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null default 'new' check (status in ('new','read','done')),
  created_at  timestamptz not null default now()
);
alter table form_submissions enable row level security;
create policy fs_staff_read on form_submissions for select to authenticated using (is_staff());
create policy fs_staff_update on form_submissions for update to authenticated using (is_staff()) with check (is_staff());
create policy fs_admin_delete on form_submissions for delete to authenticated using (is_admin());
create index if not exists form_submissions_form_idx on form_submissions (form_id, created_at desc);

-- public submit: validates required fields, caps size, light flood guard
create or replace function submit_form(p_slug text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare f forms; fld jsonb; v text; clean jsonb := '{}'::jsonb; new_id uuid;
begin
  select * into f from forms where slug = p_slug and active;
  if f.id is null then raise exception 'form not found'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then raise exception 'invalid data'; end if;
  if (select count(*) from form_submissions where form_id = f.id and created_at > now() - interval '1 minute') >= 20 then raise exception 'too many submissions'; end if;
  for fld in select * from jsonb_array_elements(f.fields) loop
    v := btrim(coalesce(p_data ->> (fld ->> 'id'), ''));
    if coalesce((fld ->> 'required')::boolean, false) and v = '' then raise exception 'missing: %', fld ->> 'label'; end if;
    if v <> '' then clean := clean || jsonb_build_object(fld ->> 'label', left(v, 4000)); end if;
  end loop;
  insert into form_submissions (form_id, data, user_id) values (f.id, clean, auth.uid()) returning id into new_id;
  return new_id;
end $$;
revoke execute on function submit_form(text, jsonb) from public;
grant execute on function submit_form(text, jsonb) to anon, authenticated;

-- team email + CRM lead for each submission
create or replace function trg_form_submission() returns trigger language plpgsql security definer set search_path = public as $$
declare f forms; lines text[] := array[]::text[]; k text; v text; v_email text; v_phone text; v_name text;
begin
  select * into f from forms where id = new.form_id;
  for k, v in select * from jsonb_each_text(new.data) loop
    lines := lines || (esc_html(k) || ': <b>' || esc_html(v) || '</b>');
    if v_email is null and v ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := v; end if;
    if v_phone is null and v ~ '^[+0-9 ()-]{8,20}$' then v_phone := v; end if;
    if v_name is null and (k ilike '%اسم%' or k ilike '%name%') then v_name := v; end if;
  end loop;
  if f.notify then
    perform notify_team('form:' || new.id, 'رد جديد على فورم: ' || f.title, email_html('رد جديد: ' || f.title, lines, 'عرض الردود', 'admin.html#forms'));
  end if;
  if v_email is not null or v_phone is not null then
    insert into crm_outbox (dedupe_key, kind, payload) values ('form:' || new.id, 'lead',
      jsonb_build_object('name', left(coalesce(v_name, ''), 80), 'email', coalesce(v_email, ''), 'phone', coalesce(v_phone, ''),
        'course', left('فورم: ' || f.title, 120), 'message', left(array_to_string(array(select k2 || ': ' || v2 from jsonb_each_text(new.data) as t(k2, v2)), ' | '), 480), 'src', 'الموقع'))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists form_submission_notify on form_submissions;
create trigger form_submission_notify after insert on form_submissions for each row execute function trg_form_submission();
revoke execute on function trg_form_submission() from public, anon, authenticated;
