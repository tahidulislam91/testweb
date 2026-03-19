// Content Analyzer AI - Sidebar Script
// The sidebar does the Claude API call directly (avoids service worker sleep issues)

const $ = id => document.getElementById(id);

let currentPostData = null;
let analysisEnabled = true;
let port = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connectPort();
  loadSettings();
  checkApiKey();
  bindEvents();
  showState('empty');

  // Check if there's already a pending post (e.g. sidebar was opened after click)
  checkPendingPost();
});

// ─── Port: just for receiving "NEW_POST" ping from background ─────────────────
function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'sidebar' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'NEW_POST') checkPendingPost();
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectPort, 1000);
    });
  } catch (e) {}
}

// ─── Read post from storage and trigger analysis ───────────────────────────────
function checkPendingPost() {
  chrome.storage.local.get(['pendingPost', 'pendingTimestamp'], (data) => {
    if (!data.pendingPost) return;
    // Ignore stale posts older than 30 seconds
    if (Date.now() - (data.pendingTimestamp || 0) > 30000) {
      chrome.storage.local.remove(['pendingPost', 'pendingTimestamp']);
      return;
    }
    chrome.storage.local.remove(['pendingPost', 'pendingTimestamp']);
    startAnalysis(data.pendingPost);
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

// ─── UI States ────────────────────────────────────────────────────────────────
function showState(state) {
  ['emptyState', 'loadingState', 'results', 'errorState'].forEach(id => $(id).classList.add('hidden'));
  const map = { empty: 'emptyState', loading: 'loadingState', results: 'results', error: 'errorState' };
  $(map[state]).classList.remove('hidden');
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
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_ANALYSIS_ENABLED', enabled: analysisEnabled }).catch(() => {});
      }
    });
  });

  $('toggleApiKey').addEventListener('click', () => {
    const inp = $('apiKeyInput');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('toggleApiKey').textContent = show ? 'Hide' : 'Show';
  });

  $('retryBtn').addEventListener('click', () => { if (currentPostData) startAnalysis(currentPostData); });
  $('analyzeAgain').addEventListener('click', () => { if (currentPostData) startAnalysis(currentPostData); });

  document.querySelectorAll('.section-header[data-target]').forEach(header => {
    header.addEventListener('click', () => {
      const body = $(header.getAttribute('data-target'));
      const chevron = header.querySelector('.chevron');
      body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open');
    });
  });
}

// ─── Analysis (runs entirely in sidebar, not background) ──────────────────────
async function startAnalysis(postData) {
  currentPostData = postData;
  showState('loading');

  $('step1').textContent = '📖 Reading content';
  $('step2').textContent = '🤖 AI analysis';
  $('step3').textContent = '✨ Done';
  updateLoadingStep(1);

  const settings = await new Promise(resolve => chrome.storage.sync.get(['apiKey', 'model'], resolve));

  if (!settings.apiKey) {
    showState('empty');
    $('noApiKey').classList.remove('hidden');
    $('settingsPanel').classList.remove('hidden');
    return;
  }

  try {
    updateLoadingStep(2);
    const result = await callClaude(postData, settings);
    updateLoadingStep(3);
    await sleep(100);
    renderResults(result, postData);
  } catch (err) {
    showError(err.message || 'Analysis failed. Please try again.');
  }
}

// ─── Claude API call (direct from sidebar page) ───────────────────────────────
async function callClaude(postData, settings) {
  const model = settings.model || 'claude-haiku-4-5-20251001';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: `You are an expert social media and content analyst.
Analyze content from any website in ANY language (especially Bangla and English).
Detect the language and respond in that same language.
If Bangla, write summary/subtext/emotionContext in Bangla.
Respond with valid JSON only. No markdown, no code fences.`,
      messages: [{
        role: 'user',
        content: `Analyze this content from ${postData.source || 'the web'}:

Site: ${postData.siteName || postData.pageTitle || postData.pageUrl || 'Unknown'}
Author: ${postData.author || 'Unknown'}
Content: """${postData.text}"""
${postData.images?.length ? `Images: ${postData.images.join(', ')}` : ''}

Return ONLY valid JSON:
{
  "detectedLanguage": "Bangla" or "English" or "Mixed",
  "summary": "2-3 sentence plain summary in the same language as the content.",
  "subtext": "What does the author really mean beneath the surface? Hidden intent, unspoken feelings. 2-3 sentences in same language.",
  "intents": ["4-6 short tags e.g.: Seeking Validation, Venting, Sharing News, Expressing Pride, Asking Help, Political Opinion, Humor, Promoting"],
  "emotions": [
    {"label": "Joy", "score": 0.0},
    {"label": "Anger", "score": 0.0},
    {"label": "Sadness", "score": 0.0},
    {"label": "Fear", "score": 0.0},
    {"label": "Surprise", "score": 0.0},
    {"label": "Trust", "score": 0.0},
    {"label": "Sarcasm", "score": 0.0},
    {"label": "Pride", "score": 0.0}
  ],
  "emotionContext": "1-2 sentences on emotional tone. Same language as content."
}
All 8 emotions required, scores 0.0-1.0.`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Please check your key in Settings ⚙️.');
    if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Unexpected AI response. Please try again.');

  const parsed = JSON.parse(match[0]);

  if (parsed.emotions) {
    parsed.emotions = parsed.emotions
      .filter(e => e.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return parsed;
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
