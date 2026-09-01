function cleanUrl(raw) {
  try {
    const url = new URL(raw, location.origin);
    if (!/xiaohongshu\.com$/i.test(url.hostname) && !/\.xiaohongshu\.com$/i.test(url.hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return null; }
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

function scrapeVisibleNotes() {
  const selectors = ['a[href*="/explore/"]', 'a[href*="/discovery/item/"]'];
  const found = new Map();
  document.querySelectorAll(selectors.join(',')).forEach(anchor => {
    const url = cleanUrl(anchor.href);
    if (!url || found.has(url)) return;
    const image = anchor.querySelector('img');
    found.set(url, {
      source: 'xiaohongshu',
      source_url: url,
      title: extractTitle(anchor).slice(0, 300),
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
