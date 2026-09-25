import "server-only";

import { cloneMockProfile } from "@/lib/mock-data";
import type { ProfileConfig } from "@/lib/types";
import { database, one } from "./postgres";
import type { User } from "./users";

const colors = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const urlKinds = new Set(["avatar", "banner", "background", "backgroundVideo", "backgroundEffectVideo", "audio", "audioArtwork", "cursor", "ogImage", "favicon", "customFont", "clickSound", "entryIcon"]);
const text = (value: unknown, limit: number) => String(value || "").replace(/<[^>]*>/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, limit);
const number = (value: unknown, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function safeUrl(value: unknown, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw || raw === "misa:keep" || raw === "misa:remove") return raw;
  if (raw.startsWith("data:")) {
    return raw.length <= 2 * 1024 * 1024 ? raw : fallback;
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? raw : fallback;
  } catch { return fallback; }
}

function asset(raw: unknown, previous: unknown) {
  const incoming = record(raw); const old = record(previous); const oldUrl = typeof old.url === "string" ? old.url : ""; const url = safeUrl(incoming.url, oldUrl);
  const finalUrl = url === "misa:keep" ? String(old.url || "") : url === "misa:remove" ? null : url || null;
  return { url: finalUrl, name: text(incoming.name, 80), type: text(incoming.type, 40) };
}

export async function hasPremium(userId: string) {
  const row = await one<{ active: boolean }>("SELECT EXISTS(SELECT 1 FROM premium_entitlements WHERE user_id=$1 AND active=TRUE AND (expires_at IS NULL OR expires_at>NOW())) AS active", [userId]);
  return row?.active === true;
}

