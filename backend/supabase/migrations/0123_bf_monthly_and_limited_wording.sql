-- 0123: Black Friday — monthly plan added to the offer (BIOSYN covers all plans, cap 500 set from the dashboard).
-- E-mails, popup and page say «المقاعد محدودة» (true: the code is capped) instead of a specific number;
-- the page shows the real seats left only once fewer than 100 remain. Applied live as a text patch of bf_wave()/bf_popup().
update coupons set note = 'Black Friday 27 Nov · 70% كل الباقات · حد 500 · من 2 ظهرًا لـ 11:59 م' where code = 'BIOSYN';
