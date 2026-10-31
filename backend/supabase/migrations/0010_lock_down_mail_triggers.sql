revoke execute on function trg_mail_subscription(), trg_mail_enrollment(), trg_mail_certificate(), trg_mail_earning(), trg_mail_request() from public, anon, authenticated;
alter function esc_html(text) set search_path = public;
