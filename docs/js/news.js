/* Home: «آراء طلابنا» auto-scrolling strip + latest «الأخبار والفعاليات». Page news.html: list + single item.
   Content is managed from admin → «الأخبار والفعاليات» and «آراء الطلاب». */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (s) => (window.t ? window.t(s) : s);
  const KIND = { news: 'خبر', event: 'فعالية' };
  const day = (d) => { try { return new Date(d).toLocaleDateString(window.LOC || 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return String(d).slice(0, 10); } };
  const when = (n) => (n.kind === 'event' && n.event_date ? n.event_date : n.published_at);
  const excerpt = (n) => n.summary || String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 180);

  function lightbox(list, i) {
    let k = i;
    const box = document.createElement('div'); box.className = 'nw-lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const draw = () => { box.innerHTML = `<img src="${esc(list[k])}" alt=""><button type="button" data-x aria-label="${t('إغلاق')}">✕</button>${list.length > 1 ? `<button type="button" class="nw-prev" data-p aria-label="${t('السابق')}">‹</button><button type="button" class="nw-next" data-n aria-label="${t('التالي')}">›</button>` : ''}`; };
    const close = () => { box.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') { k = (k + 1) % list.length; draw(); } if (e.key === 'ArrowRight') { k = (k - 1 + list.length) % list.length; draw(); } };
    box.onclick = (e) => { if (e.target === box || e.target.closest('[data-x]')) close(); else if (e.target.closest('[data-n]')) { k = (k + 1) % list.length; draw(); } else if (e.target.closest('[data-p]')) { k = (k - 1 + list.length) % list.length; draw(); } };
    document.addEventListener('keydown', key); draw(); document.body.appendChild(box); $('[data-x]', box).focus();
  }

  const card = (n) => `<a class="nw-card" href="news.html?id=${n.id}"><div class="nw-cover">${n.cover_url ? `<img src="${esc(n.cover_url)}" alt="" loading="lazy">` : ''}<span class="nw-kind ${n.kind === 'event' ? 'ev' : ''}">${KIND[n.kind]}</span></div>
    <div class="nw-body"><time>${day(when(n))}${n.location ? ' · ' + esc(n.location) : ''}</time><h3 dir="auto">${esc(n.title)}</h3><p dir="auto">${esc(excerpt(n))}</p></div></a>`;

  async function mountFeedback() {
    const box = $('[data-fb-strip]'); if (!box) return;
    let list = []; try { list = await sb.get('testimonials', { select: 'id,image_url,quote,author,role', visible: 'eq.true', order: 'sort.asc,created_at.asc' }); } catch (e) { list = []; }
    if (!list.length) { box.closest('section').hidden = true; return; }
    const imgs = list.filter((x) => x.image_url).map((x) => x.image_url);
    const cards = list.map((x) => x.image_url
      ? `<button type="button" class="bx-fb-card" data-img="${esc(x.image_url)}" aria-label="${t('عرض رأي الطالب')}"><img src="${esc(x.image_url)}" alt="${esc(x.author ? t('رأي') + ' ' + x.author : t('رأي أحد طلاب Biosyn'))}" loading="lazy"></button>`
      : `<div class="bx-fb-card bx-fb-text"><q dir="auto">${esc(x.quote)}</q>${x.author ? `<b dir="auto">${esc(x.author)}</b>` : ''}${x.role ? `<small dir="auto">${esc(x.role)}</small>` : ''}</div>`).join('');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = `<div class="bx-mq-track"><div class="bx-mq-half">${cards}</div>${reduce ? '' : `<div class="bx-mq-half" aria-hidden="true">${cards}</div>`}</div>`;
    box.classList.toggle('bx-mq-static', reduce);
    box.style.setProperty('--mq-dur', Math.max(30, list.length * 7) + 's');
    box.onclick = (e) => { const b = e.target.closest('[data-img]'); if (b) lightbox(imgs, Math.max(0, imgs.indexOf(b.dataset.img))); };
  }

  async function mountHomeNews() {
    const box = $('[data-news-home]'); if (!box) return;
    let list = []; try { list = await sb.get('news_items', { select: 'id,kind,title,summary,body,cover_url,event_date,location,published_at', visible: 'eq.true', order: 'featured.desc,published_at.desc', limit: 12 }); } catch (e) { list = []; }
    if (!list.length) { box.closest('section').hidden = true; return; }
    const cards = list.map(card).join(''), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = `<div class="bx-mq-track"><div class="bx-mq-half">${cards}</div>${reduce ? '' : `<div class="bx-mq-half" aria-hidden="true">${cards.replace(/<a /g, '<a tabindex="-1" ')}</div>`}</div>`;
    box.classList.toggle('bx-mq-static', reduce);
    box.style.setProperty('--mq-dur', Math.max(36, list.length * 9) + 's');
  }

  async function pageNews() {
    const root = $('#news'); if (!root) return;
    const id = new URLSearchParams(location.search).get('id');
    if (id && /^[0-9a-f-]{36}$/.test(id)) {
      let n = null; try { n = await sb.one('news_items', { select: '*', id: 'eq.' + id }); } catch (e) {}
      if (!n) { root.innerHTML = `<div class="bx-empty-big"><b>${t('لم نعثر على هذا الخبر')}</b><a class="bx-link" href="news.html">${t('كل الأخبار والفعاليات')}</a></div>`; return; }
      document.title = n.title + ' | Biosyn Eg';
      root.parentElement.querySelectorAll(':scope > h1, :scope > .bx-hint').forEach((e) => (e.hidden = true));
      const gal = Array.isArray(n.gallery) ? n.gallery : [];
      const paras = String(n.body || '').split(/\n+/).filter((p) => p.trim()).map((p) => `<p dir="auto">${esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a class="bx-link" href="$1" target="_blank" rel="noopener">$1</a>')}</p>`).join('');
      root.innerHTML = `<article class="nw-article"><nav class="bs-crumbs" aria-label="${t('مسار التنقل')}"><a href="index.html">${t('الرئيسية')}</a><span>/</span><a href="news.html">${t('الأخبار والفعاليات')}</a></nav>
        <div class="nw-meta"><span class="nw-kind ${n.kind === 'event' ? 'ev' : ''}">${KIND[n.kind]}</span><time>${day(when(n))}</time>${n.location ? `<span>· ${esc(n.location)}</span>` : ''}</div>
        <h1 dir="auto" style="margin:0 0 8px">${esc(n.title)}</h1>
        ${n.cover_url ? `<img class="nw-hero" src="${esc(n.cover_url)}" alt="">` : ''}
        <div class="nw-text">${paras}</div>
        ${n.video_url ? `<p><a class="bs-btn bs-btn-secondary" href="${esc(n.video_url)}" target="_blank" rel="noopener">${t('مشاهدة الفيديو')}</a></p>` : ''}
        ${gal.length ? `<h2 style="margin-top:32px">${t('صور من الحدث')}</h2><div class="nw-gallery">${gal.map((g, i) => `<button type="button" data-g="${i}" aria-label="${t('عرض الصورة')} ${i + 1}"><img src="${esc(g)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        <p style="margin-top:32px"><a class="bs-btn bs-btn-ghost" href="news.html">← ${t('كل الأخبار والفعاليات')}</a></p></article>`;
      root.onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) lightbox(gal, Number(b.dataset.g)); };
      return;
    }
    let list = []; try { list = await sb.get('news_items', { select: 'id,kind,title,summary,body,cover_url,event_date,location,published_at', visible: 'eq.true', order: 'published_at.desc', limit: 200 }); } catch (e) { root.innerHTML = `<div class="bx-empty-big"><b>${t('تعذّر التحميل')}</b></div>`; return; }
    let kind = new URLSearchParams(location.search).get('k') || '';
    const draw = () => {
      const l = list.filter((n) => !kind || n.kind === kind);
      root.innerHTML = `<div class="nw-chips">${[['', 'الكل'], ['news', 'الأخبار'], ['event', 'الفعاليات']].map(([k, l2]) => `<button class="bx-chip" aria-pressed="${k === kind}" data-k="${k}">${t(l2)}</button>`).join('')}</div>
        ${l.length ? `<div class="nw-grid">${l.map(card).join('')}</div>` : `<div class="bx-empty-big"><b>${t('لا توجد عناصر بعد')}</b></div>`}`;
    };
    root.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; draw(); } };
    draw();
  }

  const run = () => { mountFeedback(); mountHomeNews(); pageNews(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
