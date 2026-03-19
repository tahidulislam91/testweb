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
  const postData = msg.data;

  if (sidebarPort) {
    // Sidebar is already open — send data directly through the port.
    // This avoids any storage timing race: the sidebar gets the data
    // immediately and calls startAnalysis without touching storage.
    try {
      sidebarPort.postMessage({ type: 'ANALYZE', data: postData });
    } catch (e) {
      sidebarPort = null;
      // Port was stale — fall through to storage + open approach below
      chrome.storage.local.set({ pendingPost: postData, pendingTimestamp: Date.now() });
      if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});
    }
  } else {
    // Sidebar is not open (or port not yet established).
    // Save to storage first so DOMContentLoaded can read it, THEN open panel.
    chrome.storage.local.set({ pendingPost: postData, pendingTimestamp: Date.now() }, () => {
      if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});
    });
  }
});
