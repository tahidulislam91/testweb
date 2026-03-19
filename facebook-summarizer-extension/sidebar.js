// Facebook Post Analyzer - Sidebar Script

const $ = id => document.getElementById(id);

let currentPostData = null;
let analysisEnabled = true;
let port = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connectToBackground();
  loadSettings();
  checkApiKey();
  bindEvents();
  showState('empty');
});

// ─── Port: Connect to background for reliable messaging ───────────────────────
function connectToBackground() {
  port = chrome.runtime.connect({ name: 'sidebar' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'ANALYZE_POST') {
      currentPostData = msg.data;
      analyzePost(msg.data);
    }
    if (msg.type === 'ANALYSIS_STEP') {
      updateLoadingStep(msg.step);
      $('loadingText').textContent = msg.text;
    }
    if (msg.type === 'ANALYSIS_COMPLETE') {
      renderResults(msg.data, msg.postData);
    }
    if (msg.type === 'ANALYSIS_ERROR') {
      showError(msg.message);
    }
  });

  port.onDisconnect.addListener(() => {
    // Reconnect if background wakes up
    setTimeout(connectToBackground, 500);
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'model', 'analysisEnabled'], (data) => {
    if (data.apiKey) $('apiKeyInput').value = data.apiKey;
    if (data.model) $('modelSelect').value = data.model;
    if (typeof data.analysisEnabled !== 'undefined') {
      analysisEnabled = data.analysisEnabled;
      updateToggleBtn();
    }
  });
}

function saveSettings() {
  const apiKey = $('apiKeyInput').value.trim();
  const model = $('modelSelect').value;
  chrome.storage.sync.set({ apiKey, model }, () => {
    $('settingsSaved').classList.remove('hidden');
    setTimeout(() => $('settingsSaved').classList.add('hidden'), 2000);
    checkApiKey();
  });
}

function checkApiKey() {
  chrome.storage.sync.get(['apiKey'], (data) => {
    $('noApiKey').classList.toggle('hidden', !!data.apiKey);
  });
}

// ─── States ───────────────────────────────────────────────────────────────────
function showState(state) {
  ['emptyState', 'loadingState', 'results', 'errorState'].forEach(id => $(id).classList.add('hidden'));
  $({ empty: 'emptyState', loading: 'loadingState', results: 'results', error: 'errorState' }[state]).classList.remove('hidden');
}

function updateLoadingStep(step) {
  ['step1', 'step2', 'step3'].forEach((id, i) => {
    const el = $(id);
    if (i + 1 < step) el.className = 'step done';
    else if (i + 1 === step) el.className = 'step active';
    else el.className = 'step';
  });
}

function updateToggleBtn() {
  const btn = $('toggleBtn');
  btn.classList.toggle('active', analysisEnabled);
  btn.title = analysisEnabled ? 'Click to pause analysis' : 'Click to resume analysis';
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  $('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
  $('closeSettings').addEventListener('click', () => $('settingsPanel').classList.add('hidden'));
  $('saveSettings').addEventListener('click', saveSettings);
  $('goToSettings').addEventListener('click', () => {
    $('settingsPanel').classList.remove('hidden');
    $('settingsPanel').scrollIntoView({ behavior: 'smooth' });
  });

  $('toggleBtn').addEventListener('click', () => {
    analysisEnabled = !analysisEnabled;
    chrome.storage.sync.set({ analysisEnabled });
    updateToggleBtn();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_ANALYSIS_ENABLED', enabled: analysisEnabled }).catch(() => {});
    });
  });

  $('toggleApiKey').addEventListener('click', () => {
    const inp = $('apiKeyInput');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('toggleApiKey').textContent = show ? 'Hide' : 'Show';
  });

  $('retryBtn').addEventListener('click', () => { if (currentPostData) analyzePost(currentPostData); });
  $('analyzeAgain').addEventListener('click', () => { if (currentPostData) analyzePost(currentPostData); });

  document.querySelectorAll('.section-header[data-target]').forEach(header => {
    header.addEventListener('click', () => {
      const body = $(header.getAttribute('data-target'));
      const chevron = header.querySelector('.chevron');
      body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open');
    });
  });
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
function analyzePost(postData) {
  currentPostData = postData;
  showState('loading');
  updateLoadingStep(1);
  $('step1').textContent = '📖 Reading post';
  $('step2').textContent = '🤖 AI analysis';
  $('step3').textContent = '✨ Done';
  // Ask background to run analysis
  chrome.runtime.sendMessage({ type: 'DO_ANALYSIS', data: postData });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderResults(analysis, postData) {
  const hasSource = postData.source || postData.siteName || postData.author;
  if (hasSource) {
    $('postSource').textContent = postData.source || postData.siteName || '';
    $('postAuthor').textContent = postData.author || '';
    $('postMeta').classList.remove('hidden');
  } else {
    $('postMeta').classList.add('hidden');
  }

  if (analysis.detectedLanguage) {
    const badge = $('langBadge');
    badge.textContent = analysis.detectedLanguage;
    badge.className = 'lang-badge ' + (
      analysis.detectedLanguage === 'Bangla' ? 'bangla' :
      analysis.detectedLanguage === 'Mixed' ? 'mixed' : 'english'
    );
  }

  $('originalText').textContent = postData.text || '';
  $('summaryText').textContent = analysis.summary || 'No summary available.';
  $('subtextText').textContent = analysis.subtext || '';
  renderIntentTags(analysis.intents || []);
  renderEmotionBars(analysis.emotions || []);
  $('emotionContext').textContent = analysis.emotionContext || '';

  showState('results');
}

function renderIntentTags(intents) {
  const container = $('intentTags');
  container.innerHTML = '';
  const colors = ['blue', 'purple', 'orange', 'green', 'red', 'yellow', 'gray'];
  intents.forEach((intent, i) => {
    const tag = document.createElement('span');
    tag.className = `tag ${colors[i % colors.length]}`;
    tag.textContent = intent;
    container.appendChild(tag);
  });
}

function renderEmotionBars(emotions) {
  const container = $('emotionBars');
  container.innerHTML = '';
  const colorMap = {
    joy: '#23c55e', anger: '#ef4444', sadness: '#3b82f6',
    fear: '#9333ea', surprise: '#f97316', trust: '#06b6d4',
    sarcasm: '#ec4899', pride: '#8b5cf6', neutral: '#9ca3af'
  };

  emotions.forEach(({ label, score }) => {
    const color = colorMap[label.toLowerCase()] || '#9ca3af';
    const pct = Math.round(score * 100);
    const row = document.createElement('div');
    row.className = 'emotion-row';
    row.innerHTML = `
      <span class="emotion-label">${label}</span>
      <div class="emotion-bar-track">
        <div class="emotion-bar-fill" style="width:0%;background:${color}" data-width="${pct}%"></div>
      </div>
      <span class="emotion-pct">${pct}%</span>
    `;
    container.appendChild(row);
  });

  requestAnimationFrame(() => {
    container.querySelectorAll('.emotion-bar-fill').forEach(bar => {
      bar.style.width = bar.getAttribute('data-width');
    });
  });
}

function showError(message) {
  $('errorMessage').textContent = message || 'An error occurred. Please try again.';
  showState('error');
}
