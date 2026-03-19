// Content Analyzer AI - Sidebar Script

const $ = id => document.getElementById(id);

let currentPostData = null;
let lastAnalysis = null;
let analysisEnabled = true;
let port = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connectPort();
  loadSettings();
  checkApiKey();
  bindEvents();
  showState('empty');
  checkPendingPost();
});

// ─── Port: ping from background when new post is clicked ─────────────────────
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

// ─── Read pending post from storage ──────────────────────────────────────────
function checkPendingPost() {
  chrome.storage.local.get(['pendingPost', 'pendingTimestamp'], (data) => {
    if (!data.pendingPost) return;
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

function updateToggleBtn() {
  $('toggleBtn').classList.toggle('active', analysisEnabled);
  $('toggleBtn').title = analysisEnabled ? 'Click to pause' : 'Click to resume';
}

// ─── Collapsible sections ─────────────────────────────────────────────────────
function bindCollapsibles() {
  document.querySelectorAll('.section-header[data-target]').forEach(header => {
    // Remove old listener by cloning
    const fresh = header.cloneNode(true);
    header.parentNode.replaceChild(fresh, header);
    fresh.addEventListener('click', (e) => {
      // Don't toggle when clicking copy button
      if (e.target.closest('.section-copy-btn')) return;
      const body = $(fresh.getAttribute('data-target'));
      const chevron = fresh.querySelector('.chevron');
      const isCollapsed = body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open', !isCollapsed);
    });
  });
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

  $('retryBtn').addEventListener('click', () => { if (currentPostData) startAnalysis(currentPostData); });
  $('analyzeAgain').addEventListener('click', () => { if (currentPostData) startAnalysis(currentPostData); });
  $('shareBtn').addEventListener('click', shareAnalysis);
  $('copyAllBtn').addEventListener('click', copyFullAnalysis);

  // Section copy buttons — use event delegation so it works after cloneNode rebinds
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.section-copy-btn');
    if (!btn) return;
    e.stopPropagation();
    const sectionId = btn.getAttribute('data-copy-section');
    if (sectionId) copySectionText(sectionId, btn);
  });

  bindCollapsibles();
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
async function startAnalysis(postData) {
  currentPostData = postData;
  showState('loading');
  $('loadingText').textContent = 'Analyzing content...';

  const settings = await new Promise(resolve => chrome.storage.sync.get(['apiKey', 'model'], resolve));

  if (!settings.apiKey) {
    showState('empty');
    $('noApiKey').classList.remove('hidden');
    $('settingsPanel').classList.remove('hidden');
    return;
  }

  try {
    const result = await callClaude(postData, settings);
    lastAnalysis = result;
    renderResults(result, postData);
  } catch (err) {
    showError(err.message || 'Analysis failed. Please try again.');
  }
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(postData, settings) {
  const model = settings.model || 'claude-haiku-4-5-20251001';

  // Build the prompt with clear JSON schema — no inline examples inside arrays
  const systemPrompt = `You are an expert content analyst, psychologist, and critical thinking coach.
You analyze web content from any language (especially Bangla and English).
Detect the content language and write analysis fields in that same language.
You MUST return only a valid raw JSON object. No markdown. No code fences. No explanation outside JSON.`;

  const userPrompt = `Analyze the following content and return a single valid JSON object.

SOURCE: ${postData.source || 'Web'}
SITE: ${postData.siteName || postData.pageTitle || ''}
AUTHOR: ${postData.author || 'Unknown'}
CONTENT:
"""
${postData.text}
"""

Return this exact JSON structure with no extra text:
{
  "language": "English",
  "summary": "Write 2-3 sentences summarizing what this content says. Use the same language as the content.",
  "subtext": "Write 2-3 sentences about what the author really means beneath the surface. What are they not saying directly? What do they want readers to feel or think?",
  "intents": ["intent tag 1", "intent tag 2", "intent tag 3", "intent tag 4"],
  "redFlags": [
    {
      "type": "Overgeneralization",
      "quote": "exact short phrase from content",
      "explanation": "why this is a red flag"
    }
  ],
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
  "emotionContext": "1-2 sentences explaining the emotional tone."
}

Rules:
- "language" must be exactly: "Bangla", "English", or "Mixed"
- "summary", "subtext", "emotionContext" must be in the same language as the content
- "intents" must be an array of 3-5 short phrase strings (no commas inside a string)
  Examples of intent tags: Seeking Validation, Expressing Pride, Sharing News, Political Opinion, Venting Frustration, Promoting Product, Asking Help, Humor, Sarcasm, Spreading Fear
- "redFlags" must be an array of objects. Include only real issues found. Can be empty array [].
  Valid "type" values: Overgeneralization, Probable False Claim, Opinion Stated as Fact, Emotional Manipulation, Bias, Missing Context, Clickbait, Conspiracy Theory, Hate Speech
- All 8 emotion scores are required, values between 0.0 and 1.0
- Return ONLY the JSON object, nothing else`;

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
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Please check your key in Settings ⚙️.');
    if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text || '';

  // Extract JSON — strip any accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response. Please try again.');

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error('AI returned malformed JSON. Please try again.');
  }

  // Filter and sort emotions
  if (Array.isArray(parsed.emotions)) {
    parsed.emotions = parsed.emotions
      .filter(e => typeof e.score === 'number' && e.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return parsed;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderResults(analysis, postData) {
  // Source meta bar
  if (postData.source || postData.author) {
    $('sourceLabel').textContent = [postData.source, postData.author].filter(Boolean).join(' · ');
    $('sourceMeta').classList.remove('hidden');
  } else {
    $('sourceMeta').classList.add('hidden');
  }

  // Language badge
  const lang = analysis.language || '';
  const badge = $('langBadge');
  badge.textContent = lang;
  badge.className = 'lang-badge ' + (lang === 'Bangla' ? 'bangla' : lang === 'Mixed' ? 'mixed' : 'english');

  // Original text
  $('originalText').textContent = postData.text || '';

  // Summary
  $('summaryText').textContent = analysis.summary || '';

  // Subtext
  $('subtextText').textContent = analysis.subtext || '';

  // Intent tags
  renderIntentTags(analysis.intents || []);

  // Red flags
  renderRedFlags(analysis.redFlags || []);

  // Emotions
  renderEmotionBars(analysis.emotions || []);
  $('emotionContext').textContent = analysis.emotionContext || '';

  showState('results');
  // Re-bind collapsibles after results are shown
  bindCollapsibles();
}

function renderIntentTags(intents) {
  const container = $('intentTags');
  container.innerHTML = '';
  const colors = ['blue', 'purple', 'orange', 'green', 'gray', 'yellow'];
  intents.forEach((intent, i) => {
    if (typeof intent !== 'string') return;
    const tag = document.createElement('span');
    tag.className = `tag ${colors[i % colors.length]}`;
    tag.textContent = intent.trim();
    container.appendChild(tag);
  });
}

function renderRedFlags(flags) {
  const box = $('redFlagsBox');
  const list = $('redFlagsList');
  list.innerHTML = '';

  const valid = flags.filter(f => f && f.type);
  if (valid.length === 0) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');

  const typeColors = {
    'Overgeneralization': 'orange',
    'Probable False Claim': 'red',
    'Opinion Stated as Fact': 'yellow',
    'Emotional Manipulation': 'red',
    'Bias': 'orange',
    'Missing Context': 'yellow',
    'Clickbait': 'orange',
    'Conspiracy Theory': 'red',
    'Hate Speech': 'red'
  };

  valid.forEach(flag => {
    const color = typeColors[flag.type] || 'orange';
    const item = document.createElement('div');
    item.className = 'redflag-item';
    item.innerHTML = `
      <span class="tag ${color} redflag-tag">${escapeHtml(flag.type)}</span>
      ${flag.quote ? `<div class="redflag-quote">"${escapeHtml(flag.quote)}"</div>` : ''}
      ${flag.explanation ? `<div class="redflag-explanation">${escapeHtml(flag.explanation)}</div>` : ''}
    `;
    list.appendChild(item);
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
    const color = colorMap[(label || '').toLowerCase()] || '#9ca3af';
    const pct = Math.round((score || 0) * 100);
    const row = document.createElement('div');
    row.className = 'emotion-row';
    row.innerHTML = `
      <span class="emotion-label">${escapeHtml(label)}</span>
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

// ─── Share (original) ─────────────────────────────────────────────────────────
function shareAnalysis() {
  if (!lastAnalysis || !currentPostData) return;
  const a = lastAnalysis;
  const flags = (a.redFlags || []).map(f => `  🚩 ${f.type}: "${f.quote}" — ${f.explanation}`).join('\n');
  const emotions = (a.emotions || []).map(e => `  ${e.label}: ${Math.round(e.score * 100)}%`).join('\n');
  const intents = (a.intents || []).join(', ');

  const lines = [
    `📊 Facebook Post Analysis`,
    `─────────────────────────`,
    `👤 ${currentPostData.author || 'Unknown'}  •  ${new Date().toLocaleDateString()}`,
    ``,
    `📝 Summary`,
    a.summary || '',
    ``,
    `💭 Subtext & Intent`,
    a.subtext || '',
    intents ? `Tags: ${intents}` : '',
    flags ? `\n🚩 Red Flags\n${flags}` : '',
    ``,
    `❤️ Emotions`,
    emotions,
    ``,
    `─────────────────────────`,
    `Analyzed with Facebook Post Analyzer`
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Try native share first, fall back to clipboard
  if (navigator.share) {
    navigator.share({ text: lines }).catch(() => copyToClipboard(lines));
  } else {
    copyToClipboard(lines);
  }
}

// ─── Copy helpers (new) ───────────────────────────────────────────────────────
function copySectionText(sectionId, btnEl) {
  const body = $(sectionId);
  if (!body) return;
  const text = body.innerText.trim();
  if (!text) return;
  copyToClipboard(text, btnEl);
}

function copyFullAnalysis() {
  if (!lastAnalysis || !currentPostData) return;
  const a = lastAnalysis;
  const flags = (a.redFlags || []).map(f => `  🚩 ${f.type}: "${f.quote}" — ${f.explanation}`).join('\n');
  const emotions = (a.emotions || []).map(e => `  ${e.label}: ${Math.round(e.score * 100)}%`).join('\n');
  const intents = (a.intents || []).join(', ');

  const text = [
    `📊 Content Analysis`,
    `─────────────────────────`,
    `👤 ${currentPostData.author || 'Unknown'}  •  ${new Date().toLocaleDateString()}`,
    ``,
    `📝 Summary`,
    a.summary || '',
    ``,
    `💭 Subtext & Intent`,
    a.subtext || '',
    intents ? `Tags: ${intents}` : '',
    flags ? `\n🚩 Red Flags\n${flags}` : '',
    ``,
    `❤️ Emotions`,
    emotions,
    ``,
    `─────────────────────────`,
    `Analyzed with Content Analyzer AI`
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  copyToClipboard(text);
}

// ─── Clipboard ────────────────────────────────────────────────────────────────
function copyToClipboard(text, feedbackBtn) {
  const showFeedback = () => {
    if (feedbackBtn) {
      // Show checkmark on the section copy button briefly
      const orig = feedbackBtn.textContent;
      feedbackBtn.textContent = '✓';
      feedbackBtn.classList.add('copied');
      setTimeout(() => {
        feedbackBtn.textContent = orig;
        feedbackBtn.classList.remove('copied');
      }, 1500);
    } else {
      // Show the shared "Copied" banner
      const el = $('shareCopied');
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2500);
    }
  };

  navigator.clipboard.writeText(text).then(showFeedback).catch(() => {
    // Fallback: textarea trick
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showFeedback();
  });
}

function showError(message) {
  $('errorMessage').textContent = message || 'An error occurred. Please try again.';
  showState('error');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
