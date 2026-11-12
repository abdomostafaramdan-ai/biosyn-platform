const F = "Tahoma,'Segoe UI',Arial,sans-serif", CU = '{{ .ConfirmationURL }}';
const P = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:27px;color:#1d2050">${t}</p>`;
const B = (l, h) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px"><tr><td align="center" bgcolor="#c6f84a" style="border-radius:12px"><a href="${h}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${F};font-size:16px;font-weight:700;color:#010232;text-decoration:none;border-radius:12px">${l}</a></td></tr></table>`;
const FB = (h) => `<p style="margin:14px 0 0;font-size:12px;line-height:20px;color:#5d6088">لو الزرار مش شغال، انسخ الرابط ده وافتحه في المتصفح:<br><a href="${h}" style="color:#3b3fd8;word-break:break-all" dir="ltr">${h}</a></p>`;
const C = (c) => `<div style="margin:18px 0;padding:16px;border-radius:12px;background:#f3f5ff;border:1px dashed #c7cdea;text-align:center"><span dir="ltr" style="font-family:Consolas,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#010232">${c}</span></div>`;
const N = (t) => `<p style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#f7f8fc;font-size:13px;line-height:22px;color:#5d6088">${t}</p>`;
const L = (pre, h, body) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Biosyn Eg</title></head>
<body style="margin:0;padding:0;background:#eef0f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f8"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:${F}" dir="rtl">
<tr><td align="center" bgcolor="#010232" style="background:#010232;padding:26px 24px 22px"><a href="https://biosyneg.com" target="_blank"><img src="https://biosyneg.com/img/email-logo.png" width="168" height="52" alt="BIOSYN" style="display:block;border:0;width:168px;height:auto;color:#ffffff;font-size:22px;font-weight:800"></a></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:#c6f84a">&nbsp;</td></tr>
<tr><td style="padding:30px 30px 10px;text-align:right">
<h1 style="margin:0 0 18px;font-size:22px;line-height:34px;color:#010232;font-weight:800">${h}</h1>
${body}
</td></tr>
<tr><td style="padding:22px 30px 26px;text-align:right"><hr style="border:none;border-top:1px solid #e5e7f2;margin:0 0 16px">
<p style="margin:0 0 6px;font-size:13px;line-height:21px;color:#010232;font-weight:700">Biosyn Eg · تعليم علمي وطبي بمحتوى مهني</p>
<p style="margin:0;font-size:12px;line-height:20px;color:#5d6088"><a href="https://biosyneg.com" style="color:#5d6088;text-decoration:underline">biosyneg.com</a> · <a href="mailto:contact@biosyneg.com" style="color:#5d6088;text-decoration:underline">contact@biosyneg.com</a><br>وصلك الإيميل ده لأن عندك حساب على منصة Biosyn Eg.</p>
</td></tr></table>
</td></tr></table></body></html>`;
const T = {
  'confirm-sign-up': ['أكّد حسابك في Biosyn Eg', L('خطوة واحدة وحسابك يبقى جاهز.', 'أهلاً بيك في Biosyn 👋', P('شكرًا إنك سجّلت على منصة Biosyn Eg. فاضل خطوة واحدة بس: أكّد إيميلك عشان نفعّل حسابك.') + B('أكّد حسابي', CU) + FB(CU) + N('بعد التأكيد تقدر تتصفّح الكورسات وتختار الباقة اللي تناسبك. لو ما عملتش الحساب ده، تجاهل الإيميل وماحدش هيقدر يستخدمه.'))],
  'reset-password': ['إعادة تعيين كلمة المرور · Biosyn', L('رابط تعيين كلمة مرور جديدة لحسابك.', 'نسيت كلمة المرور؟', P('وصلنا طلب لإعادة تعيين كلمة المرور الخاصة بحسابك <span dir="ltr">{{ .Email }}</span>. اضغط الزرار واختار كلمة مرور جديدة.') + B('تعيين كلمة مرور جديدة', CU) + FB(CU) + N('الرابط صالح لمدة محدودة ويُستخدم مرة واحدة. لو ما طلبتش ده، تجاهل الإيميل وكلمة المرور الحالية هتفضل زي ما هي.'))],
  'magic-link-or-otp': ['رابط الدخول لحسابك · Biosyn', L('ادخل حسابك بضغطة واحدة.', 'رابط الدخول لحسابك', P('اضغط الزرار عشان تدخل حسابك على Biosyn Eg من غير كلمة مرور.') + B('ادخل حسابي', CU) + FB(CU) + N('الرابط صالح لمدة محدودة ويُستخدم مرة واحدة. لو ما طلبتش الدخول، تجاهل الإيميل.'))],
  'invite-user': ['دعوة للانضمام لمنصة Biosyn Eg', L('اتدعيت تنضم لمنصة Biosyn Eg.', 'اتدعيت تنضم لـ Biosyn 🎉', P('فريق Biosyn Eg بيدعوك تنضم للمنصة. اضغط الزرار عشان تقبل الدعوة وتعمل كلمة المرور بتاعتك.') + B('اقبل الدعوة', CU) + FB(CU) + N('لو مش متوقع الدعوة دي، تقدر تتجاهل الإيميل.'))],
  'change-email-address': ['أكّد تغيير الإيميل · Biosyn', L('أكّد الإيميل الجديد لحسابك.', 'تأكيد تغيير الإيميل', P('طلبت تغيير إيميل حسابك على Biosyn من <span dir="ltr">{{ .Email }}</span> إلى <span dir="ltr">{{ .NewEmail }}</span>. اضغط الزرار عشان تأكد التغيير.') + B('أكّد الإيميل الجديد', CU) + FB(CU) + N('لو ما طلبتش التغيير ده، تجاهل الإيميل وغيّر كلمة المرور من الإعدادات احتياطيًا.'))],
  'reauthentication': ['كود التحقق: {{ .Token }}', L('كود التحقق الخاص بحسابك.', 'كود التحقق', P('استخدم الكود ده عشان تكمّل العملية اللي بدأتها على حسابك:') + C('{{ .Token }}') + N('الكود صالح لدقايق قليلة. ماتشاركش الكود ده مع أي حد، وفريق Biosyn عمره ما هيطلبه منك.'))],
};
window.__TPL = T;
window.__apply = () => {
  const k = location.pathname.split('/templates/')[1], t = window.__TPL[k];
  if (!t) return 'no template for ' + k;
  const md = monaco.editor.getModels()[0]; md.setValue(t[1]);
  const s = document.querySelector('input[name^=MAILER_SUBJECTS]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, t[0]);
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return { k, subject: s.value, ok: md.getValue() === t[1] };
};
window.__apply();
