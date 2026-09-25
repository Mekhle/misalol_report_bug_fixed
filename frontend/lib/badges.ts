import type { ProfileBadge, ProfileConfig } from "./types";
import { dashboardRequest, peekDashboardCache, setDashboardCache } from "./dashboard-cache";

export type AchievementProgress = { current: number; target: number; label: string; percent: number };
export type AchievementBadge = ProfileBadge & {
  slug: string;
  rarity: string;
  category_slug?: string | null;
  category_name?: string | null;
  progress?: AchievementProgress | null;
  source?: "AUTOMATIC" | "MANUAL" | "PURCHASE" | null;
  earned_at?: string | null;
  featured?: boolean;
  featured_order?: number;
  purchasable?: boolean;
  price_minor?: number | null;
  currency?: string;
  asset_url?: string;
  preview_url?: string;
};
export type AchievementRank = {
  id: string;
  slug: string;
  name: string;
  description: string;
  level: number;
  color: string;
  owned: boolean;
  progress?: AchievementProgress | null;
  source?: "AUTOMATIC" | "MANUAL" | "PURCHASE" | null;
  earned_at?: string | null;
  badges?: Array<{ id: string; name: string; previewUrl?: string; assetUrl?: string }>;
};
export type AchievementCollection = {
  categories: Array<{ id: string; slug: string; name: string; description: string }>;
  badges: AchievementBadge[];
  ranks: AchievementRank[];
  currentRank: AchievementRank | null;
  featuredLimit: number;
};

export const BADGES_CACHE_KEY = "badges:me";

function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function normalizeRank(item: Record<string, unknown>): AchievementRank {
  return { ...item, badges: asArray(item.badges) } as AchievementRank;
}

function normalizeAchievementBadge(item: Record<string, unknown>): AchievementBadge {
  return {
    ...item,
    previewUrl: item.previewUrl || item.preview_url || item.icon,
    assetUrl: item.assetUrl || item.asset_url,
    enabled: Boolean(item.featured),
    color: item.color || "#9b87f5",
  } as AchievementBadge;
}

function normalizeCollection(body: Record<string, unknown>): AchievementCollection {
  const badges = asArray<Record<string, unknown>>(body.badges).map(normalizeAchievementBadge);
  const ranks = asArray<Record<string, unknown>>(body.ranks).map(normalizeRank);
  const currentRank = body.currentRank && typeof body.currentRank === "object" ? normalizeRank(body.currentRank as Record<string, unknown>) : null;
  return {
    categories: asArray(body.categories),
    badges,
    ranks,
    currentRank,
    featuredLimit: Number(body.featuredLimit || 5),
  };
}

export function peekBadgeCollection() {
  return peekDashboardCache<AchievementCollection>(BADGES_CACHE_KEY);
}

export function cacheBadgeCollection(collection: AchievementCollection) {
  return setDashboardCache(BADGES_CACHE_KEY, collection);
}

export function loadBadgeCollection(force = false): Promise<AchievementCollection> {
  return dashboardRequest(BADGES_CACHE_KEY, async () => {
    const response = await fetch("/api/v1/badges/me", { credentials: "include", cache: "no-store" });
    const body = await response.json() as Record<string, unknown> & { detail?: string };
    if (!response.ok) throw new Error(body.detail || "Could not load your badges.");
    return normalizeCollection(body);
  }, { maxAge: 5 * 60_000, force });
}
export function mergeBadgeCatalog(badges: ProfileBadge[]): ProfileBadge[] {
  return (badges || []).map((badge) => ({ ...badge, monochrome: Boolean(badge.monochrome) }));
}

export function moveOwnedBadge(badges: ProfileBadge[], ownedIndex: number, direction: -1 | 1): ProfileBadge[] {
  const owned = badges.filter((badge) => badge.owned);
  const locked = badges.filter((badge) => !badge.owned);
  const next = ownedIndex + direction;
  if (next < 0 || next >= owned.length) return badges;
  const copy = [...owned];
  [copy[ownedIndex], copy[next]] = [copy[next], copy[ownedIndex]];
  return [...copy, ...locked];
}

export function hasVerifiedBadge(badges: ProfileBadge[] | undefined) {
  return (badges || []).some((badge) => badge.id === "verified" && badge.owned);
}

export function badgePaint(badge: ProfileBadge, settings: ProfileConfig["settings"]) {
  const color = badge.monochrome ? settings.iconColor : badge.color;
  return { color, backgroundColor: `${color}22`, borderColor: `${color}66`, boxShadow: settings.badgeGlow ? `0 0 18px ${color}4d` : undefined };
}