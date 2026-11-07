# Biosyn email design: one layout used by the platform's email_html() and the Supabase Auth templates.
LOGO = 'https://biosyneg.com/img/email-logo.png'
SITE = 'https://biosyneg.com'
NAVY, LIME, INK, MUTED, BG = '#010232', '#c6f84a', '#1d2050', '#5d6088', '#eef0f8'
FONT = "Tahoma,'Segoe UI',Arial,sans-serif"


def p(text):
    return f'<p style="margin:0 0 14px;font-size:15px;line-height:27px;color:{INK}">{text}</p>'


def button(label, href):
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px"><tr>'
            f'<td align="center" bgcolor="{LIME}" style="border-radius:12px">'
            f'<a href="{href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:{FONT};font-size:16px;'
            f'font-weight:700;color:{NAVY};text-decoration:none;border-radius:12px">{label}</a></td></tr></table>')


def fallback(href):
    return (f'<p style="margin:14px 0 0;font-size:12px;line-height:20px;color:{MUTED}">لو الزرار مش شغال، انسخ الرابط ده وافتحه في المتصفح:<br>'
            f'<a href="{href}" style="color:#3b3fd8;word-break:break-all" dir="ltr">{href}</a></p>')


def code(c):
    return (f'<div style="margin:18px 0;padding:16px;border-radius:12px;background:#f3f5ff;border:1px dashed #c7cdea;text-align:center">'
            f'<span dir="ltr" style="font-family:Consolas,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:{NAVY}">{c}</span></div>')


def note(text):
    return (f'<p style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#f7f8fc;font-size:13px;line-height:22px;color:{MUTED}">{text}</p>')


def layout(preheader, heading, body):
    return f'''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Biosyn Eg</title></head>
<body style="margin:0;padding:0;background:{BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{BG}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:{FONT}" dir="rtl">
<tr><td align="center" bgcolor="{NAVY}" style="background:{NAVY};padding:26px 24px 22px"><a href="{SITE}" target="_blank"><img src="{LOGO}" width="168" height="52" alt="BIOSYN" style="display:block;border:0;width:168px;height:auto;color:#ffffff;font-size:22px;font-weight:800"></a></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:{LIME}">&nbsp;</td></tr>
<tr><td style="padding:30px 30px 10px;text-align:right">
<h1 style="margin:0 0 18px;font-size:22px;line-height:34px;color:{NAVY};font-weight:800">{heading}</h1>
{body}
</td></tr>
<tr><td style="padding:22px 30px 26px;text-align:right"><hr style="border:none;border-top:1px solid #e5e7f2;margin:0 0 16px">
<p style="margin:0 0 6px;font-size:13px;line-height:21px;color:{NAVY};font-weight:700">Biosyn Eg · تعليم علمي وطبي بمحتوى مهني</p>
<p style="margin:0;font-size:12px;line-height:20px;color:{MUTED}"><a href="{SITE}" style="color:{MUTED};text-decoration:underline">biosyneg.com</a> · <a href="mailto:contact@biosynegypt.com" style="color:{MUTED};text-decoration:underline">contact@biosynegypt.com</a><br>وصلك الإيميل ده لأن عندك حساب على منصة Biosyn Eg.</p>
</td></tr></table>
</td></tr></table></body></html>'''


