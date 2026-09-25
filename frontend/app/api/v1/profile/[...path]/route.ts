import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { publicPresenceForUser } from "@/lib/server/discord";
import {
  ASSET_KIND_TYPES,
  ASSET_KINDS,
  fallbackFaviconResponse,
  publicMedia,
  type AssetKind,
} from "@/lib/server/media";
import { renderOgCard } from "@/lib/server/og";
import {
  getPublicAssetUrl,
  getPublicTrackAssetUrl,
  getShareCardBits,
  publicProfile,
} from "@/lib/server/profiles";
import { clientIp } from "@/lib/server/account-bans";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentHandleFor, usernameRedirect } from "@/lib/server/usernames";
import { userByUsername } from "@/lib/server/users";
import { resolveProfileWidgets } from "@/lib/server/widgets";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/;
const SECTION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const { path = [] } = await context.params;
  if (!path.length) return apiError("Not found.", 404);

  const handle = path[0].trim().toLowerCase();

  // 1. GET /api/v1/profile/:username/widgets
  if (path.length === 2 && path[1] === "widgets") {
    if (!USERNAME_RE.test(handle)) return apiError("Profile not found.", 404);
    if (!(await withinLimit(`rl:widgets:${clientIp(request)}`, 40, 60))) {
      return apiError("Too many requests. Please slow down.", 429);
    }

    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/widgets`);
    const profile = await publicProfile(handle);
    if (!profile) return apiError("Profile not found.", 404);
    const widgets = await resolveProfileWidgets(profile as Record<string, unknown>);
    return NextResponse.json({ widgets });
  }

  // 2. GET /api/v1/profile/:username/discord-status
  if (path.length === 2 && path[1] === "discord-status") {
    if (!USERNAME_RE.test(handle)) return apiError("Profile not found.", 404);
    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/discord-status`);
    const user = await userByUsername(handle);
    if (!user) return apiError("Profile not found.", 404);
    const status = await publicPresenceForUser(user);
    return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
  }

  // 3. GET /api/v1/profile/:username/sections/:section_id/cover
  if (path.length === 4 && path[1] === "sections" && path[3] === "cover") {
    const sectionId = path[2];
    if (!USERNAME_RE.test(handle) || !SECTION_ID_RE.test(sectionId)) return apiError("Asset not found.", 404);
    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/sections/${sectionId}/cover`);
    const profile = (await publicProfile(handle)) as Record<string, unknown> | null;
    if (!profile) return apiError("Asset not found.", 404);
    const sections = Array.isArray(profile.sections)
      ? (profile.sections as Array<Record<string, unknown>>)
      : [];
    const section = sections.find((s) => s && s.id === sectionId && s.enabled);
    const cover = section && typeof section.cover === "object" ? (section.cover as Record<string, unknown>) : null;
    const url = typeof cover?.url === "string" ? cover.url : "";
    const media = publicMedia(url, "image");
    if (media) return media;
    return apiError("Asset not found.", 404);
  }

  // 4. GET /api/v1/profile/:username/assets/:kind
  if (path.length === 3 && path[1] === "assets") {
    const kind = path[2] as AssetKind;
    if (!ASSET_KINDS.includes(kind) || !USERNAME_RE.test(handle)) return apiError("Asset not found.", 404);
    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/assets/${kind}`);

    const mediaType = ASSET_KIND_TYPES[kind];
    const publicUrl = await getPublicAssetUrl(handle, kind);
    const media = publicMedia(publicUrl, mediaType);
    if (media) return media;

    if (kind === "favicon") {
      const avatarUrl = await getPublicAssetUrl(handle, "avatar");
      const avatarMedia = publicMedia(avatarUrl, "image");
      if (avatarMedia) return avatarMedia;
      const bits = await getShareCardBits(handle);
      if (bits) {
        const identity = bits.identity as Record<string, unknown> | undefined;
        const settings = bits.settings as Record<string, unknown> | undefined;
        const initial = String(identity?.displayName || bits.username || handle).slice(0, 1);
        const accent = String(settings?.accentColor || "#9b87f5");
        return fallbackFaviconResponse(initial, accent);
      }
    }

    if (kind === "audio" || kind === "audioArtwork") {
      const fallback = kind === "audio" ? "audio" : "artwork";
      const track1Url = await getPublicTrackAssetUrl(handle, "track-1", fallback);
      const trackMedia = publicMedia(track1Url, fallback === "audio" ? "audio" : "image");
      if (trackMedia) return trackMedia;
    }

    const profile = (await publicProfile(handle)) as Record<string, unknown> | null;
    if (!profile) return apiError("Asset not found.", 404);
    const assets = (profile.assets && typeof profile.assets === "object" ? profile.assets : {}) as Record<
      string,
      unknown
    >;
    const item = assets[kind] as { url?: string } | undefined;
    const fallbackUrl = item?.url;
    const fallbackMedia = publicMedia(fallbackUrl, mediaType);
    if (fallbackMedia) return fallbackMedia;

    if (kind === "audio" || kind === "audioArtwork") {
      const tracks = Array.isArray(assets.tracks) ? (assets.tracks as Array<Record<string, unknown>>) : [];
      const first = tracks[0];
      const source = first
        ? (first[kind === "audio" ? "audio" : "artwork"] as { url?: string } | undefined)
        : undefined;
      const firstMedia = publicMedia(source?.url, kind === "audio" ? "audio" : "image");
      if (firstMedia) return firstMedia;
    }

    return apiError("Asset not found.", 404);
  }

  // 5. GET /api/v1/profile/:username/tracks/:track_id/:kind
  if (path.length === 4 && path[1] === "tracks") {
    const trackId = path[2];
    const kind = path[3];
    if ((kind !== "audio" && kind !== "artwork") || !USERNAME_RE.test(handle))
      return apiError("Asset not found.", 404);
    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/tracks/${trackId}/${kind}`);

    const trackUrl = await getPublicTrackAssetUrl(handle, trackId, kind);
    const media = publicMedia(trackUrl, kind === "audio" ? "audio" : "image");
    if (media) return media;

    if (kind === "artwork") {
      const avatarUrl = await getPublicAssetUrl(handle, "avatar");
      const avatarMedia = publicMedia(avatarUrl, "image");
      if (avatarMedia) return avatarMedia;
    }

    const profile = (await publicProfile(handle)) as Record<string, unknown> | null;
    if (!profile) return apiError("Asset not found.", 404);
    const assets = (profile.assets && typeof profile.assets === "object" ? profile.assets : {}) as Record<
      string,
      unknown
    >;
    const tracks = Array.isArray(assets.tracks) ? (assets.tracks as Array<Record<string, unknown>>) : [];
    const track = tracks.find((t) => t && t.id === trackId);
    if (!track) return apiError("Asset not found.", 404);

    const source = track[kind] as { url?: string } | undefined;
    const sourceMedia = publicMedia(source?.url, kind === "audio" ? "audio" : "image");
    if (sourceMedia) return sourceMedia;

    if (kind === "artwork") {
      const avatarItem = assets.avatar as { url?: string } | undefined;
      const avatarMedia = publicMedia(avatarItem?.url, "image");
      if (avatarMedia) return avatarMedia;
    }

    return apiError("Asset not found.", 404);
  }

  // 6. GET /api/v1/profile/:username/og.jpg or /og.png
  if (path.length === 2 && (path[1] === "og.jpg" || path[1] === "og.png")) {
    if (!USERNAME_RE.test(handle)) return apiError("Profile not found.", 404);
    const alias = await currentHandleFor(handle);
    if (alias) return usernameRedirect(`/api/v1/profile/${alias}/${path[1]}`);

    const bits = await getShareCardBits(handle);
    if (!bits) return apiError("Profile not found.", 404);

    try {
      return await renderOgCard(bits);
    } catch {
      return apiError("Could not generate social card.", 500);
    }
  }

  return apiError("Not found.", 404);
}
