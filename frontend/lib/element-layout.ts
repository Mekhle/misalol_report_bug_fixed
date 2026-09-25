import type { CSSProperties } from "react";
import type { ProfileConfig } from "./types";

export type LayoutElement = "frame" | "discord" | "audio" | `widget:${string}`;
export type LayoutViewport = "desktop" | "mobile";
/** x is a percentage of available horizontal travel; y, width and height are pixels.
 * A zero width fills the container and a zero height fits content. */
export interface ElementBox { x: number; y: number; width: number; height: number }
export interface ElementLayouts {
  version: 1 | 2;
  desktop?: Partial<Record<LayoutElement, ElementBox>>;
  mobile?: Partial<Record<LayoutElement, ElementBox>>;
}
export function constrainBox(id: LayoutElement, box: ElementBox): ElementBox {
  const limit = (n: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0)));
  return { x: limit(box.x, -100, 100), y: limit(box.y, id === "frame" ? -400 : 0, 400), width: box.width ? limit(box.width, id === "frame" ? 260 : 160, 1040) : 0, height: limit(box.height, 0, 1000) };
}
/** Version 1 audio used viewport coordinates on desktop. Its offsets have no
 * equivalent inside a media slot; retain its dimensions and mobile placement. */
export function normalizeLayouts(layouts?: ElementLayouts): ElementLayouts {
  const next: ElementLayouts = { version: 2 };
  for (const viewport of ["desktop", "mobile"] as const) {
    const entries = layouts?.[viewport];
    if (!entries) continue;
    next[viewport] = {};
    for (const [key, value] of Object.entries(entries)) {
      if (!value || !(key === "frame" || key === "discord" || key === "audio" || (key.startsWith("widget:") && key.length > 7 && key.length <= 167))) continue;
      const id = key as LayoutElement;
      next[viewport]![id] = constrainBox(id, layouts?.version === 1 && viewport === "desktop" && id === "audio" ? { ...value, x: 0, y: 0 } : value);
    }
  }
  return next;
}
export function updateElementLayout(settings: ProfileConfig["settings"], viewport: LayoutViewport, id: LayoutElement, box: ElementBox): ElementLayouts {
  const layouts = normalizeLayouts(settings.elementLayouts);
  return { ...layouts, [viewport]: { ...layouts[viewport], [id]: constrainBox(id, box) } };
}
export function elementBox(settings: ProfileConfig["settings"], id: LayoutElement, viewport: LayoutViewport): ElementBox {
  const saved = normalizeLayouts(settings.elementLayouts)[viewport]?.[id];
  if (saved) return constrainBox(id, saved);
  if (id !== "frame" || viewport === "mobile") return { x: 0, y: 0, width: 0, height: 0 };
  const width = settings.profileFrameWidth ?? 430;
  return constrainBox(id, {
    x: (settings.profileFrameX ?? 0) * 2 + (settings.cardAlign === "left" ? -100 : settings.cardAlign === "right" ? 100 : 0),
    y: Math.max(0, (settings.profileFrameY ?? 0) * 4),
    width: (width === 430 ? 880 : width) * (settings.profileFrameScale ?? 100) / 100,
    height: settings.profileFrameHeight ?? 0,
  });
}
export function elementStyle(settings: ProfileConfig["settings"], id: LayoutElement): CSSProperties {
  const style: Record<string, string | number> = {};
  for (const viewport of ["desktop", "mobile"] as const) {
    const box = elementBox(settings, id, viewport);
    style[`--${viewport}-width`] = box.width ? `${box.width}px` : "100%";
    style[`--${viewport}-height`] = `${box.height}px`;
    style[`--${viewport}-x`] = (box.x + 100) / 200;
    style[`--${viewport}-y`] = `${box.y}px`;
  }
  return style as CSSProperties;
}
