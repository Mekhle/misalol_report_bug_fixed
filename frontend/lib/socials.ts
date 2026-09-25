import { mergeBadgeCatalog } from "./badges";
import type { ProfileConfig, SocialAlign, SocialLink, SocialPlatform } from "./types";
import { normalizeSections } from "./sections";
import { normalizeWidgets } from "./widgets";

export const SOCIAL_ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const SOCIAL_ICON_MAX_BYTES = 512_000;
const MAX_SOCIALS = 40;
const MAX_VALUE_LENGTH = 500;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_ICON_PREFIX = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

export function createSocialId(platform: SocialPlatform) {
  const slug = platform.toLowerCase().replaceAll(" ", "-");
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${slug}-${unique}`;
}

export function defaultSocialAction(link: Pick<SocialLink, "action" | "displayMode">): "open" | "copy" {
  if (link.action === "open" || link.action === "copy") return link.action;
  return link.displayMode === "text" ? "copy" : "open";
}

export const PLATFORM_URL_PREFIXES: Partial<Record<SocialPlatform, { display: string; hosts: string[] }>> = {
  YouTube: { display: "youtube.com/@", hosts: ["youtube.com", "m.youtube.com"] },
  Discord: { display: "discord.gg/", hosts: ["discord.gg", "discord.com"] },
  Instagram: { display: "instagram.com/", hosts: ["instagram.com"] },
  X: { display: "x.com/", hosts: ["x.com", "twitter.com"] },
  TikTok: { display: "tiktok.com/@", hosts: ["tiktok.com"] },
  Telegram: { display: "t.me/", hosts: ["t.me", "telegram.me", "telegram.dog"] },
  Spotify: { display: "open.spotify.com/", hosts: ["open.spotify.com"] },
  SoundCloud: { display: "soundcloud.com/", hosts: ["soundcloud.com"] },
  GitHub: { display: "github.com/", hosts: ["github.com"] },
  Reddit: { display: "reddit.com/u/", hosts: ["reddit.com", "www.reddit.com"] },
  Twitch: { display: "twitch.tv/", hosts: ["twitch.tv"] },
  Snapchat: { display: "snapchat.com/add/", hosts: ["snapchat.com"] },
  Facebook: { display: "facebook.com/", hosts: ["facebook.com", "fb.com"] },
  LinkedIn: { display: "linkedin.com/in/", hosts: ["linkedin.com"] },
  Steam: { display: "steamcommunity.com/id/", hosts: ["steamcommunity.com"] },
  Roblox: { display: "roblox.com/users/", hosts: ["roblox.com"] },
  PayPal: { display: "paypal.me/", hosts: ["paypal.me", "paypal.com"] },
  Pinterest: { display: "pinterest.com/", hosts: ["pinterest.com"] },
  Patreon: { display: "patreon.com/", hosts: ["patreon.com"] },
  Threads: { display: "threads.net/@", hosts: ["threads.net"] },
  Kick: { display: "kick.com/", hosts: ["kick.com"] },
};

export function platformUrlPrefix(platform: SocialPlatform) {
  return PLATFORM_URL_PREFIXES[platform] || null;
}

function stripUrlDecorations(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

export function extractSocialHandle(platform: SocialPlatform, value: string) {
  const spec = platformUrlPrefix(platform);
  let handle = value.trim();
  if (!spec || !handle) return handle;

  handle = stripUrlDecorations(handle);
  const prefixes = [spec.display, ...spec.hosts.map((host) => `${host}/`)];
  for (const prefix of prefixes) {
    const normalized = prefix.replace(/^www\./i, "");
    if (handle.toLowerCase().startsWith(normalized.toLowerCase())) {
      handle = handle.slice(normalized.length);
      break;
    }
  }
  handle = handle.replace(/^\/+/, "");
  if (spec.display.endsWith("@") && handle.startsWith("@")) handle = handle.slice(1);
  return handle.slice(0, MAX_VALUE_LENGTH);
}

export function composeSocialValue(platform: SocialPlatform, handle: string) {
  const spec = platformUrlPrefix(platform);
  const cleaned = extractSocialHandle(platform, handle);
  if (!spec) return handle.trim().slice(0, MAX_VALUE_LENGTH);
  if (!cleaned) return "";
  return `${spec.display}${cleaned}`.slice(0, MAX_VALUE_LENGTH);
}

export function isForeignSocialHost(platform: SocialPlatform, handle: string) {
  const spec = platformUrlPrefix(platform);
  if (!spec) return false;
  const trimmed = handle.trim();
  if (!trimmed || trimmed.startsWith("mailto:")) return false;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.includes("://") || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(stripUrlDecorations(trimmed))
    ? stripUrlDecorations(trimmed)
    : "";
  if (!candidate) return false;
  const host = candidate.split("/")[0]?.toLowerCase().replace(/^www\./, "");
  if (!host || !host.includes(".")) return false;
  return !spec.hosts.some((allowed) => allowed.replace(/^www\./, "") === host);
}

export function sanitizeSocialHref(value: string, platform: SocialPlatform): string | null {
  const composed = composeSocialValue(platform, value);
  const trimmed = composed.trim().slice(0, MAX_VALUE_LENGTH);
  if (!trimmed) return null;

  if (platform === "Email" || trimmed.toLowerCase().startsWith("mailto:")) {
    const address = trimmed.replace(/^mailto:/i, "").trim();
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) return `mailto:${address}`;
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")) return parsed.href;
  const spec = platformUrlPrefix(platform);
  if (spec) {
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!spec.hosts.some((allowed) => allowed.replace(/^www\./i, "") === host)) return null;
  }
  return parsed.href;
}

export function isSafeSocialIconUrl(url: string | null | undefined): url is string {
  if (!url || url.length > 2048) return false;
  if (SAFE_ICON_PREFIX.test(url)) return url.length <= SOCIAL_ICON_MAX_BYTES * 2;
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  return HEX_COLOR.test(value) ? value : null;
}

export const PLATFORM_ICON_COLORS: Record<SocialPlatform, string> = {
  YouTube: "#ff6b68",
  Discord: "#8d9bff",
  Instagram: "#ef9cbb",
  X: "#f5f5f5",
  TikTok: "#8ee8e0",
  Telegram: "#73c5ea",
  Spotify: "#7edb9a",
  SoundCloud: "#ff8c4b",
  GitHub: "#d6d6df",
  Reddit: "#ff8b6b",
  Twitch: "#c59bff",
  Snapchat: "#ffe566",
  Facebook: "#8bb4ff",
  LinkedIn: "#6eb0ff",
  Steam: "#b7c7d9",
  Roblox: "#ffb4b4",
  PayPal: "#7ec8ff",
  Pinterest: "#ff8a9b",
  Patreon: "#ff8f7a",
  Threads: "#f0f0f0",
  Kick: "#7dff6b",
  Bitcoin: "#f7931a",
  Ethereum: "#8c8cff",
  Litecoin: "#b8b8b8",
  Solana: "#c084fc",
  Email: "#d8d3ff",
  "Custom URL": "#b5aaff",
};

export const DEFAULT_ICON_COLOR = "#d8d3ff";

export function resolveIconColor(link: Pick<SocialLink, "platform" | "iconColor">, globalIconColor = DEFAULT_ICON_COLOR) {
  const perLink = sanitizeHexColor(link.iconColor);
  if (perLink) return perLink;
  const global = sanitizeHexColor(globalIconColor);
  if (global && global.toLowerCase() !== DEFAULT_ICON_COLOR) return global;
  return PLATFORM_ICON_COLORS[link.platform] || global || DEFAULT_ICON_COLOR;
}

export function cardIconColor(
  link: Pick<SocialLink, "platform" | "iconColor">,
  settings: Pick<ProfileConfig["settings"], "iconColor" | "monochromeIcons">,
) {
  if (settings.monochromeIcons) return sanitizeHexColor(settings.iconColor) || DEFAULT_ICON_COLOR;
  return resolveIconColor(link, settings.iconColor);
}

export function resolveIconGlow(link: Pick<SocialLink, "iconGlow">, socialGlow: boolean) {
  return typeof link.iconGlow === "boolean" ? link.iconGlow : socialGlow;
}

export function normalizeSocialLink(raw: Partial<SocialLink> & { customIcon?: SocialLink["customIcon"] }, fallbackIndex = 0): SocialLink {
  const platform = (raw.platform || "Custom URL") as SocialPlatform;
  const id = typeof raw.id === "string" && raw.id.trim() && raw.id.length <= 80
    ? raw.id.trim()
    : createSocialId(platform) + (fallbackIndex ? `-${fallbackIndex}` : "");
  const displayMode = raw.displayMode === "text" ? "text" : "link";
  const action = raw.action === "copy" || raw.action === "open" ? raw.action : undefined;
  const customIconUrl = isSafeSocialIconUrl(typeof raw.customIcon === "object" && raw.customIcon ? raw.customIcon.url : null)
    ? raw.customIcon!.url
    : null;
  return {
    id,
    platform,
    label: String(raw.label || platform).slice(0, 64),
    value: displayMode === "link" ? composeSocialValue(platform, String(raw.value || "")) : String(raw.value || "").slice(0, MAX_VALUE_LENGTH),
    enabled: Boolean(raw.enabled),
    displayMode,
    clicks: Number.isFinite(Number(raw.clicks)) ? Math.max(0, Number(raw.clicks)) : 0,
    action,
    iconColor: sanitizeHexColor(typeof raw.iconColor === "string" ? raw.iconColor : null),
    iconGlow: typeof raw.iconGlow === "boolean" ? raw.iconGlow : undefined,
    customIcon: customIconUrl ? { url: customIconUrl, name: raw.customIcon?.name, type: raw.customIcon?.type } : null,
  };
}

export function normalizeSocialAlign(value: unknown): SocialAlign {
  return value === "left" || value === "right" || value === "center" ? value : "center";
}

export function normalizeProfileSocials(config: ProfileConfig): ProfileConfig {
  return {
    ...config,
    settings: {
      ...config.settings,
      socialAlign: normalizeSocialAlign(config.settings.socialAlign),
    },
    socials: (() => {
      const seen = new Set<string>();
      return (config.socials || []).slice(0, MAX_SOCIALS).map((social, index) => {
        const next = normalizeSocialLink(social, index);
        if (seen.has(next.id)) next.id = `${next.id}-${index}`.slice(0, 80);
        seen.add(next.id);
        return next;
      });
    })(),
    badges: mergeBadgeCatalog(config.badges || []),
    widgets: normalizeWidgets(config.widgets),
    sections: normalizeSections(config.sections),
  };
}

export async function iconFromFile(file: File) {
  if (!SOCIAL_ICON_TYPES.includes(file.type as (typeof SOCIAL_ICON_TYPES)[number])) {
    throw new Error("Use a PNG, JPG, WebP, or GIF icon.");
  }
  if (file.size > SOCIAL_ICON_MAX_BYTES) {
    throw new Error("That icon is too large. Keep it under 512KB.");
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (!isSafeSocialIconUrl(data)) throw new Error("That file could not be used as an icon.");
  return { url: data, name: file.name, type: file.type };
}
