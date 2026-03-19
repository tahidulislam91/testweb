// Facebook Post Analyzer - Content Script (Facebook only)

(function () {
  'use strict';

  if (!location.hostname.includes('facebook.com')) return;

  // ─── Attach click listener to a post ─────────────────────────────────────
  function attachPost(postEl) {
    if (postEl._analyzerAttached) return;
    postEl._analyzerAttached = true;

    postEl.addEventListener('click', (e) => {
      // Ignore clicks on buttons, links, inputs
      if (e.target.closest('a, button, input, textarea, [role="button"]')) return;
      triggerAnalysis(postEl);
    });
  }

  // ─── Observe Facebook feed for new posts ─────────────────────────────────
  function scanPosts() {
    document.querySelectorAll('[role="article"]').forEach(attachPost);
  }

  const observer = new MutationObserver(() => scanPosts());
  observer.observe(document.body, { childList: true, subtree: true });
  scanPosts();

  // ─── Trigger analysis ────────────────────────────────────────────────────
  function triggerAnalysis(postEl) {
    const text = extractText(postEl);
    if (!text || text.length < 60) return;

    const author = extractAuthor(postEl);
    const siteName = document.querySelector('meta[property="og:site_name"]')?.content || 'Facebook';

    chrome.runtime.sendMessage({
      type: 'POST_CLICKED',
      data: {
        text: text.substring(0, 4000),
        author,
        pageTitle: document.title || '',
        siteName,
        pageUrl: window.location.href,
        source: 'Facebook'
      }
    });

    // Brief highlight so user sees which post was picked
    const prev = postEl.style.outline;
    postEl.style.outline = '2px solid #6366f1';
    postEl.style.outlineOffset = '3px';
    setTimeout(() => {
      postEl.style.outline = prev;
      postEl.style.outlineOffset = '';
    }, 1200);
  }

  // ─── Extract clean text from post ────────────────────────────────────────
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','INPUT','TEXTAREA','SELECT','BUTTON','SVG','CANVAS','VIDEO','AUDIO','IFRAME']);

  function extractText(container) {
    const seen = new Set();
    const parts = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        const s = window.getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        if (p.closest('button, [role="button"], nav, [role="navigation"], [aria-label*="action" i], [aria-label*="react" i], [aria-label*="comment" i], [aria-label*="share" i]')) {
          return NodeFilter.FILTER_REJECT;
        }
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

  function extractAuthor(postEl) {
    const el = postEl.querySelector('h2 a, h3 a, strong a, [data-hovercard-prefer-name-as-fallback="1"]');
    return el ? el.textContent.trim().substring(0, 80) : '';
  }

})();
