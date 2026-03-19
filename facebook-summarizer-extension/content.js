// Facebook Post Analyzer - Content Script (Facebook only)

(function () {
  'use strict';

  // Only run on Facebook
  if (!location.hostname.includes('facebook.com')) return;

  const BTN_ID = 'fb-analyzer-btn';
  let btn = null;
  let activePost = null;
  let hideTimer = null;

  // ─── Create the floating analyze button ──────────────────────────────────
  function createBtn() {
    const el = document.createElement('button');
    el.id = BTN_ID;
    el.innerHTML = '🔍 Analyze';
    el.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483640;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(99,102,241,0.5);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
      white-space: nowrap;
      line-height: 1;
    `;
    el.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
    });
    el.addEventListener('mouseleave', () => {
      scheduleHide();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (activePost) triggerAnalysis(activePost, el);
    });
    document.body.appendChild(el);
    return el;
  }

  function getBtn() {
    if (!btn || !document.body.contains(btn)) btn = createBtn();
    return btn;
  }

  // ─── Show button over a post ──────────────────────────────────────────────
  function showBtn(postEl) {
    clearTimeout(hideTimer);
    activePost = postEl;

    // Position button inside the post using absolute inside fixed container
    const rect = postEl.getBoundingClientRect();
    const b = getBtn();

    b.style.position = 'fixed';
    b.style.top = (rect.top + 8) + 'px';
    b.style.right = (window.innerWidth - rect.right + 8) + 'px';
    b.style.left = 'auto';
    b.style.opacity = '1';
    b.style.pointerEvents = 'auto';
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const b = getBtn();
      b.style.opacity = '0';
      b.style.pointerEvents = 'none';
      activePost = null;
    }, 300);
  }

  // ─── Attach hover listeners to a post ────────────────────────────────────
  function attachPost(postEl) {
    if (postEl._analyzerAttached) return;
    postEl._analyzerAttached = true;

    postEl.addEventListener('mouseenter', () => showBtn(postEl));
    postEl.addEventListener('mouseleave', () => scheduleHide());
  }

  // ─── Observe Facebook feed for new posts ─────────────────────────────────
  function scanPosts() {
    // Facebook posts are role="article" inside the feed
    document.querySelectorAll('[role="article"]').forEach(attachPost);
  }

  // Debounce MutationObserver to avoid scanning on every single DOM change
  let scanTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPosts, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scanPosts();

  // ─── Trigger analysis ────────────────────────────────────────────────────
  function triggerAnalysis(postEl, btnEl) {
    const text = extractText(postEl);
    if (!text || text.length < 60) {
      flashBtn(btnEl, '⚠️ Too short');
      return;
    }

    flashBtn(btnEl, '⏳ Sending...');

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
    }).catch(err => {
      // Extension was reloaded — this tab has a stale content script
      if (err?.message?.includes('Extension context invalidated') ||
          err?.message?.includes('Could not establish connection')) {
        flashBtn(btnEl, '🔄 Refresh page');
      }
    });

    // Highlight the post briefly
    const prev = postEl.style.outline;
    postEl.style.outline = '2px solid #6366f1';
    postEl.style.outlineOffset = '3px';
    postEl.style.borderRadius = '4px';
    setTimeout(() => {
      postEl.style.outline = prev;
      postEl.style.outlineOffset = '';
      postEl.style.borderRadius = '';
    }, 1800);
  }

  function flashBtn(btnEl, msg) {
    const prev = btnEl.innerHTML;
    btnEl.innerHTML = msg;
    setTimeout(() => { btnEl.innerHTML = prev; }, 1500);
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
