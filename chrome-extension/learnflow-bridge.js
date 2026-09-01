const STORAGE_KEY = 'learnflowPendingSync';

async function deliverPendingSync() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const payload = stored[STORAGE_KEY];
  if (!payload?.items?.length) return;
  window.postMessage({ source: 'learnflow-chrome-extension', type: 'SYNC_XHS_ITEMS', payload }, location.origin);
}

window.addEventListener('message', async event => {
  if (event.source !== window || event.data?.source !== 'learnflow-web-app') return;
  if (event.data.type === 'SYNC_RECEIVED') await chrome.storage.local.remove(STORAGE_KEY);
});

deliverPendingSync();
document.addEventListener('visibilitychange', () => { if (!document.hidden) deliverPendingSync(); });
