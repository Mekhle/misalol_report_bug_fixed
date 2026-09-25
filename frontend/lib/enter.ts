export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function playClickSound(url?: string | null, preset = "Crisp Click") {
  if (preset === "None") return;
  if (typeof window === "undefined") return;
  if (url) {
    const audio = new Audio(url);
    audio.volume = 0.35;
    void audio.play().catch(() => undefined);
    return;
  }
  if (preset === "Custom") return;
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = preset === "Pixel Click" ? "square" : preset === "Mouse Click" ? "triangle" : "sine";
  osc.frequency.value = preset === "Bass Tick" ? 140 : preset === "Pixel Click" ? 1200 : preset === "Mouse Click" ? 1800 : 880;
  gain.gain.value = 0.05;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
  osc.stop(ctx.currentTime + 0.09);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); void ctx.close(); };
}
