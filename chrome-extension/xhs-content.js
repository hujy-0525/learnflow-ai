function cleanUrl(raw) {
  try {
    const url = new URL(raw, location.origin);
    if (!/xiaohongshu\.com$/i.test(url.hostname) && !/\.xiaohongshu\.com$/i.test(url.hostname)) return null;
    const accessParams = new URLSearchParams();
    ['xsec_token', 'xsec_source', 'source'].forEach(key => {
      if (url.searchParams.has(key)) accessParams.set(key, url.searchParams.get(key));
    });
    url.search = accessParams.toString();
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function extractNoteId(url) {
  return url.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/)?.[1] || null;
}

function compactText(value, max = 12000) {
  return value?.replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

function metaContent(...selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute('content');
    if (value?.trim()) return value.trim();
  }
  return null;
}

function firstText(selectors, max) {
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)];
    const value = nodes.map(node => compactText(node.innerText || node.textContent, max)).find(Boolean);
    if (value) return value;
  }
  return null;
}

function jsonLdNote() {
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(node.textContent);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const item = values.find(value => value && (value.headline || value.description || value.articleBody));
      if (item) return item;
    } catch {}
  }
  return {};
}

function scrapeDetailNote() {
  const sourceUrl = cleanUrl(location.href);
  const noteId = sourceUrl && extractNoteId(sourceUrl);
  if (!noteId) return null;

  const structured = jsonLdNote();
  const title = firstText([
    '#detail-title',
    '[class*="note-detail"] [class*="title"]',
    '[class*="note-content"] [class*="title"]',
    'article h1',
    'main h1'
  ], 300) || structured.headline || metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title;
  const body = firstText([
    '#detail-desc',
    '[class*="note-detail"] [class*="desc"]',
    '[class*="note-content"] [class*="desc"]',
    '[class*="content"] [class*="note-text"]',
    'article [class*="content"]'
  ], 12000) || structured.articleBody || structured.description || metaContent('meta[name="description"]', 'meta[property="og:description"]');
  const author = firstText([
    '[class*="note-detail"] [class*="author"] [class*="name"]',
    '[class*="author-container"] [class*="name"]',
    '[class*="user"] [class*="name"]'
  ], 120) || structured.author?.name || null;
  const detailImages = [...document.querySelectorAll('[class*="note-detail"] img, [class*="swiper"] img, [class*="carousel"] img, article img')]
    .map(image => image.currentSrc || image.src)
    .filter(url => /^https?:\/\//i.test(url))
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 9);
  const cover = metaContent('meta[property="og:image"]', 'meta[name="twitter:image"]') || detailImages[0] || null;
  if (cover && !detailImages.includes(cover)) detailImages.unshift(cover);
  const imageManifest = detailImages.length ? `\n\n[LEARNFLOW_IMAGE_URLS]\n${detailImages.slice(0, 9).join('\n')}` : '';

  return {
    source: 'xiaohongshu',
    source_url: sourceUrl,
    external_id: noteId,
    title: compactText(title, 300) || '小红书收藏笔记',
    author: compactText(author, 120),
    raw_content: `${compactText(body, 12000) || ''}${imageManifest}`.trim() || null,
    cover_url: cover,
    image_count: detailImages.slice(0, 9).length,
    sync_method: 'detail-page',
    processing_status: 'pending'
  };
}

function extractTitle(anchor) {
  const candidates = [
    anchor.getAttribute('title'),
    anchor.getAttribute('aria-label'),
    anchor.querySelector('[class*="title"]')?.textContent,
    anchor.closest('section,article,div[class*="note"]')?.querySelector('[class*="title"]')?.textContent,
    anchor.querySelector('img')?.alt
  ];
  return candidates.map(value => value?.trim()).find(value => value && value.length > 1) || '小红书收藏笔记';
}

function extractCardData(anchor) {
  const card = anchor.closest('section,article,div[class*="note"],div[class*="feeds"]') || anchor.parentElement;
  const author = card?.querySelector('[class*="author"],[class*="name"],[class*="user"]')?.textContent?.trim() || null;
  const visibleText = card?.innerText?.replace(/\s+/g, ' ').trim() || '';
  return { author, rawContent: visibleText.slice(0, 4000) || null };
}

function scrapeVisibleNotes() {
  const selectors = ['a[href*="/explore/"]', 'a[href*="/discovery/item/"]'];
  const found = new Map();
  document.querySelectorAll(selectors.join(',')).forEach(anchor => {
    const url = cleanUrl(anchor.href);
    const noteId = url && extractNoteId(url);
    const uniqueKey = noteId || url;
    if (!url || found.has(uniqueKey)) return;
    const image = anchor.querySelector('img');
    const cardData = extractCardData(anchor);
    found.set(uniqueKey, {
      source: 'xiaohongshu',
      source_url: url,
      external_id: noteId,
      title: extractTitle(anchor).slice(0, 300),
      author: cardData.author,
      raw_content: cardData.rawContent,
      cover_url: image?.src || null,
      sync_method: 'folder',
      processing_status: 'pending'
    });
  });
  return [...found.values()];
}

function scanCurrentPage() {
  const detail = scrapeDetailNote();
  if (detail?.raw_content) return { items: [detail], mode: 'detail', imageCount: detail.image_count || 0 };
  return { items: scrapeVisibleNotes(), mode: detail ? 'detail-limited' : 'collection' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'LEARNFLOW_SCAN_XHS') return;
  const result = scanCurrentPage();
  sendResponse({ ok: true, ...result, pageTitle: document.title, pageUrl: location.href });
});
