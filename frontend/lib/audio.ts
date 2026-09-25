import type { AudioTrack, ProfileAsset, ProfileConfig } from "./types";

export const DEFAULT_MAX_TRACKS = 8;
export const DEFAULT_MAX_TRACK_BYTES = 40_000_000;
export const DEFAULT_MAX_ARTWORK_BYTES = 15_000_000;
export const KEEP_ASSET_URL = "misa:keep";
export const REMOVE_ASSET_URL = "misa:remove";
const MAX_SAVE_CHARS = 60_000_000;

export type AudioSource = "video" | "standalone" | "tracks";

export function resolvedAudioSource(assets: ProfileConfig["assets"]): AudioSource {
  if (assets.audioSource === "video" || assets.audioSource === "standalone" || assets.audioSource === "tracks") return assets.audioSource;
  if (Array.isArray(assets.tracks) && assets.tracks.some((track) => track?.audio?.url)) return "tracks";
  if (assets.audio?.url) return "standalone";
  return "video";
}

/**
 * Compatibility helper for profile/player consumers that need to know whether
 * the profile is using uploaded audio instead of the background video's audio.
 */
export function usesBackgroundVideoAudio(assets: ProfileConfig["assets"]): boolean {
  return resolvedAudioSource(assets) === "video" && Boolean(assets.audioEnabled && assets.backgroundVideo?.url);
}

export function usesUploadedProfileAudio(assets: ProfileConfig["assets"]): boolean {
  const source = resolvedAudioSource(assets);
  return source === "standalone" || source === "tracks";
}

export function playlistTracks(assets: ProfileConfig["assets"]): AudioTrack[] {
  if (resolvedAudioSource(assets) === "tracks" && Array.isArray(assets.tracks) && assets.tracks.length > 0) {
    return assets.tracks.filter((track) => track?.audio?.url);
  }
  if (!assets.audio?.url) return [];
  return [{
    id: "track-1",
    title: audioTrackTitle(assets),
    audio: assets.audio,
    artwork: assets.audioArtwork || { url: null },
  }];
}

export function audioTrackTitle(assets: ProfileConfig["assets"]) {
  const titled = (assets.audioTitle || "").trim();
  if (titled) return titled;
  const name = (assets.audio.name || "").replace(/\.[^.]+$/, "").trim();
  return name || "Profile audio";
}

export function audioArtworkUrl(assets: ProfileConfig["assets"], track?: AudioTrack) {
  return track?.artwork?.url || assets.audioArtwork?.url || assets.avatar?.url || "";
}

export function trackTitle(track: AudioTrack) {
  return track.title.trim() || (track.audio.name || "").replace(/\.[^.]+$/, "").trim() || "Track";
}

export function syncPlaylist(tracks: AudioTrack[]): Pick<ProfileConfig["assets"], "tracks" | "audio" | "audioArtwork" | "audioTitle"> {
  const first = tracks[0];
  return {
    tracks,
    audio: first?.audio || { url: null },
    audioArtwork: first?.artwork || { url: null },
    audioTitle: first ? trackTitle(first) : "",
  };
}

export function newTrackId() {
  return `track-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function fileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").trim() || "Track";
}

export async function loadPlaylistLimits() {
  try {
    const response = await fetch("/api/v1/profile/limits", { cache: "no-store" });
    if (!response.ok) throw new Error("limits");
    const result = await response.json() as { maxTracks?: number; maxTrackBytes?: number; maxArtworkBytes?: number };
    return {
      maxTracks: result.maxTracks || DEFAULT_MAX_TRACKS,
      maxTrackBytes: result.maxTrackBytes || DEFAULT_MAX_TRACK_BYTES,
      maxArtworkBytes: result.maxArtworkBytes || DEFAULT_MAX_ARTWORK_BYTES,
    };
  } catch {
    return { maxTracks: DEFAULT_MAX_TRACKS, maxTrackBytes: DEFAULT_MAX_TRACK_BYTES, maxArtworkBytes: DEFAULT_MAX_ARTWORK_BYTES };
  }
}

export function compactProfileForSave(next: ProfileConfig, previous: ProfileConfig | null): ProfileConfig {
  if (!previous) {
    const { discord: _discord, ...rest } = next;
    return rest;
  }
  const prevTracks = playlistTracks(previous.assets);
  const prevById = new Map(prevTracks.map((track) => [track.id, track]));
  const prevSections = new Map((previous.sections || []).map((section) => [section.id, section]));
  return {
    ...next,
    discord: undefined,
    sections: (next.sections || []).map((section) => ({
      ...section,
      cover: compactAsset(section.cover || { url: null }, prevSections.get(section.id)?.cover || undefined),
    })),
    assets: {
      ...next.assets,
      avatar: compactAsset(next.assets.avatar, previous.assets.avatar),
      banner: compactAsset(next.assets.banner || { url: null }, previous.assets.banner),
      background: compactAsset(next.assets.background, previous.assets.background),
      backgroundVideo: compactAsset(next.assets.backgroundVideo, previous.assets.backgroundVideo),
      cursor: compactAsset(next.assets.cursor, previous.assets.cursor),
      ogImage: compactAsset(next.assets.ogImage || { url: null }, previous.assets.ogImage),
      favicon: compactAsset(next.assets.favicon || { url: null }, previous.assets.favicon),
      entryIcon: compactAsset(next.assets.entryIcon || { url: null }, previous.assets.entryIcon),
      customFont: compactAsset(next.assets.customFont || { url: null }, previous.assets.customFont),
      clickSound: compactAsset(next.assets.clickSound || { url: null }, previous.assets.clickSound),
      audio: compactAsset(next.assets.audio, previous.assets.audio),
      audioArtwork: compactAsset(next.assets.audioArtwork, previous.assets.audioArtwork),
      tracks: playlistTracks(next.assets).map((track) => {
        const stored = prevById.get(track.id);
        return {
          ...track,
          audio: compactAsset(track.audio, stored?.audio),
          artwork: compactAsset(track.artwork, stored?.artwork),
        };
      }),
    },
  };
}

export function savePayloadTooLarge(body: string) {
  return body.length > MAX_SAVE_CHARS;
}

function compactAsset(next: ProfileAsset, previous?: ProfileAsset): ProfileAsset {
  if (next?.remove) return { ...next, url: REMOVE_ASSET_URL, remove: undefined };
  // Empty asset values are common in the full profile form. Preserve stored media
  // unless the UI marked this asset as an explicit removal.
  if (!next?.url && previous?.url) return { ...next, url: KEEP_ASSET_URL };
  if (next?.url && previous?.url && next.url === previous.url) return { ...next, url: KEEP_ASSET_URL };
  return next;
}

export function publicTrackUrls(username: string, track: AudioTrack) {
  return {
    audio: `/api/v1/profile/${username}/tracks/${track.id}/audio`,
    artwork: track.artwork?.url ? `/api/v1/profile/${username}/tracks/${track.id}/artwork` : "",
  };
}