export function sanitizeProfilePayload(raw: unknown, user: User, existing: ProfileConfig | null): ProfileConfig {
  const input = record(raw); const defaults = cloneMockProfile(); const incomingProfile = record(input.profile); const incomingSettings = record(input.settings); const incomingAssets = record(input.assets); const previous = existing || defaults;
  const config: ProfileConfig = structuredClone(defaults);
  config.profile = { ...previous.profile, username: user.username || "", uid: user.id, displayName: text(incomingProfile.displayName, 128).trim() || user.display_name || user.username || "", description: text(incomingProfile.description, 4000), location: text(incomingProfile.location, 160), views: previous.profile.views || 0, joinedAt: user.created_at || previous.profile.joinedAt };
  const settingKeys = ["accentColor","usernameColor","usernameEffectColor","textColor","backgroundColor","iconColor","borderColor"] as const;
  config.settings = { ...previous.settings, ...config.settings };
  for (const key of settingKeys) { const candidate = String(incomingSettings[key] || ""); config.settings[key] = colors.test(candidate) ? candidate : (previous.settings[key] || config.settings[key]) as string; }
  for (const [key, fallback, min, max] of [["profileOpacity",10,0,80],["backgroundOpacity",88,20,100],["profileBlur",24,0,40],["profileRadius",24,0,80],["profileFrameOpacity",100,0,100],["profileFrameScale",100,50,150],["profileFrameWidth",430,260,800],["profileFrameHeight",0,0,1000],["profileFrameX",0,-45,45],["profileFrameY",0,-45,45],["fontSize",16,12,22],["letterSpacing",0,-2,8],["borderWidth",1,0,8],["bioTypeMs",55,20,160],["bioDeleteMs",35,20,160],["bioPauseMs",1200,400,4000]] as const) (config.settings as Record<string, unknown>)[key] = number(incomingSettings[key], fallback, min, max);
  for (const key of ["profileGradient","showViews","showBadges","showSocials","showJoinDate","showDiscordStatus","showUsername","showProfileFrame","showAvatar","showAvatarBorder","showDisplayName","bioTypewriter","tabTitleAnimate","clickSound","cardTilt","entryScreen","usernameGlow","socialGlow","badgeGlow","monochromeIcons","widgetColorSwap","ogOverlayAvatar","ogOverlayName","ogOverlayAddress"] as const) (config.settings as Record<string, unknown>)[key] = bool(incomingSettings[key], Boolean((previous.settings as Record<string, unknown>)[key]));
  for (const [key, allowed] of [["layout",["Default","Modern","Simplistic","Sleek","Portfolio"]],["avatarShape",["circle","rounded","square"]],["bannerShape",["rounded","square","pill"]],["buttonStyle",["glass","solid","outline"]],["profileFontScope",["all","name"]],["pageEnter",["None","Fade","Unfold","Pop"]],["backgroundEffect",["None","Snowflakes","Snow","Sakura","Rain","Fireflies"]],["usernameEffect",["None","Glow","Gradient","Shimmer","Rainbow","Fuzzy","Shuffle","Sparkle","Glitch","Pulse","Wave","Shadow"]],["socialAlign",["left","center","right"]],["cardAlign",["left","center","right"]]] as const) { const value = String(incomingSettings[key] || ""); (config.settings as Record<string, unknown>)[key] = (allowed as readonly string[]).includes(value) ? value : (previous.settings as Record<string, unknown>)[key]; }
  config.settings.entryText = text(incomingSettings.entryText, 160) || "click to enter..."; config.settings.ogTitle = text(incomingSettings.ogTitle, 70); config.settings.ogDescription = text(incomingSettings.ogDescription, 200);
  config.assets = { ...previous.assets, audioTitle: text(incomingAssets.audioTitle, 80), audioEnabled: bool(incomingAssets.audioEnabled, true), volume: number(incomingAssets.volume, 65, 0, 100), tracks: Array.isArray(incomingAssets.tracks) ? incomingAssets.tracks.slice(0, 8).map((item, index) => { const track = record(item); return { id: /^[\w-]{2,40}$/.test(String(track.id || "")) ? String(track.id) : `track-${index + 1}`, title: text(track.title, 80) || "Track", audio: asset(record(track.audio), {}), artwork: asset(record(track.artwork), {}) }; }).filter((track) => Boolean(track.audio.url)) : [] };
  for (const key of urlKinds) (config.assets as Record<string, unknown>)[key] = asset(incomingAssets[key], (previous.assets as Record<string, unknown>)[key]);
  config.socials = Array.isArray(input.socials) ? input.socials.slice(0, 40).map((item, index) => { const social = record(item); return { id: text(social.id,80) || `social-${index}`, platform: (text(social.platform,32) || "Custom URL") as ProfileConfig["socials"][number]["platform"], label: text(social.label,64), value: text(social.value,500), enabled: Boolean(social.enabled), displayMode: social.displayMode === "text" ? "text" : "link", clicks: 0, action: social.action === "copy" ? "copy" : "open" }; }) : [];
  config.widgets = Array.isArray(input.widgets) ? input.widgets.slice(0, 8).map((item,index) => { const widget=record(item); return { id:text(widget.id,40)||`widget-${index}`, type:text(widget.type,24) as ProfileConfig["widgets"][number]["type"], enabled:Boolean(widget.enabled), value:text(widget.value,500) }; }).filter((widget) => ["youtube","spotify","discord","telegram","roblox","github","lastfm","timezone","weather"].includes(widget.type)) : [];
  config.sections = Array.isArray(input.sections) ? input.sections.slice(0,12).map((item,index) => { const section=record(item); const kind=text(section.type,24); return { id:text(section.id,40)||`${kind}-${index}`, type:kind as ProfileConfig["sections"][number]["type"], enabled:Boolean(section.enabled), title:text(section.title,80), body:text(section.body, kind === "lyrics" ? 8000 : 4000), href:safeUrl(section.href), tags:Array.isArray(section.tags) ? section.tags.slice(0,16).map((tag)=>text(tag,24)).filter(Boolean) : [], cover:asset(section.cover,{}), subtitle:text(section.subtitle,160) }; }).filter((section) => ["about","project","skills","text","lyrics","integration"].includes(section.type)) : [];
  config.badges = previous.badges; return config;
}

export async function savedProfile(userId: string) { const row = await one<{ config: ProfileConfig }>("SELECT config FROM profiles WHERE user_id=$1", [userId]); return row?.config || null; }
export async function persistProfile(userId: string, config: ProfileConfig) { const row = await one<{ config: ProfileConfig }>("INSERT INTO profiles (user_id, config, updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (user_id) DO UPDATE SET config=EXCLUDED.config, updated_at=NOW() RETURNING config", [userId, JSON.stringify(config)]); if (!row) throw new Error("Profile save failed."); await database().query("UPDATE users SET display_name=$2, updated_at=NOW() WHERE id=$1", [userId, config.profile.displayName]); return row.config; }
