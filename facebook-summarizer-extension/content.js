// Content Script — Facebook only
(function () {
  'use strict';

  if (!location.hostname.includes('facebook.com')) return;

  let analysisEnabled = true;

  // Sync enabled state from storage
  chrome.storage.sync.get(['analysisEnabled'], (d) => {
    if (typeof d.analysisEnabled !== 'undefined') analysisEnabled = d.analysisEnabled;
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_ANALYSIS_ENABLED') analysisEnabled = msg.enabled;
  });

  // Attach click listener to each post once
  function attachPost(postEl) {
    if (postEl._analyzerAttached) return;
    postEl._analyzerAttached = true;
    postEl.addEventListener('click', (e) => {
      if (!analysisEnabled) return;
      // Skip clicks on interactive elements
      if (e.target.closest('a, button, input, textarea, [role="button"]')) return;
      sendPost(postEl);
    });
  }

  function sendPost(postEl) {
    const text = extractText(postEl);
    if (!text || text.length < 60) return;

    const author = extractAuthor(postEl);

    chrome.runtime.sendMessage({
      type: 'POST_CLICKED',
      data: {
        text: text.substring(0, 4000),
        author,
        source: 'Facebook',
        pageUrl: location.href
      }
    });

    // Brief highlight
    const prev = postEl.style.outline;
    postEl.style.outline = '2px solid #6366f1';
    postEl.style.outlineOffset = '3px';
    setTimeout(() => {
      postEl.style.outline = prev;
      postEl.style.outlineOffset = '';
    }, 1000);
  }

  // Scan for posts and attach
  function scan() {
    document.querySelectorAll('[role="article"]').forEach(attachPost);
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();

  // ── Text extraction ───────────────────────────────────────────────────────
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','INPUT','TEXTAREA',
                        'SELECT','BUTTON','SVG','CANVAS','VIDEO','AUDIO','IFRAME']);

  function extractText(el) {
    const seen = new Set();
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        const s = window.getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        if (p.closest('button,[role="button"],nav,[aria-label*="action" i],'
          + '[aria-label*="react" i],[aria-label*="comment" i],[aria-label*="share" i]'))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t.length > 1 && !seen.has(t)) { seen.add(t); parts.push(t); }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function extractAuthor(el) {
    const a = el.querySelector('h2 a, h3 a, strong a, [data-hovercard-prefer-name-as-fallback="1"]');
    return a ? a.textContent.trim().slice(0, 80) : '';
  }
})();
