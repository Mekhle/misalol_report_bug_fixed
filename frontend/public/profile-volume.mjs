// One controller per profile root. Operates on the existing player/video only.
export function mountVolume(root, options = {}) {
  if (root.querySelector(':scope > [data-profile-volume]')) return () => {};
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.profileVolume = ''; button.className = 'profile-volume';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4z"/><g data-sound-on><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></g><g data-sound-off><path d="m16 9 5 6m0-6-5 6"/></g></svg>';
  root.appendChild(button);
  let preferred = null, stopped = false, timer = 0;
  const media = new Set();
  const selectors = options.video ? '[data-bg-video],video.bg-video' : 'audio:not([data-click-sound])';
  const sync = () => {
    const list = [...media];
    const muted = !list.length || list.every(m => m.muted || m.volume === 0 || m.paused);
    button.dataset.muted = String(muted);
    button.setAttribute('aria-label', muted ? 'Unmute profile audio' : 'Mute profile audio');
    button.setAttribute('aria-pressed', String(muted));
    button.title = muted ? 'Unmute profile audio' : 'Mute profile audio';
  };
  const discover = () => {
    for (const m of media) if (!root.contains(m)) { ['volumechange','play','pause'].forEach(e => m.removeEventListener(e, sync)); media.delete(m); }
    root.querySelectorAll(selectors).forEach(m => {
      if (media.has(m)) return;
      media.add(m);
      if (preferred !== null) m.muted = preferred;
      ['volumechange','play','pause'].forEach(e => m.addEventListener(e, sync));
    });
    sync();
  };
  button.addEventListener('click', e => {
    e.stopPropagation(); discover();
    preferred = button.dataset.muted !== 'true';
    for (const m of media) {
      m.muted = preferred;
      if (!preferred) {
        if (m.volume === 0) m.volume = Math.max(.01, Math.min(1, options.volume || .65));
        void m.play().catch(() => { m.muted = true; sync(); });
      }
    }
    sync();
  });
  button.addEventListener('pointerdown', e => e.stopPropagation());
  const observer = new MutationObserver(discover); observer.observe(root, { childList: true, subtree: true }); discover();
  // WCAG luminance selects the foreground; a matching opaque-enough glass plate
  // guarantees contrast even for cross-origin media that cannot be sampled.
  const paint = rgb => {
    const linear = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    const darkInk = luminance > .179;
    button.style.color = darkInk ? '#111111' : '#ffffff';
    button.style.backgroundColor = darkInk ? 'rgba(255,255,255,.86)' : 'rgba(8,8,13,.82)';
    button.style.borderColor = darkInk ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.24)';
  };
  const fallback = /^#[\da-f]{6}$/i.test(options.background || '') ? [1,3,5].map(i => parseInt(options.background.slice(i,i+2),16)) : [8,8,13];
  paint(fallback);
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let backgroundImage;
  if (options.image) { backgroundImage = new Image(); backgroundImage.crossOrigin = 'anonymous'; backgroundImage.src = options.image; }
  const sample = () => {
    if (stopped) return;
    if (!document.hidden && context) {
      const video = root.querySelector('[data-bg-video],video.bg-video');
      const source = video?.readyState >= 2 ? video : backgroundImage?.complete && backgroundImage.naturalWidth ? backgroundImage : null;
      if (source) try {
        const w = source.videoWidth || source.naturalWidth, h = source.videoHeight || source.naturalHeight;
        const box = root.getBoundingClientRect(), b = button.getBoundingClientRect();
        const scale = Math.max(box.width / w, box.height / h);
        const x = ((b.left - box.left + b.width / 2) + (w * scale - box.width) / 2) / scale;
        const y = ((b.top - box.top + b.height / 2) + (h * scale - box.height) / 2) / scale;
        context.drawImage(source, Math.max(0,x), Math.max(0,y), 1, 1, 0, 0, 1, 1);
        paint([...context.getImageData(0,0,1,1).data].slice(0,3));
      } catch { paint(fallback); }
    }
    timer = window.setTimeout(sample, 2000);
  };
  sample();
  return () => { stopped = true; clearTimeout(timer); observer.disconnect(); for (const m of media) ['volumechange','play','pause'].forEach(e => m.removeEventListener(e, sync)); button.remove(); };
}
