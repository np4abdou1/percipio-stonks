globalThis.PercipioNavigation = (() => {
  function findNextCourseLink(root, currentHref) {
    const current = new URL(currentHref);
    const currentCourse = current.pathname.match(/\/courses\/([^/]+)/)?.[1];
    const candidates = [];
    for (const link of root.querySelectorAll('a[href]')) {
      if (link.closest('#pai-root, [hidden], [aria-hidden="true"]') || link.getAttribute('aria-disabled') === 'true' || !link.getClientRects().length) continue;
      let target;
      try { target = new URL(link.href, currentHref); } catch { continue; }
      const course = target.pathname.match(/^\/courses\/([^/]+)\/?$/)?.[1];
      if (target.origin !== current.origin || !course || course === currentCourse) continue;

      // Prefer semantic navigation signals, then English/Arabic label fallbacks.
      const rel = (link.getAttribute('rel') || '').split(/\s+/);
      const marker = (link.getAttribute('data-marker') || '').replace(/([a-z])([A-Z])/g, '$1.$2');
      const labels = [link.getAttribute('aria-label'), link.getAttribute('title'), link.textContent].filter(Boolean);
      const forwardLabel = labels.some(label => /\bnext\s+(?:(?:item|course)\b|in\s+(?:(?:the|this)\s+)?(?:path|journey)\b)|التالي في المسار|العنصر التالي|الدورة التالية/i.test(label));
      const forwardMarker = /(?:^|[._-])next(?:[._-]|$)/i.test(marker) && /course|item|path|journey/i.test(marker);
      const inNavigation = Boolean(link.closest('nav, [role="navigation"], [class*="NavigationBar"]'));
      const shortLabel = inNavigation && labels.some(label => /^(next|التالي)\s*[›»→]?$/i.test(label.trim()));
      const score = rel.includes('next') ? 3 : forwardMarker ? 2 : forwardLabel || shortLabel ? 1 : 0;
      if (score) candidates.push({ link, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.link || null;
  }

  return { findNextCourseLink };
})();

if (typeof module !== 'undefined') module.exports = globalThis.PercipioNavigation;
