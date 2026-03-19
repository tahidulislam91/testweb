// Facebook Post Analyzer - Sidebar Script

const $ = id => document.getElementById(id);

// ─── State ───────────────────────────────────────────────────────────────────
let currentPostData = null;
let analysisEnabled = true;
let lastAnalysis = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkApiKey();
  bindEvents();
  showState('empty');
});

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'serpApiKey', 'model', 'analysisEnabled'], (data) => {
    if (data.apiKey) $('apiKeyInput').value = data.apiKey;
    if (data.serpApiKey) $('serpApiKeyInput').value = data.serpApiKey;
    if (data.model) $('modelSelect').value = data.model;
    if (typeof data.analysisEnabled !== 'undefined') {
      analysisEnabled = data.analysisEnabled;
      updateToggleBtn();
    }
  });
}

function saveSettings() {
  const apiKey = $('apiKeyInput').value.trim();
  const serpApiKey = $('serpApiKeyInput').value.trim();
  const model = $('modelSelect').value;

  chrome.storage.sync.set({ apiKey, serpApiKey, model }, () => {
    $('settingsSaved').classList.remove('hidden');
    setTimeout(() => $('settingsSaved').classList.add('hidden'), 2000);
    checkApiKey();
  });
}

function checkApiKey() {
  chrome.storage.sync.get(['apiKey'], (data) => {
    if (!data.apiKey) {
      $('noApiKey').classList.remove('hidden');
    } else {
      $('noApiKey').classList.add('hidden');
    }
  });
}

// ─── UI State Machine ─────────────────────────────────────────────────────────
function showState(state) {
  ['emptyState', 'loadingState', 'results', 'errorState'].forEach(id => {
    $(id).classList.add('hidden');
  });
  if (state === 'empty') $('emptyState').classList.remove('hidden');
  if (state === 'loading') $('loadingState').classList.remove('hidden');
  if (state === 'results') $('results').classList.remove('hidden');
  if (state === 'error') $('errorState').classList.remove('hidden');
}

function updateLoadingStep(step) {
  const steps = ['step1', 'step2', 'step3', 'step4'];
  steps.forEach((id, i) => {
    const el = $(id);
    if (i + 1 < step) {
      el.className = 'step done';
      el.textContent = '✓ ' + el.textContent.replace('✓ ', '');
    } else if (i + 1 === step) {
      el.className = 'step active';
    } else {
      el.className = 'step';
    }
  });
}

// ─── Toggle Button ────────────────────────────────────────────────────────────
function updateToggleBtn() {
  const btn = $('toggleBtn');
  if (analysisEnabled) {
    btn.classList.add('active');
    btn.title = 'Click to pause analysis';
  } else {
    btn.classList.remove('active');
    btn.title = 'Click to resume analysis';
  }
}

// ─── Event Bindings ───────────────────────────────────────────────────────────
function bindEvents() {
  $('settingsBtn').addEventListener('click', () => {
    $('settingsPanel').classList.toggle('hidden');
  });

  $('closeSettings').addEventListener('click', () => {
    $('settingsPanel').classList.add('hidden');
  });

  $('saveSettings').addEventListener('click', saveSettings);

  $('goToSettings').addEventListener('click', () => {
    $('settingsPanel').classList.remove('hidden');
    $('settingsPanel').scrollIntoView({ behavior: 'smooth' });
  });

  $('toggleBtn').addEventListener('click', () => {
    analysisEnabled = !analysisEnabled;
    chrome.storage.sync.set({ analysisEnabled });
    updateToggleBtn();
    // Tell content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_ANALYSIS_ENABLED',
          enabled: analysisEnabled
        }).catch(() => {});
      }
    });
  });

  $('toggleApiKey').addEventListener('click', () => {
    const inp = $('apiKeyInput');
    if (inp.type === 'password') { inp.type = 'text'; $('toggleApiKey').textContent = 'Hide'; }
    else { inp.type = 'password'; $('toggleApiKey').textContent = 'Show'; }
  });

  $('toggleSerpKey').addEventListener('click', () => {
    const inp = $('serpApiKeyInput');
    if (inp.type === 'password') { inp.type = 'text'; $('toggleSerpKey').textContent = 'Hide'; }
    else { inp.type = 'password'; $('toggleSerpKey').textContent = 'Show'; }
  });

  $('retryBtn').addEventListener('click', () => {
    if (currentPostData) analyzePost(currentPostData);
  });

  $('analyzeAgain').addEventListener('click', () => {
    if (currentPostData) analyzePost(currentPostData);
  });

  // Collapsible sections
  document.querySelectorAll('.section-header[data-target]').forEach(header => {
    header.addEventListener('click', () => {
      const targetId = header.getAttribute('data-target');
      const body = $(targetId);
      const chevron = header.querySelector('.chevron');
      body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open');
    });
  });
}

