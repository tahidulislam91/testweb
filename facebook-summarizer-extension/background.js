// Facebook Post Analyzer - Background Service Worker

// ─── Side Panel Setup ─────────────────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
});

// ─── Port: Sidebar connects here on load ──────────────────────────────────────
let sidebarPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidebar') return;

  sidebarPort = port;

  port.onDisconnect.addListener(() => {
    sidebarPort = null;
  });

  // If a post was clicked before sidebar was ready, send it now
  chrome.storage.local.get(['pendingPost'], (data) => {
    if (data.pendingPost) {
      port.postMessage({ type: 'ANALYZE_POST', data: data.pendingPost });
      chrome.storage.local.remove('pendingPost');
    }
  });
});

function sendToSidebar(msg) {
  if (sidebarPort) {
    try { sidebarPort.postMessage(msg); } catch (e) {}
  }
}

// ─── Messages from content script and sidebar ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script: user clicked a post
  if (msg.type === 'POST_CLICKED') {
    const windowId = sender.tab?.windowId;

    // Auto-open the sidebar
    if (windowId) chrome.sidePanel.open({ windowId });

    if (sidebarPort) {
      sendToSidebar({ type: 'ANALYZE_POST', data: msg.data });
    } else {
      // Sidebar not open yet — store and send once it connects
      chrome.storage.local.set({ pendingPost: msg.data });
    }
    return;
  }

  // Sidebar: run analysis
  if (msg.type === 'DO_ANALYSIS') {
    doAnalysis(msg.data).catch(err => {
      sendToSidebar({
        type: 'ANALYSIS_ERROR',
        message: err.message || 'Analysis failed. Check your API key in settings.'
      });
    });
    return true;
  }
});

// ─── Analysis Pipeline ────────────────────────────────────────────────────────
async function doAnalysis(postData) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('No API key set. Open settings (⚙️) and add your Claude API key.');
  }

  sendToSidebar({ type: 'ANALYSIS_STEP', step: 1, text: '📖 Reading post...' });
  await sleep(150);

  sendToSidebar({ type: 'ANALYSIS_STEP', step: 2, text: '🤖 Running AI analysis...' });
  const result = await runClaudeAnalysis(postData, settings);

  sendToSidebar({ type: 'ANALYSIS_STEP', step: 3, text: '✨ Done!' });
  await sleep(100);

  sendToSidebar({ type: 'ANALYSIS_COMPLETE', data: result, postData });
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function runClaudeAnalysis(postData, settings) {
  const model = settings.model || 'claude-haiku-4-5-20251001';

  const systemPrompt = `You are an expert social media analyst and psychologist.
Analyze Facebook posts written in ANY language, especially Bangla and English.
Detect the post language and write your analysis in that same language.
If the post is in Bangla, write summary/subtext/emotionContext in Bangla.
If mixed, use the dominant language.
Respond with valid JSON only. No markdown, no code fences.`;

  const userPrompt = `Analyze this Facebook post:

Author: ${postData.author || 'Unknown'}
Post: """${postData.text}"""
${postData.images?.length ? `Images: ${postData.images.join(', ')}` : ''}

Return ONLY a valid JSON object:
{
  "detectedLanguage": "Bangla" or "English" or "Mixed",
  "summary": "2-3 sentence plain summary. Same language as the post.",
  "subtext": "What does the author REALLY mean beneath the surface? Hidden intent, unspoken feelings, what they want others to think or feel. 2-3 insightful sentences. Same language as post.",
  "intents": ["4-6 short tags like: Seeking Validation, Venting, Sharing News, Expressing Pride, Asking Help, Political Opinion, Humor, Promoting"],
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
  "emotionContext": "1-2 sentences explaining the emotional tone. Same language as post."
}

All 8 emotions must be present with scores 0.0-1.0. Be specific, not generic.`;

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
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Please check your key in settings.');
    if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned invalid response. Please try again.');

  const parsed = JSON.parse(jsonMatch[0]);

  if (parsed.emotions) {
    parsed.emotions = parsed.emotions
      .filter(e => e.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return parsed;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(['apiKey', 'model'], resolve));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
