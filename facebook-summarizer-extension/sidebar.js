// Sidebar Script
'use strict';

const $ = id => document.getElementById(id);

let currentPostData = null;
let lastAnalysis    = null;
let port            = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connectPort();
  loadSettings();
  bindEvents();
  showView('empty');
  checkPendingPost();
});

// ── Port (background → sidebar ping) ─────────────────────────────────────────
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
  } catch (_) {}
}

// ── Read post saved by background ────────────────────────────────────────────
function checkPendingPost() {
  chrome.storage.local.get(['pendingPost', 'pendingTimestamp'], (d) => {
    if (!d.pendingPost) return;
    // Ignore if older than 30 s
    if (Date.now() - (d.pendingTimestamp || 0) > 30000) {
      chrome.storage.local.remove(['pendingPost', 'pendingTimestamp']);
      return;
    }
    chrome.storage.local.remove(['pendingPost', 'pendingTimestamp']);
    startAnalysis(d.pendingPost);
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'model'], (d) => {
    if (d.apiKey) $('apiKeyInput').value = d.apiKey;
    if (d.model)  $('modelSelect').value = d.model;
    updateApiKeyWarning(d.apiKey);
  });
}

function saveSettings() {
  const apiKey = $('apiKeyInput').value.trim();
  const model  = $('modelSelect').value;
  chrome.storage.sync.set({ apiKey, model }, () => {
    $('settingsSaved').classList.remove('hidden');
    setTimeout(() => $('settingsSaved').classList.add('hidden'), 2000);
    updateApiKeyWarning(apiKey);
  });
}

function updateApiKeyWarning(apiKey) {
  $('noApiKey').classList.toggle('hidden', !!apiKey);
}

// ── Views ─────────────────────────────────────────────────────────────────────
function showView(name) {
  ['loadingState','emptyState','results','errorState'].forEach(id => {
    $(id).classList.add('hidden');
  });
  if (name === 'loading') $('loadingState').classList.remove('hidden');
  if (name === 'empty')   $('emptyState').classList.remove('hidden');
  if (name === 'results') $('results').classList.remove('hidden');
  if (name === 'error')   $('errorState').classList.remove('hidden');
}

// ── Collapsible sections ──────────────────────────────────────────────────────
function bindCollapsibles() {
  document.querySelectorAll('.section-header[data-target]').forEach(header => {
    const clone = header.cloneNode(true);
    header.parentNode.replaceChild(clone, header);
    clone.addEventListener('click', (e) => {
      if (e.target.closest('.copy-btn')) return; // let copy buttons through
      const body    = $(clone.getAttribute('data-target'));
      const chevron = clone.querySelector('.chevron');
      const closed  = body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open', !closed);
    });
  });
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Settings panel
  $('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
  $('closeSettings').addEventListener('click', () => $('settingsPanel').classList.add('hidden'));
  $('saveSettings').addEventListener('click', saveSettings);
  $('goToSettings').addEventListener('click', () => {
    $('settingsPanel').classList.remove('hidden');
  });

  // Show/hide API key
  $('toggleApiKey').addEventListener('click', () => {
    const inp  = $('apiKeyInput');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('toggleApiKey').textContent = show ? 'Hide' : 'Show';
  });

  // Paste & Analyze
  $('pasteAnalyzeBtn').addEventListener('click', () => {
    const text = $('pasteInput').value.trim();
    if (!text) return;
    startAnalysis({ text, source: 'Pasted', author: '' });
  });

  // Re-analyze / Share / Retry
  $('reanalyzeBtn').addEventListener('click', () => {
    if (currentPostData) startAnalysis(currentPostData);
  });
  $('shareBtn').addEventListener('click', shareAll);
  $('retryBtn').addEventListener('click', () => {
    if (currentPostData) startAnalysis(currentPostData);
  });

  // Copy buttons — event delegation (survives cloneNode rebind)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    e.stopPropagation();
    const targetId = btn.getAttribute('data-target-text');
    if (!targetId) return;
    const el = $(targetId);
    if (!el) return;
    const text = el.innerText.trim();
    if (!text) return;
    copyText(text, btn);
  });

  bindCollapsibles();
}

