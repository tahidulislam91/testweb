// Facebook Post Analyzer - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  loadState();

  document.getElementById('openSidebar').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId });
      }
    });
    window.close();
  });

  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId });
      }
    });
    window.close();
  });

  document.getElementById('toggleAnalysis').addEventListener('click', () => {
    chrome.storage.sync.get(['analysisEnabled'], (data) => {
      const current = data.analysisEnabled !== false;
      const next = !current;
      chrome.storage.sync.set({ analysisEnabled: next }, () => {
        updateToggle(next);
        // Notify content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SET_ANALYSIS_ENABLED',
              enabled: next
            }).catch(() => {});
          }
        });
      });
    });
  });
});

function loadState() {
  chrome.storage.sync.get(['analysisEnabled', 'apiKey'], (data) => {
    const enabled = data.analysisEnabled !== false;
    updateToggle(enabled);

    const apiStatusEl = document.getElementById('apiStatus');
    if (!data.apiKey) {
      apiStatusEl.textContent = '⚠️ No API key set — open Settings to add your Claude API key';
      apiStatusEl.className = 'api-status missing';
      apiStatusEl.classList.remove('hidden');
    } else {
      apiStatusEl.textContent = '✓ Claude API key configured';
      apiStatusEl.className = 'api-status set';
      apiStatusEl.classList.remove('hidden');
    }
  });
}

function updateToggle(enabled) {
  const statusRow = document.getElementById('statusRow');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const toggleBtn = document.getElementById('toggleAnalysis');

  if (enabled) {
    statusRow.className = 'status-row';
    statusDot.className = 'status-dot';
    statusText.textContent = 'Active — Click any post';
    toggleBtn.textContent = '⏸ Pause Analysis';
  } else {
    statusRow.className = 'status-row off';
    statusDot.className = 'status-dot off';
    statusText.textContent = 'Paused — Analysis disabled';
    toggleBtn.textContent = '▶ Resume Analysis';
  }
}
