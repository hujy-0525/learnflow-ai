const LEARNFLOW_URL = 'https://hujy-0525.github.io/learnflow-ai/?source=extension&v=xhs-link-fix-2';
const STORAGE_KEY = 'learnflowPendingSync';
const statusBox = document.getElementById('status');
const syncBtn = document.getElementById('syncBtn');
const resultBox = document.getElementById('result');
let scannedItems = [];
let scanMode = 'collection';

function setStatus(text, type = '') {
  statusBox.className = `status ${type}`;
  statusBox.querySelector('span').textContent = text;
}

async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('xiaohongshu.com')) {
    setStatus('请先打开小红书网页版收藏夹', 'error');
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'LEARNFLOW_SCAN_XHS' });
    scannedItems = response?.items || [];
    scanMode = response?.mode || 'collection';
    resultBox.hidden = false;
    document.getElementById('itemCount').textContent = scannedItems.length;
    syncBtn.disabled = !scannedItems.length;
    const successText = scanMode === 'detail' ? `已提取正文和 ${response?.imageCount || 0} 张图片` : '已识别当前页面收藏';
    const emptyText = scanMode === 'detail-limited' ? '当前笔记正文尚未加载，请稍等后重试' : '未发现已加载的收藏笔记';
    setStatus(scannedItems.length ? successText : emptyText, scannedItems.length ? 'ok' : 'error');
  } catch {
    setStatus('扩展尚未注入，请刷新小红书页面', 'error');
  }
}

syncBtn.onclick = async () => {
  const keywords = scanMode === 'detail' ? [] : document.getElementById('keywords').value.split(/[,，]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const filtered = keywords.length ? scannedItems.filter(item => keywords.some(key => item.title.toLowerCase().includes(key))) : scannedItems;
  if (!filtered.length) {
    setStatus('当前收藏中没有匹配关键词的标题', 'error');
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: { items: filtered, createdAt: Date.now() } });
  const tabs = await chrome.tabs.query({ url: 'https://hujy-0525.github.io/learnflow-ai/*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true, url: LEARNFLOW_URL });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: LEARNFLOW_URL });
  }
  window.close();
};

document.getElementById('openLearnFlow').onclick = () => chrome.tabs.create({ url: LEARNFLOW_URL });
scan();