# ---------- Supabase Auth templates (Go template variables) ----------
CU = '{{ .ConfirmationURL }}'
AUTH = {
    'confirmation': ('أكّد حسابك في Biosyn Eg',
        layout('خطوة واحدة وحسابك يبقى جاهز.', 'أهلاً بيك في Biosyn 👋',
            p('شكرًا إنك سجّلت على منصة Biosyn Eg. فاضل خطوة واحدة بس: أكّد إيميلك عشان نفعّل حسابك.')
            + button('أكّد حسابي', CU) + fallback(CU)
            + note('بعد التأكيد تقدر تتصفّح الكورسات وتختار الباقة اللي تناسبك. لو ما عملتش الحساب ده، تجاهل الإيميل وماحدش هيقدر يستخدمه.'))),
    'recovery': ('إعادة تعيين كلمة المرور · Biosyn',
        layout('رابط تعيين كلمة مرور جديدة لحسابك.', 'نسيت كلمة المرور؟',
            p('وصلنا طلب لإعادة تعيين كلمة المرور الخاصة بحسابك <span dir="ltr">{{ .Email }}</span>. اضغط الزرار واختار كلمة مرور جديدة.')
            + button('تعيين كلمة مرور جديدة', CU) + fallback(CU)
            + note('الرابط صالح لمدة محدودة ويُستخدم مرة واحدة. لو ما طلبتش ده، تجاهل الإيميل وكلمة المرور الحالية هتفضل زي ما هي.'))),
    'magic_link': ('رابط الدخول لحسابك · Biosyn',
        layout('ادخل حسابك بضغطة واحدة.', 'رابط الدخول لحسابك',
            p('اضغط الزرار عشان تدخل حسابك على Biosyn Eg من غير كلمة مرور.')
            + button('ادخل حسابي', CU) + fallback(CU)
            + note('الرابط صالح لمدة محدودة ويُستخدم مرة واحدة. لو ما طلبتش الدخول، تجاهل الإيميل.'))),
    'invite': ('دعوة للانضمام لمنصة Biosyn Eg',
        layout('اتدعيت تنضم لمنصة Biosyn Eg.', 'اتدعيت تنضم لـ Biosyn 🎉',
            p('فريق Biosyn Eg بيدعوك تنضم للمنصة. اضغط الزرار عشان تقبل الدعوة وتعمل كلمة المرور بتاعتك.')
            + button('اقبل الدعوة', CU) + fallback(CU)
            + note('لو مش متوقع الدعوة دي، تقدر تتجاهل الإيميل.'))),
    'email_change': ('أكّد تغيير الإيميل · Biosyn',
        layout('أكّد الإيميل الجديد لحسابك.', 'تأكيد تغيير الإيميل',
            p('طلبت تغيير إيميل حسابك على Biosyn من <span dir="ltr">{{ .Email }}</span> إلى <span dir="ltr">{{ .NewEmail }}</span>. اضغط الزرار عشان تأكد التغيير.')
            + button('أكّد الإيميل الجديد', CU) + fallback(CU)
            + note('لو ما طلبتش التغيير ده، تجاهل الإيميل وغيّر كلمة المرور من الإعدادات احتياطيًا.'))),
    'reauthentication': ('كود التحقق: {{ .Token }}',
        layout('كود التحقق الخاص بحسابك.', 'كود التحقق',
            p('استخدم الكود ده عشان تكمّل العملية اللي بدأتها على حسابك:')
            + code('{{ .Token }}')
            + note('الكود صالح لدقايق قليلة. ماتشاركش الكود ده مع أي حد، وفريق Biosyn عمره ما هيطلبه منك.'))),
}

if __name__ == '__main__':
    import json, os, sys
    out = os.path.dirname(os.path.abspath(__file__))
    for k, (subj, html) in AUTH.items():
        open(os.path.join(out, f'auth_{k}.html'), 'w').write(html)
    json.dump({k: {'subject': s, 'html': h} for k, (s, h) in AUTH.items()}, open(os.path.join(out, 'auth.json'), 'w'), ensure_ascii=False)
    # sample of the platform layout (what email_html() will produce)
    sample = layout('تم تفعيل اشتراكك.', 'أهلاً بيك في Biosyn يا عبده 👋',
        p('تم استلام دفعتك وتفعيل <b>اشتراك شهري</b>. كل الكورسات المسجلة متاحة ليك من دلوقتي.')
        + p('المبلغ المدفوع: <b>200.00 ج.م</b> · رقم الإيصال: <b>1001</b>')
        + p('<b>🎁 اكسب شهور مجانية:</b> كل صديق يشترك من رابط دعوتك بياخد لك شهر مجاني.')
        + button('ابدأ أول كورس', SITE + '/courses.html'))
    open(os.path.join(out, 'sample_platform.html'), 'w').write(sample)
    print('ok')
