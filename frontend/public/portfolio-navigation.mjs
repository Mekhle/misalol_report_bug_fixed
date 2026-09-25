import { mountPortfolioScene } from "./portfolio-scene.mjs?v=20260922-scroll";
// Canonical HTML uses the same section boundaries and styles as the React preview.
const root = document.querySelector('[data-profile-kind="Portfolio"]');
if (root) {
  const sections = [...root.querySelectorAll('[data-portfolio-section]')];
  if (sections.length > 1) {
    const nav = document.createElement('nav');
    nav.className = 'portfolio-navigation';
    nav.setAttribute('aria-label', 'Profile sections');
    const navigate = node => node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    const buttons = sections.map((section, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Go to ${section.querySelector('h2')?.textContent || (i ? `section ${i}` : 'Profile')}`);
      button.append(document.createElement('span'));
      button.addEventListener('click', () => navigate(section));
      nav.append(button);
      return button;
    });
    root.append(nav);
    root.querySelector('[data-portfolio-next]')?.addEventListener('click', () => navigate(sections[1]));
    const cleanup = mountPortfolioScene(root, { animation: root.dataset.pageEnter || 'Fade', onActive: id => {
      buttons.forEach((button, i) => { if (sections[i].dataset.portfolioSection === id) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current'); });
    } });
    addEventListener('pagehide', cleanup, { once:true });
  } else {
    const cleanup = mountPortfolioScene(root, { animation: root.dataset.pageEnter || 'Fade' });
    addEventListener('pagehide', cleanup, { once:true });
  }
}
