// Facebook Post Analyzer - Background Service Worker

// ─── Side Panel Setup ─────────────────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
});

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_POST') {
    chrome.runtime.sendMessage({ type: 'ANALYZE_POST', data: msg.data }).catch(() => {});
    return true;
  }
  if (msg.type === 'DO_ANALYSIS') {
    doAnalysis(msg.data).catch(err => {
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_ERROR',
        message: err.message || 'Analysis failed. Check your API key in settings.'
      }).catch(() => {});
    });
    return true;
  }
});

// ─── Main Analysis Pipeline ───────────────────────────────────────────────────
async function doAnalysis(postData) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('No API key set. Open settings (⚙️) and add your Claude API key.');
  }

  notifyStep(1, '📖 Reading post...');
  await sleep(200);

  notifyStep(2, '🤖 Running AI analysis...');
  const result = await runClaudeAnalysis(postData, settings);

  notifyStep(3, '✨ Done!');
  await sleep(150);

  chrome.runtime.sendMessage({ type: 'ANALYSIS_COMPLETE', data: result, postData }).catch(() => {});
}

function notifyStep(step, text) {
  chrome.runtime.sendMessage({ type: 'ANALYSIS_STEP', step, text }).catch(() => {});
}

// ─── Claude API Call ──────────────────────────────────────────────────────────
async function runClaudeAnalysis(postData, settings) {
  const model = settings.model || 'claude-haiku-4-5-20251001';

  const systemPrompt = `You are an expert social media analyst and psychologist.
Analyze Facebook posts in ANY language (especially Bangla and English).
Detect the language of the post and respond with analysis in the SAME language as the post.
If the post is in Bangla, write your analysis in Bangla. If English, write in English. If mixed, use both.
Always respond with valid JSON only. No markdown, no code blocks.`;

  const userPrompt = `Analyze this Facebook post carefully.

Author: ${postData.author || 'Unknown'}
Post: """${postData.text}"""
${postData.images?.length ? `Images: ${postData.images.join(', ')}` : ''}

Return ONLY a valid JSON object with this exact structure:
{
  "detectedLanguage": "Bangla" or "English" or "Mixed",
  "summary": "2-3 sentence plain summary of what this post says. Write in the same language as the post.",
  "subtext": "What does the author REALLY mean beneath the surface? Hidden intent, unspoken feelings, what they want people to think/feel. 2-3 insightful sentences. Same language as post.",
  "intents": ["4-6 short intent tags like: Seeking Validation, Venting, Sharing News, Expressing Pride, Asking Help, Political Opinion, Promoting, Humor"],
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

Rules:
- All 8 emotions must be present with scores 0.0-1.0
- Scores should reflect how strongly each emotion is present
- Be specific and insightful, not generic
- If post is in Bangla, write summary/subtext/emotionContext in Bangla`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
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

  // Sort emotions by score, keep top 6 with score > 0.05
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
  return new Promise(resolve => {
    chrome.storage.sync.get(['apiKey', 'model'], resolve);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
