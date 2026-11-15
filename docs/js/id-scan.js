/* Identity document check at contract signing.
   Runs in the instructor's browser: compresses the photos, reads them with Tesseract OCR (Arabic for the Egyptian
   national ID, English for passports) and compares what it reads with the number the instructor typed.
   It never blocks a real card on its own: a card it can't read goes to manual review by the team.
   Only the verdict and scores are stored; the OCR text itself is discarded. */
(function () {
  'use strict';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const load = (src) => new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('ocr load')); document.head.appendChild(s); });

  // Egyptian national ID: C YYMMDD GG SSSS X (same rules as valid_egyptian_nid on the server)
  const GOV = ['01', '02', '03', '04', '11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '34', '35', '88'];
  const toLatin = (s) => String(s || '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
  function nidInfo(n) {
    n = toLatin(n).replace(/\D/g, '');
    if (!/^[23]\d{13}$/.test(n)) return null;
    const y = (n[0] === '2' ? 1900 : 2000) + +n.slice(1, 3), m = +n.slice(3, 5), d = +n.slice(5, 7);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    const age = (Date.now() - dt) / 31557600000;
    if (age < 16 || age > 100) return null;
    if (!GOV.includes(n.slice(7, 9))) return null;
    return { number: n, birth: dt.toISOString().slice(0, 10), gender: +n[12] % 2 ? 'male' : 'female' };
  }

  // photo → JPEG ≤ max px on the long side (what we upload) + a grey, contrast-stretched copy (what OCR reads)
  async function prepare(file, max = 1800) {
    if (!file || !/^image\//.test(file.type)) throw new Error('not image');
    const url = URL.createObjectURL(file);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
    URL.revokeObjectURL(url);
    const k = Math.min(1, max / Math.max(im.width, im.height)), w = Math.round(im.width * k), h = Math.round(im.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(im, 0, 0, w, h);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
    // OCR copy: ~1600px wide, greyscale, contrast stretched between the 2nd and 98th percentile
    const k2 = Math.min(2, 1600 / w), ow = Math.round(w * k2), oh = Math.round(h * k2);
    const oc = document.createElement('canvas'); oc.width = ow; oc.height = oh; const ctx = oc.getContext('2d');
    ctx.drawImage(cv, 0, 0, ow, oh);
    const img = ctx.getImageData(0, 0, ow, oh), px = img.data, hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) { const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0; px[i] = g; hist[g]++; }
    let lo = 0, hi = 255, acc = 0; const tot = px.length / 4;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > tot * 0.02) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > tot * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) { const g = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span)); px[i] = px[i + 1] = px[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    return { blob, width: im.width, height: im.height, ocr: oc, preview: cv.toDataURL('image/jpeg', 0.7) };
  }

  const workers = {};
  async function ocr(canvas, lang) {
    await load(TESS);
    if (!workers[lang]) workers[lang] = window.Tesseract.createWorker(lang, 1);
    const w = await workers[lang];
    const r = await w.recognize(canvas);
    return (r && r.data && r.data.text) || '';
  }

  const normAr = (s) => toLatin(s).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const KW = {
    front: ['جمهوريه', 'مصر', 'العربيه', 'بطاقه', 'تحقيق', 'الشخصيه'],
    back: ['الداخليه', 'وزاره', 'مصلحه', 'الاحوال', 'المدنيه', 'ساريه', 'النوع', 'الديانه', 'المهنه', 'الحاله', 'الاجتماعيه', 'متزوج', 'اعزب', 'مسلم', 'مسيحي', 'ذكر', 'انثي'],
    passport: ['PASSPORT', 'REPUBLIC', 'EGYPT', 'EGY', 'NATIONALITY', 'SURNAME', 'GIVEN', 'BIRTH', 'EXPIRY', 'جواز'],
  };
  const kwCount = (text, list) => list.filter((k) => text.includes(k)).length;
  // best digit agreement between any 14-digit run the OCR saw and the typed number
  function numScore(text, number) {
    let best = 0;
    for (const line of toLatin(text).split(/\n/)) {
      const d = line.replace(/\D/g, '');
      for (let i = 0; i + number.length <= d.length; i++) {
        let s = 0; for (let j = 0; j < number.length; j++) if (d[i + j] === number[j]) s++;
        if (s > best) best = s;
      }
    }
    return best;
  }

  // { type:'national_id'|'passport', number, front:prepared, back:prepared } → id_check object
  async function check({ type, number, front, back, onStep }) {
    const out = { engine: 'tesseract.js-5', type, at: new Date().toISOString(), front: {}, back: {} };
    const small = [front, back].some((p) => Math.max(p.width, p.height) < 500);
    if (small) { out.verdict = 'too_small'; return out; }
    const lang = type === 'passport' ? 'eng' : 'ara';
    onStep && onStep('front');
    const tf = await ocr(front.ocr, lang);
    onStep && onStep('back');
    const tb = await ocr(back.ocr, lang);
    if (type === 'passport') {
      const F = tf.toUpperCase(), B = tb.toUpperCase(), n = number.toUpperCase();
      out.front = { kw: kwCount(F, KW.passport), num: F.replace(/\s/g, '').includes(n) ? n.length : 0, mrz: /P<[A-Z]{3}/.test(F.replace(/\s/g, '')) };
      out.back = { kw: kwCount(B, KW.passport), num: B.replace(/\s/g, '').includes(n) ? n.length : 0 };
      const kw = out.front.kw + out.back.kw;
      out.verdict = (out.front.num || out.back.num) && (kw || out.front.mrz) ? 'match' : kw >= 2 || out.front.mrz ? 'card' : kw ? 'unclear' : 'not_card';
      return out;
    }
    const F = normAr(tf), B = normAr(tb);
    out.front = { kw: kwCount(F, KW.front), num: numScore(F, number) };
    out.back = { kw: kwCount(B, KW.back), num: numScore(B, number) };
    const kw = out.front.kw + out.back.kw, num = Math.max(out.front.num, out.back.num);
    out.verdict = num >= 13 && kw >= 1 ? 'match'
      : num >= 13 || out.front.kw >= 2 || (out.front.kw >= 1 && out.back.kw >= 1) ? 'card'
      : kw === 0 && num < 9 ? 'not_card' : 'unclear';
    return out;
  }

  window.IdScan = { nidInfo, toLatin, prepare, check };
})();