// ─── Listen for messages from background ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
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

// ─── Analyze ──────────────────────────────────────────────────────────────────
function analyzePost(postData) {
  currentPostData = postData;
  showState('loading');
  updateLoadingStep(1);

  // Reset loading steps text
  $('step1').textContent = '📖 Reading post';
  $('step2').textContent = '🤖 AI analysis';
  $('step3').textContent = '🌐 Fact-checking';
  $('step4').textContent = '✨ Finalizing';

  chrome.runtime.sendMessage({ type: 'DO_ANALYSIS', data: postData });
}

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(analysis, postData) {
  // Post meta
  if (postData.author || postData.timestamp) {
    $('postAuthor').textContent = postData.author || '';
    $('postTime').textContent = postData.timestamp || '';
    $('postMeta').classList.remove('hidden');
  } else {
    $('postMeta').classList.add('hidden');
  }

  // Original text
  $('originalText').textContent = postData.text || '';

  // Summary
  $('summaryText').textContent = analysis.summary || 'No summary available.';

  // Subtext & Intent
  $('subtextText').textContent = analysis.subtext || '';
  renderIntentTags(analysis.intents || []);

  // Emotions
  renderEmotionBars(analysis.emotions || []);
  $('emotionContext').textContent = analysis.emotionContext || '';

  // Fact Check
  renderFactCheck(analysis.factCheck);

  showState('results');
  lastAnalysis = analysis;
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
    joy: '#23c55e',
    anger: '#ef4444',
    sadness: '#3b82f6',
    fear: '#9333ea',
    surprise: '#f97316',
    disgust: '#84cc16',
    trust: '#06b6d4',
    anticipation: '#f59e0b',
    neutral: '#9ca3af',
    sarcasm: '#ec4899',
    humor: '#fbbf24',
    pride: '#8b5cf6',
  };

  emotions.forEach(({ label, score }) => {
    const color = colorMap[label.toLowerCase()] || '#9ca3af';
    const pct = Math.round(score * 100);
    const row = document.createElement('div');
    row.className = 'emotion-row';
    row.innerHTML = `
      <span class="emotion-label">${capitalize(label)}</span>
      <div class="emotion-bar-track">
        <div class="emotion-bar-fill" style="width:0%; background:${color}" data-width="${pct}%"></div>
      </div>
      <span class="emotion-pct">${pct}%</span>
    `;
    container.appendChild(row);
  });

  // Animate bars after render
  requestAnimationFrame(() => {
    container.querySelectorAll('.emotion-bar-fill').forEach(bar => {
      bar.style.width = bar.getAttribute('data-width');
    });
  });
}

function renderFactCheck(factCheck) {
  if (!factCheck) {
    $('factCheckBadge').textContent = '';
    $('factCheckBadge').className = 'status-badge';
    $('factCheckText').textContent = 'Could not perform fact check.';
    return;
  }

  const badge = $('factCheckBadge');
  badge.textContent = factCheck.verdict || '';
  badge.className = 'status-badge ' + (factCheck.verdictClass || 'ai');

  $('factCheckText').textContent = factCheck.summary || '';

  // Sources
  const sourcesEl = $('factCheckSources');
  sourcesEl.innerHTML = '';
  if (factCheck.sources && factCheck.sources.length > 0) {
    factCheck.sources.forEach(src => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.innerHTML = `
        <div>
          <a href="${escapeHtml(src.url)}" target="_blank">${escapeHtml(src.title || src.url)}</a>
          ${src.snippet ? `<div class="source-snippet">${escapeHtml(src.snippet)}</div>` : ''}
        </div>
      `;
      sourcesEl.appendChild(item);
    });
    $('factCheckNote').classList.add('hidden');
  } else {
    if (factCheck.aiOnly) {
      $('factCheckNote').classList.remove('hidden');
    } else {
      $('factCheckNote').classList.add('hidden');
    }
  }
}

// ─── Error ────────────────────────────────────────────────────────────────────
function showError(message) {
  $('errorMessage').textContent = message || 'An error occurred. Please try again.';
  showState('error');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
