/** Shared foreground transitions for React previews and canonical public HTML. */
export function mountPortfolioScene(root, { animation = 'Fade', onActive = () => {} } = {}) {
  const scroller = root.querySelector('.profile-composition');
  const viewport = scroller && getComputedStyle(scroller).overflowY === 'auto' ? scroller : null;
  const sections = [...root.querySelectorAll('[data-portfolio-section]')];
  const images = [...root.querySelectorAll('.profile-project > img')];
  const failedImage = event => { event.currentTarget.style.display = 'none'; };
  images.forEach(image => { image.addEventListener('error', failedImage); if (image.complete && !image.naturalWidth) image.style.display = 'none'; });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Ease mouse-wheel steps while leaving touch, zoom and nested controls native.
  const scrollHost = viewport || document.scrollingElement;
  let wheelFrame = 0, wheelTarget = 0, lastFrame = 0;
  const stopWheel = () => { cancelAnimationFrame(wheelFrame); wheelFrame = 0; };
  const easeWheel = now => {
    const dt = Math.min(64, now - lastFrame); lastFrame = now;
    const current = scrollHost.scrollTop;
    const next = current + (wheelTarget - current) * (1 - Math.exp(-dt / 65));
    scrollHost.scrollTo({ top: Math.abs(wheelTarget - next) < .5 || Math.abs(next - current) < 1 ? wheelTarget : next, behavior: 'instant' });
    if (Math.abs(wheelTarget - scrollHost.scrollTop) > .5) wheelFrame = requestAnimationFrame(easeWheel);
    else wheelFrame = 0;
  };
  const wheel = event => {
    if (reduced.matches || event.ctrlKey || event.shiftKey || !event.cancelable || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    for (let node = event.target instanceof Element ? event.target : null; node && node !== root && node !== scrollHost; node = node.parentElement) {
      if (node.matches('input,textarea,select,[contenteditable],.synced-viewport')) return;
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return;
    }
    const max = scrollHost.scrollHeight - scrollHost.clientHeight;
    if (max <= 0) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollHost.clientHeight : 1);
    const base = wheelFrame ? wheelTarget : scrollHost.scrollTop;
    const next = Math.max(0, Math.min(max, base + delta));
    if (!wheelFrame && next === base) return;
    event.preventDefault(); wheelTarget = next;
    if (!wheelFrame) { lastFrame = performance.now(); wheelFrame = requestAnimationFrame(easeWheel); }
  };
  root.addEventListener('wheel', wheel, { passive: false });
  root.addEventListener('pointerdown', stopWheel);
  root.addEventListener('touchstart', stopWheel, { passive: true });
  root.addEventListener('keydown', stopWheel);
  reduced.addEventListener('change', stopWheel);
  const entriesByNode = new Map();
  let activeId = '';
  const groups = sections.flatMap(section => {
    const nodes = [...section.querySelectorAll('.portfolio-first-frame > .profile-header, .portfolio-first-frame > .profile-media-row, .portfolio-first-frame > .socials, .profile-first-identity > *, .portfolio-section-content > h2, .portfolio-section-content > section > *, .portfolio-showcase > *')];
    nodes.forEach((node, index) => {
      node.dataset.portfolioReveal = '';
      node.style.setProperty('--reveal-delay', `${Math.min(index, 4) * 75}ms`);
    });
    return nodes;
  });
  const update = () => {
    root.dataset.portfolioAnimation = reduced.matches ? 'None' : animation;
    let current = sections[0], best = -1;
    sections.forEach(section => {
      const entry = entriesByNode.get(section);
      if (!entry) return;
      const visible = entry.intersectionRect.height;
      const viewportHeight = entry.rootBounds?.height || innerHeight;
      const score = visible / Math.min(viewportHeight, entry.boundingClientRect.height || 1);
      if (score > best) { best = score; current = section; }
      const focused = section.contains(document.activeElement);
      section.dataset.portfolioPhase = section.dataset.portfolioPhase === 'visible' || focused || visible >= Math.min(viewportHeight, entry.boundingClientRect.height) * .12 ? 'visible' : entry.isIntersecting ? 'edge' : 'away';
    });
    const next = current?.dataset.portfolioSection || 'hero';
    if (next !== activeId) { activeId = next; onActive(next); }
  };
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entriesByNode.set(entry.target, entry));
    update();
  }, { root: viewport, threshold: Array.from({ length: 41 }, (_, i) => i / 40) });
  sections.forEach(section => { section.dataset.portfolioPhase = "away"; observer.observe(section); });
  root.addEventListener('focusin', update);
  root.addEventListener('focusout', update);
  reduced.addEventListener('change', update);
  update();
  return () => {
    observer.disconnect();
    stopWheel();
    root.removeEventListener('wheel', wheel);
    root.removeEventListener('pointerdown', stopWheel);
    root.removeEventListener('touchstart', stopWheel);
    root.removeEventListener('keydown', stopWheel);
    reduced.removeEventListener('change', stopWheel);
    images.forEach(image => image.removeEventListener("error", failedImage));
    root.removeEventListener('focusin', update);
    root.removeEventListener('focusout', update);
    reduced.removeEventListener('change', update);
    delete root.dataset.portfolioAnimation;
    sections.forEach(section => delete section.dataset.portfolioPhase);
    groups.forEach(node => { delete node.dataset.portfolioReveal; node.style.removeProperty('--reveal-delay'); });
  };
}
