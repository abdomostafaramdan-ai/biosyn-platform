-- BUNNY_TOKEN_KEYS holds one "libraryId=key" pair per Bunny library. Saving it from the admin panel MERGES:
-- new pairs replace the same library's old key and every other library keeps its key, so keys can be added one at a time.
-- "libraryId=" (empty key) removes that library; disconnect (empty value) still clears everything.
create or replace function public.set_integration_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_map jsonb := '{}'::jsonb; p text; k text; v text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if not (p_key = any(integration_keys())) then raise exception 'unknown key'; end if;
  if nullif(btrim(coalesce(p_value,'')),'') is null then
    delete from integration_secrets where key = p_key;
    return;
  end if;
  if p_key = 'BUNNY_TOKEN_KEYS' then
    select value into v_old from integration_secrets where key = p_key;
    for p in select btrim(x) from regexp_split_to_table(coalesce(v_old,'') || ',' || p_value, '[\n\r,;]+') x loop
      if p like '%=%' then
        k := btrim(split_part(p, '=', 1)); v := btrim(substr(p, strpos(p, '=') + 1));
        if k ~ '^[0-9]+$' then
          if v = '' then v_map := v_map - k; else v_map := v_map || jsonb_build_object(k, v); end if;
        end if;
      end if;
    end loop;
    p_value := (select string_agg(key || '=' || value, ',' order by key) from jsonb_each_text(v_map));
    if p_value is null then delete from integration_secrets where key = p_key; return; end if;
  end if;
  insert into integration_secrets (key, value, updated_at) values (p_key, btrim(p_value), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