// ── Analysis ──────────────────────────────────────────────────────────────────
async function startAnalysis(postData) {
  currentPostData = postData;
  showView('loading');
  $('loadingText').textContent = 'Analyzing…';

  const settings = await new Promise(r => chrome.storage.sync.get(['apiKey', 'model'], r));

  if (!settings.apiKey) {
    showView('empty');
    $('noApiKey').classList.remove('hidden');
    $('settingsPanel').classList.remove('hidden');
    return;
  }

  try {
    const result = await callClaude(postData, settings);
    lastAnalysis = result;
    renderResults(result, postData);
  } catch (err) {
    $('errorMessage').textContent = err.message || 'Analysis failed. Please try again.';
    showView('error');
  }
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(postData, settings) {
  const model = settings.model || 'claude-haiku-4-5-20251001';

  const systemPrompt =
    `You are an expert content analyst and critical thinking coach.
Analyze content in any language (especially Bangla and English).
Respond in the SAME language as the content.
Return ONLY a valid raw JSON object. No markdown, no code fences.`;

  const userPrompt =
`Analyze this content and return a single JSON object.

SOURCE: ${postData.source || 'Unknown'}
AUTHOR: ${postData.author || 'Unknown'}
CONTENT:
"""
${postData.text}
"""

Return exactly this JSON structure:
{
  "language": "English",
  "summary": "2-3 sentence summary in the content's language.",
  "subtext": "2-3 sentences on what the author really means beneath the surface.",
  "intents": ["tag1", "tag2", "tag3"],
  "redFlags": [
    { "type": "Overgeneralization", "quote": "short exact phrase", "explanation": "why" }
  ],
  "emotions": [
    {"label": "Joy",      "score": 0.0},
    {"label": "Anger",    "score": 0.0},
    {"label": "Sadness",  "score": 0.0},
    {"label": "Fear",     "score": 0.0},
    {"label": "Surprise", "score": 0.0},
    {"label": "Trust",    "score": 0.0},
    {"label": "Sarcasm",  "score": 0.0},
    {"label": "Pride",    "score": 0.0}
  ],
  "emotionContext": "1-2 sentences on the emotional tone."
}

Rules:
- language: "Bangla", "English", or "Mixed"
- intents: 3-5 short phrase strings
- redFlags: empty array [] if none
- redFlag type must be one of: Overgeneralization, Probable False Claim, Opinion Stated as Fact, Emotional Manipulation, Bias, Missing Context, Clickbait, Conspiracy Theory, Hate Speech
- emotion scores: 0.0–1.0, all 8 required
- Return ONLY the JSON, nothing else`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Invalid API key — check Settings.');
    if (res.status === 429) throw new Error('Rate limit reached — wait a moment and retry.');
    throw new Error(err.error?.message || `API error (${res.status})`);
  }

  const data  = await res.json();
  const raw   = data.content?.[0]?.text || '';
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response — try again.');

  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (_) { throw new Error('AI returned malformed JSON — try again.'); }

  // Keep only emotions with score > 0.05, sorted desc
  if (Array.isArray(parsed.emotions)) {
    parsed.emotions = parsed.emotions
      .filter(e => typeof e.score === 'number' && e.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return parsed;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults(a, postData) {
  // Source bar
  if (postData.source || postData.author) {
    $('sourceLabel').textContent = [postData.source, postData.author].filter(Boolean).join(' · ');
    $('sourceMeta').classList.remove('hidden');
  } else {
    $('sourceMeta').classList.add('hidden');
  }

  // Language badge
  const lang = a.language || '';
  const badge = $('langBadge');
  badge.textContent = lang;
  badge.className = 'lang-badge ' + (lang === 'Bangla' ? 'bangla' : lang === 'Mixed' ? 'mixed' : 'english');

  $('originalText').textContent = postData.text || '';
  $('summaryText').textContent  = a.summary  || '';
  $('subtextText').textContent  = a.subtext  || '';
  renderIntentTags(a.intents  || []);
  renderRedFlags(a.redFlags   || []);
  renderEmotions(a.emotions   || []);
  $('emotionContext').textContent = a.emotionContext || '';

  showView('results');
  bindCollapsibles(); // re-bind after DOM update
}

function renderIntentTags(intents) {
  const c = $('intentTags');
  c.innerHTML = '';
  const colors = ['blue','purple','orange','green','gray','yellow'];
  intents.forEach((t, i) => {
    if (typeof t !== 'string') return;
    const el = document.createElement('span');
    el.className = `tag ${colors[i % colors.length]}`;
    el.textContent = t.trim();
    c.appendChild(el);
  });
}

function renderRedFlags(flags) {
  const box  = $('redFlagsBox');
  const list = $('redFlagsList');
  list.innerHTML = '';
  const valid = flags.filter(f => f && f.type);
  box.classList.toggle('hidden', valid.length === 0);
  const colorMap = {
    'Overgeneralization': 'orange', 'Probable False Claim': 'red',
    'Opinion Stated as Fact': 'yellow', 'Emotional Manipulation': 'red',
    'Bias': 'orange', 'Missing Context': 'yellow', 'Clickbait': 'orange',
    'Conspiracy Theory': 'red', 'Hate Speech': 'red'
  };
  valid.forEach(f => {
    const d = document.createElement('div');
    d.className = 'redflag-item';
    d.innerHTML =
      `<span class="tag ${colorMap[f.type] || 'orange'} redflag-tag">${esc(f.type)}</span>` +
      (f.quote       ? `<div class="redflag-quote">"${esc(f.quote)}"</div>` : '') +
      (f.explanation ? `<div class="redflag-explanation">${esc(f.explanation)}</div>` : '');
    list.appendChild(d);
  });
}

function renderEmotions(emotions) {
  const c = $('emotionBars');
  c.innerHTML = '';
  const colors = {
    joy:'#23c55e', anger:'#ef4444', sadness:'#3b82f6', fear:'#9333ea',
    surprise:'#f97316', trust:'#06b6d4', sarcasm:'#ec4899', pride:'#8b5cf6'
  };
  emotions.forEach(({ label, score }) => {
    const color = colors[(label||'').toLowerCase()] || '#9ca3af';
    const pct   = Math.round((score || 0) * 100);
    const row   = document.createElement('div');
    row.className = 'emotion-row';
    row.innerHTML =
      `<span class="emotion-label">${esc(label)}</span>
       <div class="emotion-bar-track">
         <div class="emotion-bar-fill" style="width:0%;background:${color}" data-pct="${pct}%"></div>
       </div>
       <span class="emotion-pct">${pct}%</span>`;
    c.appendChild(row);
  });
  requestAnimationFrame(() => {
    c.querySelectorAll('.emotion-bar-fill').forEach(b => {
      b.style.width = b.getAttribute('data-pct');
    });
  });
}

// ── Share all ─────────────────────────────────────────────────────────────────
function shareAll() {
  if (!lastAnalysis || !currentPostData) return;
  const a       = lastAnalysis;
  const intents = (a.intents  || []).join(', ');
  const flags   = (a.redFlags || []).map(f => `  🚩 ${f.type}: "${f.quote}" — ${f.explanation}`).join('\n');
  const emotions= (a.emotions || []).map(e => `  ${e.label}: ${Math.round(e.score*100)}%`).join('\n');

  const text = [
    '📊 Content Analysis',
    '─────────────────────────',
    `👤 ${currentPostData.author || 'Unknown'}  •  ${new Date().toLocaleDateString()}`,
    '',
    '📝 Summary',
    a.summary || '',
    '',
    '💭 Subtext & Intent',
    a.subtext || '',
    intents ? `Tags: ${intents}` : '',
    flags    ? `\n🚩 Red Flags\n${flags}` : '',
    '',
    '❤️ Emotions',
    emotions,
    '',
    '─────────────────────────',
    'Analyzed with Content Analyzer AI'
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (navigator.share) {
    navigator.share({ text }).catch(() => copyText(text));
  } else {
    copyText(text);
  }
}

// ── Clipboard helper ──────────────────────────────────────────────────────────
function copyText(text, btn) {
  const done = () => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } else {
      $('shareCopied').classList.remove('hidden');
      setTimeout(() => $('shareCopied').classList.add('hidden'), 2500);
    }
  };

  navigator.clipboard.writeText(text).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
