import type { BackgroundEffect, ProfileConfig } from "./types";
export const EFFECT_COLORS = { Fireflies: "#fcd271", Snowflakes: "#ffffff", Snow: "#ffffff", Sakura: "#ffb7c5" } as const;
export type ColoredEffect = keyof typeof EFFECT_COLORS;
export function effectColor(config: ProfileConfig, effect: BackgroundEffect = config.settings.backgroundEffect) {
  const value = config.settings.premium?.effectColors?.[effect as ColoredEffect];
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}
export function colorRgb(color: string | undefined, fallback: string) {
  const safe = color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  return [1, 3, 5].map(i => parseInt(safe.slice(i, i + 2), 16)).join(",");
}
