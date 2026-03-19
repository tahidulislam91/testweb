// Content Analyzer AI - Content Script
// Works on any website: Facebook, Instagram, LinkedIn, news, blogs, etc.

(function () {
  'use strict';

  let lastHighlighted = null;
  let clickIndicator = null;
  let analysisEnabled = true;

  // ─── Skip tags that are never useful content ─────────────────────────────
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION',
    'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME'
  ]);

  // ─── Semantic content containers (preferred) ─────────────────────────────
  const CONTENT_SELECTORS = [
    // Social media posts
    '[role="article"]',
    '[data-testid="post_message"]',
    '[data-ad-comet-preview="message"]',
    // News / blog
    'article',
    '[itemprop="articleBody"]',
    '.article-body',
    '.article__body',
    '.post-content',
    '.entry-content',
    '.story-body',
    '.content-body',
    // LinkedIn
    '.feed-shared-update-v2',
    '.feed-shared-text',
    // Instagram
    '._aagv',
    '._a9zs',
    // Twitter/X
    '[data-testid="tweetText"]',
    '[data-testid="tweet"]',
    // Generic fallbacks
    'main',
    '[role="main"]',
    '.content',
    '.post',
    '.article',
  ];

  // ─── Find best content container from clicked element ────────────────────
  function findContentBlock(target) {
    // Walk up the DOM looking for a semantic container
    let el = target;
    let bestCandidate = null;

    while (el && el !== document.body && el !== document.documentElement) {
      if (SKIP_TAGS.has(el.tagName)) return null;

      // Skip nav, header, footer, sidebars
      if (el.matches('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="complementary"]')) {
        return null;
      }

      // Check if this element matches a known content selector
      for (const sel of CONTENT_SELECTORS) {
        if (el.matches(sel)) {
          const text = extractText(el);
          if (text.length >= 80) return el;
        }
      }

      // Track any element with decent text as a fallback candidate
      if (!bestCandidate) {
        const text = extractText(el);
        if (text.length >= 150) bestCandidate = el;
      }

      el = el.parentElement;
    }

    // Use best candidate if we found one
    if (bestCandidate) {
      const text = extractText(bestCandidate);
      if (text.length >= 150) return bestCandidate;
    }

    return null;
  }

  // ─── Extract clean readable text from a container ────────────────────────
  function extractText(container) {
    const seen = new Set();
    const parts = [];

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip buttons, nav, toolbars
        if (parent.closest('button, nav, [role="navigation"], [role="toolbar"], [aria-label*="actions" i], [aria-label*="menu" i]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t.length > 1 && !seen.has(t)) {
        seen.add(t);
        parts.push(t);
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // ─── Extract metadata from container ─────────────────────────────────────
  function extractMeta(container) {
    // Author
    let author = '';
    const authorEl = container.querySelector(
      'h1, h2, h3, ' +
      '[class*="author" i], [class*="byline" i], [class*="username" i], ' +
      '[itemprop="author"], [rel="author"], ' +
      'a[role="link"] > span:first-child'
    );
    if (authorEl) author = authorEl.textContent.trim().substring(0, 80);

    // Page title as fallback author context
    const pageTitle = document.title || '';
    const siteName = document.querySelector('meta[property="og:site_name"]')?.content || '';

    // Images alt text
    const images = [...container.querySelectorAll('img[alt]')]
      .map(img => img.alt.trim())
      .filter(a => a.length > 3)
      .slice(0, 3);

    return { author, pageTitle, siteName, images };
  }

  // ─── Highlight selected block ─────────────────────────────────────────────
  function highlightBlock(el) {
    if (lastHighlighted) {
      lastHighlighted.style.outline = '';
      lastHighlighted.style.outlineOffset = '';
      lastHighlighted.style.borderRadius = '';
    }
    if (el) {
      el.style.outline = '2px solid #6366f1';
      el.style.outlineOffset = '3px';
      el.style.borderRadius = '4px';
      lastHighlighted = el;
    }
  }

  // ─── Toast feedback ───────────────────────────────────────────────────────
  function showToast(x, y, text) {
    if (!clickIndicator) {
      clickIndicator = document.createElement('div');
      clickIndicator.id = 'content-analyzer-toast';
      clickIndicator.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(99,102,241,0.93);
        color: white;
        padding: 7px 14px;
        border-radius: 20px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        transition: opacity 0.4s;
        white-space: nowrap;
      `;
      document.body.appendChild(clickIndicator);
    }
    clickIndicator.innerHTML = `<span>🔍</span> ${text}`;
    clickIndicator.style.left = Math.min(x + 12, window.innerWidth - 220) + 'px';
    clickIndicator.style.top = Math.max(y - 44, 8) + 'px';
    clickIndicator.style.opacity = '1';
    clearTimeout(clickIndicator._timer);
    clickIndicator._timer = setTimeout(() => {
      if (clickIndicator) clickIndicator.style.opacity = '0';
    }, 2200);
  }

  // ─── Click handler ────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!analysisEnabled) return;

    // Ignore clicks on interactive elements
    if (e.target.matches('a, button, input, textarea, select, [role="button"]')) return;

    const block = findContentBlock(e.target);
    if (!block) return;

    const text = extractText(block);
    if (!text || text.length < 80) return;

    const meta = extractMeta(block);

    highlightBlock(block);
    showToast(e.clientX, e.clientY, 'Analyzing content...');

    chrome.runtime.sendMessage({
      type: 'POST_CLICKED',
      data: {
        text: text.substring(0, 4000),
        author: meta.author,
        pageTitle: meta.pageTitle,
        siteName: meta.siteName,
        images: meta.images,
        pageUrl: window.location.href,
        source: detectSource()
      }
    });
  }, true);

  // ─── Detect source site ───────────────────────────────────────────────────
  function detectSource() {
    const h = location.hostname;
    if (h.includes('facebook.com')) return 'Facebook';
    if (h.includes('instagram.com')) return 'Instagram';
    if (h.includes('linkedin.com')) return 'LinkedIn';
    if (h.includes('twitter.com') || h.includes('x.com')) return 'X/Twitter';
    if (h.includes('reddit.com')) return 'Reddit';
    if (h.includes('youtube.com')) return 'YouTube';
    if (h.includes('tiktok.com')) return 'TikTok';
    return 'Web';
  }

  // ─── Listen for toggle from sidebar ──────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_ANALYSIS_ENABLED') analysisEnabled = msg.enabled;
  });

})();
