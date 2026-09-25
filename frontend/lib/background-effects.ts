import type { BackgroundEffect } from "./types";

export const BACKGROUND_EFFECTS: ReadonlyArray<{ value: BackgroundEffect; label: string; description: string }> = [
  { value: "None", label: "None", description: "No background particles." },
  { value: "Snowflakes", label: "Snowflakes", description: "Slow, detailed flakes drifting across the page." },
  { value: "Snow", label: "Snow", description: "Classic Snowstorm-style flakes with varied speed and pointer-driven wind." },
  { value: "Sakura", label: "Sakura", description: "Original Sakura.js petals with randomized wind, fall, and sway." },
  { value: "Rain", label: "Rain", description: "Original Codrops 10/25 WebGL drizzle with refracting water drops." },
  { value: "Fireflies", label: "Fireflies", description: "Tiny warm lights blinking and drifting slowly across the page." },
];

export const BACKGROUND_EFFECT_VALUES = BACKGROUND_EFFECTS.map((item) => item.value);

export function isBackgroundEffect(value: unknown): value is BackgroundEffect {
  return BACKGROUND_EFFECT_VALUES.includes(value as BackgroundEffect);
}