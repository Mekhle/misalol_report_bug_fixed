// Visible clip changes at ~0.53, .80, .83, 1.00 and 1.20 seconds.
// The final smile hold is an authored, restrained loop join (not present in the clip).
const eyes = [
 'M20 24l18 18m0-18L20 42M102 24l18 18m0-18l-18 18',
 'M29 20v27m-12-14h24M111 20v27m-12-14h24',
 'M29 17l11 20-11 20-11-20ZM111 17l11 20-11 20-11-20Z',
 'M18 38l11-20 11 20M100 38l11-20 11 20',
 'M18 24l23 9-23 9M122 24l-23 9 23 9',
 'M17 33h25M98 33h25'
];
const mouths = ['M56 64h28','M56 64h28','M70 70h.1','M56 64h28','M66 58q4-5 8 0v9q-4 5-8 0Z','M64 60q6 10 12 0'];
const durations = [533,267,33,167,200,1000];
export function mountEmpty(host) {
  host.innerHTML = `<svg viewBox="0 0 140 90" focusable="false" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="miter"><path/><path/></svg>`;
  const [eye, mouth] = host.querySelectorAll('path');
  let index = 0, timer, visible = false, remaining = durations[0], started = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const paint = () => { eye.setAttribute('d', eyes[index]); mouth.setAttribute('d', mouths[index]); mouth.setAttribute('stroke-linecap', index === 2 ? 'round' : 'butt'); mouth.setAttribute('stroke-width', index >= 4 ? '4' : '7'); };
  const stop = () => { if (timer) { clearTimeout(timer); timer = undefined; remaining = Math.max(1, remaining - (performance.now() - started)); } };
  const run = () => {
    stop();
    if (reduce.matches) { index = 0; remaining = durations[0]; paint(); return; }
    if (!visible || document.hidden) return;
    started = performance.now();
    timer = setTimeout(() => { timer = undefined; index = (index + 1) % eyes.length; remaining = durations[index]; paint(); run(); }, remaining);
  };
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; run(); });
  paint(); observer.observe(host);
  document.addEventListener('visibilitychange', run); reduce.addEventListener('change', run);
  return () => { stop(); observer.disconnect(); document.removeEventListener('visibilitychange', run); reduce.removeEventListener('change', run); host.replaceChildren(); };
}
