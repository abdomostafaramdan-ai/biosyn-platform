-- Institutional requests must use an organisation email (no free/personal providers).
create or replace function is_personal_email(p_email text) returns boolean language sql immutable set search_path = public as $$
  select lower(split_part(btrim(coalesce(p_email, '')), '@', 2)) = any (array[
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com','hotmail.com','hotmail.co.uk','outlook.com','outlook.sa','live.com','msn.com',
    'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','yandex.com','yandex.ru','mail.ru','gmx.com','gmx.de','zoho.com','zohomail.com',
    'tutanota.com','tuta.io','mail.com','inbox.com','hushmail.com','qq.com','163.com','126.com','yahoo.fr','hotmail.fr','live.fr','windowslive.com'])
$$;
create or replace function trg_request_validate() returns trigger language plpgsql set search_path = public as $$
begin
  if new.type::text = 'institution' and is_personal_email(new.email) then
    raise exception 'institution email required' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists request_validate on requests;
create trigger request_validate before insert on requests for each row execute function trg_request_validate();
