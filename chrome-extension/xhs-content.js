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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'LEARNFLOW_SCAN_XHS') return;
  const items = scrapeVisibleNotes();
  sendResponse({ ok: true, items, pageTitle: document.title, pageUrl: location.href });
});
