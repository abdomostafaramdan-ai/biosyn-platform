-- Referral notifications/emails now point at the student's «شهر مجاني» page (account.html#invite) instead of settings.
do $$
declare f text; d text; d0 text;
begin
  foreach f in array array['trg_mail_subscription()', 'trg_referral_reward()', 'trg_welcome_user()', 'enqueue_expiry_reminders()'] loop
    d := pg_get_functiondef(f::regprocedure); d0 := d;
    d := replace(d, 'انسخ رابطك من الإعدادات.'', ''account.html#settings''', 'انسخ رابطك من صفحة «شهر مجاني» في حسابك.'', ''account.html#invite''');
    d := replace(d, '''n:refq:'' || new.user_id, ''gift'', ''صاحبك اشترك من رابطك 🎉'', referral_progress_text(v_referrer), ''account.html#settings''',
                    '''n:refq:'' || new.user_id, ''gift'', ''صاحبك اشترك من رابطك 🎉'', referral_progress_text(v_referrer), ''account.html#invite''');
    d := replace(d, 'واشتراكك اتمدّ مجانًا لحد '' || v_end || ''.'', ''account.html#settings''', 'واشتراكك اتمدّ مجانًا لحد '' || v_end || ''.'', ''account.html#invite''');
    if d <> d0 then execute d; end if;
  end loop;
end $$;
revoke execute on function trg_mail_subscription(), trg_referral_reward(), trg_welcome_user() from public, anon, authenticated;
