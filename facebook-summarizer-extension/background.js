// Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
});

// Keep a reference to the sidebar port for live pings
let sidebarPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidebar') return;
  sidebarPort = port;
  port.onDisconnect.addListener(() => { sidebarPort = null; });
});

// Route POST_CLICKED from content script → sidebar
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'POST_CLICKED') return;

  // 1. Save to storage (reliable even if sidebar isn't open yet)
  chrome.storage.local.set({ pendingPost: msg.data, pendingTimestamp: Date.now() });

  // 2. Open sidebar
  const windowId = sender.tab?.windowId;
  if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});

  // 3. Ping sidebar if already open
  if (sidebarPort) {
    try { sidebarPort.postMessage({ type: 'NEW_POST' }); } catch (_) {}
  }
});
