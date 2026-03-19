// Facebook Post Analyzer - Content Script
// Detects clicks on Facebook posts and sends data to sidebar

(function () {
  'use strict';

  let lastHighlighted = null;
  let clickIndicator = null;

  // Facebook post selectors (updated for modern FB layout)
  const POST_SELECTORS = [
    '[data-testid="post_message"]',
    '[data-ad-comet-preview="message"]',
    '.x1iorvi4',           // Feed post text container
    '.xdj266r',            // Story text
    'div[dir="auto"]',     // General directional text divs inside posts
  ];

  const POST_CONTAINER_SELECTORS = [
    '[data-pagelet^="FeedUnit"]',
    '[role="article"]',
    '.x1yztbdb',
    '.x1n2onr6',
  ];

  function getPostContainer(element) {
    let el = element;
    while (el && el !== document.body) {
      for (const sel of POST_CONTAINER_SELECTORS) {
        if (el.matches && el.matches(sel)) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function extractPostData(container) {
    if (!container) return null;

    // Get all text content from the post
    const textNodes = [];
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          // Skip hidden elements, scripts, styles
          if (!parent) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip nav/button areas
          if (parent.closest('nav, [role="navigation"], [aria-label="Actions for this post"]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 2) textNodes.push(text);
    }

    const fullText = [...new Set(textNodes)].join(' ').replace(/\s+/g, ' ').trim();

    // Extract author name
    let author = '';
    const authorEl = container.querySelector(
      'a[role="link"] > span:not([class*="count"]), h2 a, h3 a, h4 a, ' +
      '[data-testid="story-subtitle"] a:first-child'
    );
    if (authorEl) author = authorEl.textContent.trim();

    // Extract timestamp
    let timestamp = '';
    const timeEl = container.querySelector('abbr[data-utime], a[aria-label*="ago"], a[aria-label*="Just now"], span[title]');
    if (timeEl) {
      timestamp = timeEl.getAttribute('aria-label') || timeEl.getAttribute('title') || timeEl.textContent.trim();
    }

    // Extract images alt texts
    const images = [...container.querySelectorAll('img[alt]')]
      .map(img => img.alt)
      .filter(alt => alt && alt.length > 3);

    // Extract links
    const links = [...container.querySelectorAll('a[href]')]
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(l => l.text && !l.href.includes('javascript'));

    // Get post URL if available
    let postUrl = '';
    const timeLink = container.querySelector('a[href*="/posts/"], a[href*="?story_fbid"], a[href*="/permalink/"]');
    if (timeLink) postUrl = timeLink.href;

    return {
      text: fullText.substring(0, 3000), // Limit to 3000 chars
      author,
      timestamp,
      images: images.slice(0, 5),
      links: links.slice(0, 5),
      postUrl,
      pageUrl: window.location.href
    };
  }

  function highlightPost(container) {
    if (lastHighlighted) {
      lastHighlighted.style.outline = '';
      lastHighlighted.style.outlineOffset = '';
    }
    if (container) {
      container.style.outline = '2px solid #1877f2';
      container.style.outlineOffset = '2px';
      lastHighlighted = container;
    }
  }

  function showClickFeedback(x, y) {
    if (!clickIndicator) {
      clickIndicator = document.createElement('div');
      clickIndicator.id = 'fb-analyzer-indicator';
      clickIndicator.style.cssText = `
        position: fixed;
        z-index: 999999;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(24,119,242,0.9);
        color: white;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
      `;
      document.body.appendChild(clickIndicator);
    }
    clickIndicator.innerHTML = `<span style="font-size:16px">🔍</span> Analyzing post...`;
    clickIndicator.style.left = Math.min(x + 10, window.innerWidth - 200) + 'px';
    clickIndicator.style.top = Math.max(y - 40, 10) + 'px';
    clickIndicator.style.opacity = '1';
    setTimeout(() => {
      if (clickIndicator) clickIndicator.style.opacity = '0';
    }, 2000);
  }

  let analysisEnabled = true;

  // Listen for enable/disable from sidebar
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_ANALYSIS_ENABLED') {
      analysisEnabled = msg.enabled;
    }
  });

  document.addEventListener('click', (e) => {
    if (!analysisEnabled) return;

    const container = getPostContainer(e.target);
    if (!container) return;

    const postData = extractPostData(container);
    if (!postData || !postData.text || postData.text.length < 20) return;

    highlightPost(container);
    showClickFeedback(e.clientX, e.clientY);

    // Send to background for sidebar
    chrome.runtime.sendMessage({
      type: 'ANALYZE_POST',
      data: postData
    });
  }, true);

  // Notify sidebar that content script is ready
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' });

})();
