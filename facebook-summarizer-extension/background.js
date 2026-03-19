// Content Analyzer AI - Background Service Worker
// Responsibility: open sidepanel + route click events to sidebar

// ─── Open sidebar when extension icon is clicked ──────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
});

// ─── Port from sidebar ────────────────────────────────────────────────────────
// NOTE: Service workers can sleep and lose port references.
// We use storage as the reliable channel, port only as a wake signal.
let sidebarPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidebar') return;
  sidebarPort = port;
  port.onDisconnect.addListener(() => { sidebarPort = null; });
});

// ─── Route content clicks to sidebar ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'POST_CLICKED') return;

  const windowId = sender.tab?.windowId;

  // 1. Save post data to storage — sidebar reads from here
  chrome.storage.local.set({ pendingPost: msg.data, pendingTimestamp: Date.now() });

  // 2. Open the sidepanel
  if (windowId) {
    chrome.sidePanel.open({ windowId }).catch(() => {});
  }

  // 3. Ping sidebar via port if it's already open
  if (sidebarPort) {
    try { sidebarPort.postMessage({ type: 'NEW_POST' }); } catch (e) {}
  }
});
