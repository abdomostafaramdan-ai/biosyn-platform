/* Admin → «المستخدمون» → «تحميل Excel»: every account with its subscription, payments and referral data,
   plus a second sheet with the users imported from the old platform (reactivation campaign). */
(function () {
  'use strict';
  let lib = null;
  const loadXlsx = () => lib || (lib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { lib = null; rej(new Error('تعذّر تحميل أداة Excel، تحقق من الاتصال وحاول مرة أخرى.')); }; document.head.appendChild(s); }));
  const d = (v) => (v ? new Date(v) : null);
  const ROLE = { student: 'طالب', instructor: 'محاضر', admin: 'مدير', staff: 'فريق العمل' };
  const ST = { queued: 'في الانتظار', sent: 'أُرسلت الدعوة', activated: 'فعّل حسابه', unsubscribed: 'ألغى الاشتراك', skipped: 'بريد غير صالح', failed: 'فشل' };
  window.exportUsersXlsx = async function (btn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التجهيز…';
    try {
      const [X, users, legacy] = await Promise.all([loadXlsx(), sb.rpc('admin_users_export'), sb.get('legacy_users', { select: 'email,full_name,phone,legacy_created_at,status,sent_at,activated_at,founding', order: 'legacy_created_at.desc', limit: 10000 }).catch(() => [])]);
      const rows = (users || []).map((u) => ({
        'الاسم': u.full_name || '', 'البريد الإلكتروني': u.email, 'الهاتف': u.phone || '', 'واتساب': u.whatsapp || '', 'الدولة': u.country || '', 'الدور': ROLE[u.role] || u.role,
        'تاريخ التسجيل': d(u.created_at), 'آخر دخول': d(u.last_sign_in_at), 'الباقة': u.plan || '', 'ينتهي الاشتراك': d(u.sub_ends_at), 'اشتراك فعّال': u.active_sub ? 'نعم' : 'لا',
        'إجمالي المدفوع (ج.م)': Number(u.paid_total_egp) || 0, 'عدد المدفوعات': u.payments, 'الدورات التفاعلية': u.enrollments, 'الشهادات': u.certificates,
        'كود الدعوة': u.ref_code || '', 'أصدقاء سجّلوا بدعوته': u.referred, 'من المنصة القديمة': u.legacy ? 'نعم' : 'لا', 'عضو مؤسس': u.founding ? 'نعم' : 'لا' }));
      const wb = X.utils.book_new();
      const add = (name, data) => {
        const ws = X.utils.json_to_sheet(data, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
        const keys = data.length ? Object.keys(data[0]) : [];
        ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(k.length + 2, ...data.slice(0, 300).map((r) => String(r[k] == null ? '' : r[k] instanceof Date ? '2026-01-01 00:00' : r[k]).length + 2))) }));
        ws['!autofilter'] = { ref: ws['!ref'] || 'A1' };
        wb.Workbook = wb.Workbook || { Views: [{ RTL: true }] };
        X.utils.book_append_sheet(wb, ws, name);
      };
      add('المستخدمون', rows.length ? rows : [{ 'الاسم': '' }]);
      if (legacy.length) add('المنصة القديمة', legacy.map((l) => ({ 'الاسم': l.full_name || '', 'البريد الإلكتروني': l.email, 'الهاتف': l.phone || '', 'تاريخ التسجيل القديم': d(l.legacy_created_at), 'حالة الدعوة': ST[l.status] || l.status, 'أُرسلت في': d(l.sent_at), 'فعّل في': d(l.activated_at), 'عضو مؤسس': l.founding ? 'نعم' : 'لا' })));
      X.writeFile(wb, `biosyn-users-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
      ui.toast(`تم تحميل ${rows.length} مستخدم${legacy.length ? ` و${legacy.length} من المنصة القديمة` : ''}`);
    } catch (e) { ui.toast(arErr(e), 'err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
})();
