// Facebook Post Analyzer - Background Service Worker

// ─── Side Panel Setup ─────────────────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'sidebar.html',
    enabled: true
  });
});

// ─── Message Router ───────────────────────────────────────────────────────────
// Routes messages between content script <-> sidebar
const sidebarPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidebar') {
    const windowId = port.sender?.tab?.windowId;
    sidebarPorts.set(windowId, port);
    port.onDisconnect.addListener(() => sidebarPorts.delete(windowId));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_POST') {
    // Content script clicked a post - forward to sidebar
    const windowId = sender.tab?.windowId;
    broadcastToSidebar(windowId, { type: 'ANALYZE_POST', data: msg.data });
    return true;
  }

  if (msg.type === 'DO_ANALYSIS') {
    // Sidebar requests analysis
    doAnalysis(msg.data, sender).catch(err => {
      broadcastToSidebar(null, {
        type: 'ANALYSIS_ERROR',
        message: err.message || 'Analysis failed. Check your API key in settings.'
      });
    });
    return true;
  }
});

// ─── Broadcast to Sidebar ─────────────────────────────────────────────────────
function broadcastToSidebar(windowId, msg) {
  // Try to send to all extension views (sidebar pages)
  const views = chrome.extension.getViews({ type: 'tab' });
  // Use runtime.sendMessage to all listeners (sidebar is a page)
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ─── Main Analysis Pipeline ───────────────────────────────────────────────────
async function doAnalysis(postData, sender) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('No API key set. Open extension settings and add your Claude API key.');
  }

  // Step 1: Reading
  notifyStep(1, '📖 Reading post content...');
  await sleep(300);

  // Step 2: AI Analysis
  notifyStep(2, '🤖 Running AI analysis...');
  const aiResult = await runClaudeAnalysis(postData, settings);

  // Step 3: Fact Check
  notifyStep(3, '🌐 Fact-checking claims...');
  let factCheck;
  if (settings.serpApiKey && aiResult.factCheckQueries?.length > 0) {
    factCheck = await runWebFactCheck(aiResult.factCheckQueries, aiResult.claims, settings.serpApiKey);
  } else {
    factCheck = {
      verdict: aiResult.factCheckVerdict || 'Opinion/Unverified',
      verdictClass: aiResult.factCheckVerdictClass || 'opinion',
      summary: aiResult.factCheckSummary || 'AI-based assessment only (no SerpAPI key configured for live web search).',
      sources: [],
      aiOnly: true
    };
  }

  // Step 4: Finalize
  notifyStep(4, '✨ Finalizing results...');
  await sleep(200);

  const fullResult = {
    summary: aiResult.summary,
    subtext: aiResult.subtext,
    intents: aiResult.intents,
    emotions: aiResult.emotions,
    emotionContext: aiResult.emotionContext,
    factCheck
  };

  chrome.runtime.sendMessage({
    type: 'ANALYSIS_COMPLETE',
    data: fullResult,
    postData
  }).catch(() => {});
}

function notifyStep(step, text) {
  chrome.runtime.sendMessage({ type: 'ANALYSIS_STEP', step, text }).catch(() => {});
}

// ─── Claude API Call ──────────────────────────────────────────────────────────
async function runClaudeAnalysis(postData, settings) {
  const model = settings.model || 'claude-sonnet-4-6';

  const systemPrompt = `You are an expert social media analyst and psychologist specializing in communication analysis.
Your role is to deeply analyze Facebook posts to help users understand not just what is said, but how it's said, why it's said, and what emotions and intentions drive it.
Always respond with valid JSON only.`;

  const userPrompt = `Analyze this Facebook post and return a JSON object with exactly these fields:

POST DATA:
Author: ${postData.author || 'Unknown'}
Timestamp: ${postData.timestamp || 'Unknown'}
Post text: """${postData.text}"""
${postData.images?.length ? `Images described as: ${postData.images.join(', ')}` : ''}
${postData.links?.length ? `Links shared: ${postData.links.map(l => l.text).join(', ')}` : ''}

Return ONLY valid JSON with this structure:
{
  "summary": "Clear 2-3 sentence summary of what this post is actually saying/sharing",
  "subtext": "What does the author REALLY mean or intend beneath the surface? What are they NOT saying directly? What assumptions, biases, or hidden messages exist? Write 2-4 insightful sentences.",
  "intents": ["array", "of", "4-7", "short", "intent", "tags", "e.g.", "Seeking Validation", "Venting Frustration", "Sharing News", "Promoting Product", "Expressing Pride", "Political Opinion"],
  "emotions": [
    {"label": "joy", "score": 0.0},
    {"label": "anger", "score": 0.0},
    {"label": "sadness", "score": 0.0},
    {"label": "fear", "score": 0.0},
    {"label": "surprise", "score": 0.0},
    {"label": "trust", "score": 0.0},
    {"label": "anticipation", "score": 0.0},
    {"label": "sarcasm", "score": 0.0}
  ],
  "emotionContext": "Brief explanation of the emotional tone and what's driving it (2-3 sentences)",
  "claims": ["list of factual claims made in the post that could be verified"],
  "factCheckQueries": ["2-3 search queries to fact-check the main claims"],
  "factCheckVerdict": "Verified|Mostly True|Mixed|Unverified|False|Opinion|Satire",
  "factCheckVerdictClass": "verified|unverified|false|mixed|opinion|ai",
  "factCheckSummary": "Brief AI assessment of the factual accuracy of claims in this post (2-3 sentences)"
}

Scores must be 0.0-1.0 and all 8 emotions must be present. Only include emotions with score > 0.05 in final output.
Be insightful, specific, and avoid generic responses. Focus on what makes THIS post unique.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Please check your Claude API key in settings.');
    if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned invalid response format.');

  const parsed = JSON.parse(jsonMatch[0]);

  // Filter emotions to only those > 0.05
  if (parsed.emotions) {
    parsed.emotions = parsed.emotions
      .filter(e => e.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return parsed;
}

// ─── SerpAPI Web Fact Check ───────────────────────────────────────────────────
async function runWebFactCheck(queries, claims, serpApiKey) {
  const sources = [];
  let mainQuery = queries[0];

  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(mainQuery)}&api_key=${serpApiKey}&num=5&engine=google`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('SerpAPI request failed');
    }

    const data = await response.json();
    const results = data.organic_results || [];

    results.slice(0, 4).forEach(r => {
      sources.push({
        title: r.title,
        url: r.link,
        snippet: r.snippet
      });
    });

    // Also check Google's featured snippet / answer box
    const answerBox = data.answer_box;
    const snippet = data.knowledge_graph;

    // Determine verdict based on sources
    const hasFactCheckers = sources.some(s =>
      s.url && (s.url.includes('snopes') || s.url.includes('factcheck') ||
        s.url.includes('politifact') || s.url.includes('reuters') ||
        s.url.includes('apnews') || s.url.includes('bbc'))
    );

    return {
      verdict: sources.length > 0 ? 'Web Verified' : 'Unverified',
      verdictClass: sources.length > 0 ? 'verified' : 'unverified',
      summary: sources.length > 0
        ? `Found ${sources.length} relevant web sources. ${hasFactCheckers ? 'Includes fact-checker sources.' : 'Review sources below for verification.'}`
        : 'No strong web sources found for these claims.',
      sources,
      aiOnly: false
    };
  } catch (err) {
    return {
      verdict: 'Unverified',
      verdictClass: 'unverified',
      summary: 'Web fact-check failed. ' + (err.message || ''),
      sources: [],
      aiOnly: true
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['apiKey', 'serpApiKey', 'model'], resolve);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
