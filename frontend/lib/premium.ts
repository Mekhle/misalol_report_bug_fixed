import type { ProfileConfig, ProfileSection, ProfileWidget } from "./types";

export const CURSOR_EFFECTS = ["None", "Cursor Cat", "Snowflakes", "Ghost Cursor", "Following Dot", "Bubbles"] as const;
export const CLICK_PRESETS = ["None", "Crisp Click", "Pixel Click", "Bass Tick", "Mouse Click", "Custom"] as const;
export const BORDER_TYPES = ["Static", "Dashed", "Shimmer", "Pulse"] as const;
export interface PremiumSettings {
  effectColors?: Partial<Record<import("./effect-colors").ColoredEffect, string>>;
  version: 1;
  cursorEffect: typeof CURSOR_EFFECTS[number];
  cursorColor: string;
  clickPreset: typeof CLICK_PRESETS[number];
  entrySubtitle: string;
  typewriterTexts: string[];
  hero: "Classic" | "Centered";
  borderType: typeof BORDER_TYPES[number];
  borderOpacity: number;
  borderEnabled: boolean;
}
export const PREMIUM_DEFAULTS: PremiumSettings = { version: 1, cursorEffect: "None", cursorColor: "#ffffff", clickPreset: "None", entrySubtitle: "", typewriterTexts: [], hero: "Classic", borderType: "Static", borderOpacity: 100, borderEnabled: true };
export function premiumSettings(config: ProfileConfig): PremiumSettings {
  return { ...PREMIUM_DEFAULTS, ...config.settings.premium };
}
export type IntegrationCard = { enabled: boolean; type: ProfileWidget["type"] | "presence"; value: string };
export function sectionWidgets(sections: ProfileSection[] = []): ProfileWidget[] {
  return sections.filter(s => s.enabled).flatMap(s => (["leftCard", "rightCard"] as const).flatMap(side => {
    const card = s[side];
    return card?.enabled && card.type !== "presence" ? [{ id: `${s.id.slice(0, 38)}-${side === "leftCard" ? "l" : "r"}`, type: card.type, enabled: true, value: card.value }] : [];
  }));
}
export function profileWidgets(config: ProfileConfig) {
  return [...config.widgets.filter(w => w.enabled), ...sectionWidgets(config.sections)];
}
