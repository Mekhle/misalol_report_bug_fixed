"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth, type AuthUser } from "./auth-store";
import { compactProfileForSave, savePayloadTooLarge } from "./audio";
import { cloneMockProfile } from "./mock-data";
import { normalizeProfileSocials } from "./socials";
import type { ProfileAsset, ProfileConfig } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";
interface ProfileContextValue {
  config: ProfileConfig;
  savedConfig: ProfileConfig;
  updateConfig: (updater: (config: ProfileConfig) => ProfileConfig) => void;
  resetConfig: () => void;
  saveProfile: (nextConfig?: ProfileConfig) => Promise<void>;
  hydrateFromServer: (nextConfig: ProfileConfig) => void;
  saveState: SaveState;
  saveError: string;
  profileReady: boolean;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, isReady } = useAuth();
  const sessionKey = user?.id || (isReady ? "signed-out" : "auth-pending");
  return <SessionProfileProvider key={sessionKey} user={user} authReady={isReady}>{children}</SessionProfileProvider>;
}

function SessionProfileProvider({ children, user, authReady }: { children: React.ReactNode; user: AuthUser | null; authReady: boolean }) {
  const [config, setConfig] = useState<ProfileConfig>(() => profileFromAuthenticatedUser(user));
  const [savedConfig, setSavedConfig] = useState<ProfileConfig>(() => profileFromAuthenticatedUser(user));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const hasAuthenticatedProfile = Boolean(user && user.profile !== undefined);
  const [profileReady, setProfileReady] = useState(() => !user || hasAuthenticatedProfile);
  const lastSavedRef = useRef(user?.username && hasAuthenticatedProfile ? JSON.stringify(profileFromAuthenticatedUser(user)) : "");
  const hydratedUserRef = useRef<string | null>(hasAuthenticatedProfile ? user?.id || null : null);

  const persist = useCallback(async (nextConfig: ProfileConfig) => {
    if (!user) { setSaveState("error"); setSaveError("You are not signed in."); return; }
    if (!user.username) { setSaveState("error"); setSaveError("Choose a username in Account settings before saving your profile."); return; }
    if (hydratedUserRef.current !== user.id) {
      setSaveState("error");
      setSaveError("Your profile has not loaded safely yet. Refresh the page before saving.");
      return;
    }
    const profileToSave = normalizeDashboardProfile(nextConfig);
    const snapshot = JSON.stringify(profileToSave);
    if (snapshot === lastSavedRef.current) { setSaveState("saved"); return; }
    let previous: ProfileConfig | null = null;
    try { previous = lastSavedRef.current ? JSON.parse(lastSavedRef.current) as ProfileConfig : null; } catch { previous = null; }
    const body = JSON.stringify(compactProfileForSave(profileToSave, previous));
    if (savePayloadTooLarge(body)) {
      setSaveState("error");
      setSaveError("That playlist is too large to save at once. Use smaller files or fewer tracks.");
      return;
    }
    setSaveState("saving");
    setSaveError("");
    try {
      const response = await fetch("/api/v1/profile/me", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body });
      const raw = await response.text();
      let result: { profile?: ProfileConfig; detail?: string; error?: string } = {};
      try { result = raw ? JSON.parse(raw) as typeof result : {}; } catch { /* The proxy may return an HTML error page. */ }
      if (!response.ok && !result.detail && !result.error) result.detail = `Profile save failed (server returned ${response.status}).`;
      if (!response.ok || !result.profile) throw new Error(result.detail || result.error || "Profile save failed. Please try again.");
      const saved = normalizeDashboardProfile(result.profile);
      lastSavedRef.current = JSON.stringify(saved);
      setSavedConfig(saved);
      setConfig(current => JSON.stringify(normalizeDashboardProfile(current)) === snapshot ? saved : current);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Profile save failed. Please try again.");
    }
  }, [user]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      hydratedUserRef.current = null;
      setProfileReady(true);
      return;
    }
    if (user.profile !== undefined) {
      const next = profileFromAuthenticatedUser(user);
      setSavedConfig(next);
      lastSavedRef.current = user.username ? JSON.stringify(next) : "";
      hydratedUserRef.current = user.id;
      setProfileReady(true);
      return;
    }
    let cancelled = false;
    hydratedUserRef.current = null;
    setProfileReady(false);
    const load = async () => {
      try {
        const next = await loadProfileForUser(user);
        if (cancelled) return;
        const normalized = normalizeDashboardProfile(next);
        setSavedConfig(normalized);
        setConfig(normalized);
        lastSavedRef.current = user.username ? JSON.stringify(normalized) : "";
        hydratedUserRef.current = user.id;
        setSaveState("idle");
        setSaveError("");
        setProfileReady(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Profile hydration failed", error);
        lastSavedRef.current = "";
        hydratedUserRef.current = null;
        setSaveState("idle");
        setSaveError("");
        setProfileReady(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authReady, user?.id, user?.username]);

  const value = useMemo<ProfileContextValue>(() => ({
    config,
    savedConfig,
    updateConfig: (updater) => { setConfig((current) => updater(current)); setSaveState("idle"); setSaveError(""); },
    resetConfig: () => { setConfig(structuredClone(savedConfig)); setSaveState("idle"); setSaveError(""); },
    saveProfile: async (nextConfig) => { await persist(nextConfig || config); },
    hydrateFromServer: (nextConfig) => {
      const normalized = normalizeDashboardProfile(nextConfig);
      lastSavedRef.current = JSON.stringify(normalized);
      hydratedUserRef.current = user?.id || null;
      setSavedConfig(normalized);
      setConfig(normalized);
      setProfileReady(true);
      setSaveState("saved");
      setSaveError("");
    },
    saveState,
    saveError,
    profileReady,
  }), [config, savedConfig, persist, saveState, saveError, profileReady, user]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
export function ProfileDraftProvider({ initialConfig, draftKey, onDraftChange, onSave, children }: { initialConfig: ProfileConfig; draftKey: string; onDraftChange?: (config: ProfileConfig) => void; onSave: (config: ProfileConfig) => Promise<void>; children: React.ReactNode }) {
  const [config, setConfig] = useState<ProfileConfig>(() => normalizeDashboardProfile(initialConfig));
  const [savedConfig, setSavedConfig] = useState<ProfileConfig>(() => normalizeDashboardProfile(initialConfig));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const initialRef = useRef(normalizeDashboardProfile(initialConfig));

  useEffect(() => {
    const next = normalizeDashboardProfile(initialConfig);
    initialRef.current = next;
    setSavedConfig(next);
    setConfig(next);
    setSaveState("idle");
    setSaveError("");
    onDraftChange?.(next);
  }, [draftKey]);

  const update = (updater: (current: ProfileConfig) => ProfileConfig) => {
    setConfig((current) => {
      const next = updater(current);
      onDraftChange?.(next);
      return next;
    });
    setSaveState("idle");
    setSaveError("");
  };
  const save = async (nextConfig?: ProfileConfig) => {
    const next = normalizeDashboardProfile(nextConfig || config);
    setSaveState("saving");
    setSaveError("");
    try {
      await onSave(next);
      initialRef.current = next;
      setSavedConfig(next);
      setConfig(next);
      onDraftChange?.(next);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Constellation design save failed.");
    }
  };
  const value = useMemo<ProfileContextValue>(() => ({
    config,
    savedConfig,
    updateConfig: update,
    resetConfig: () => {
      const next = initialRef.current;
      setConfig(next);
      onDraftChange?.(next);
      setSaveState("idle");
      setSaveError("");
    },
    saveProfile: save,
    hydrateFromServer: (nextConfig) => {
      const next = normalizeDashboardProfile(nextConfig);
      initialRef.current = next;
      setSavedConfig(next);
      setConfig(next);
      onDraftChange?.(next);
      setSaveState("saved");
      setSaveError("");
    },
    saveState,
    saveError,
    profileReady: true,
  }), [config, savedConfig, saveState, saveError, onSave, onDraftChange]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ProfileProvider");
  return value;
}

function profileDefaults(): ProfileConfig {
  const defaults = cloneMockProfile();
  defaults.profile = {
    username: "",
    displayName: "",
    description: "A little corner of the internet.",
    location: "",
    views: 0,
    uid: "",
    joinedAt: "",
  };
  defaults.socials = [];
  defaults.badges = [];
  defaults.widgets = [];
  defaults.sections = [];
  return defaults;
}

export function normalizeDashboardProfile(input: ProfileConfig): ProfileConfig {
  const defaults = profileDefaults();
  const incoming = (input && typeof input === "object" ? input : {}) as Partial<ProfileConfig>;
  const assets = (incoming.assets && typeof incoming.assets === "object" ? incoming.assets : {}) as Partial<ProfileConfig["assets"]>;
  const normalizedAssets = { ...defaults.assets, ...assets } as ProfileConfig["assets"];
  for (const key of ["avatar", "banner", "background", "backgroundVideo", "backgroundEffectVideo", "audio", "audioArtwork", "cursor", "ogImage", "favicon", "customFont", "clickSound"] as const) {
    if (!normalizedAssets[key] || typeof normalizedAssets[key] !== "object") normalizedAssets[key] = defaults.assets[key] || { url: null };
  }
  return normalizeProfileSocials({
    ...defaults,
    ...incoming,
    profile: { ...defaults.profile, ...(incoming.profile || {}) },
    settings: { ...defaults.settings, ...(incoming.settings || {}) },
    assets: normalizedAssets,
    socials: Array.isArray(incoming.socials) ? incoming.socials : defaults.socials,
    badges: Array.isArray(incoming.badges) ? incoming.badges : defaults.badges,
    widgets: Array.isArray(incoming.widgets) ? incoming.widgets : defaults.widgets,
    sections: Array.isArray(incoming.sections) ? incoming.sections : defaults.sections,
  } as ProfileConfig);
}
export async function loadProfileForUsername(username: string): Promise<ProfileConfig | null> {
  const normalized = username.trim().toLowerCase();
  try {
    const response = await fetch(`/api/v1/profile?username=${encodeURIComponent(normalized)}`, { cache: "no-store" });
    if (response.ok) {
      const result = await response.json() as { profile?: ProfileConfig };
      if (result.profile) return normalizeDashboardProfile(result.profile);
    }
  } catch { /* Keep public profiles from crashing if the API is briefly down. */ }
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function mimeTypeForFile(file: Pick<File, "name" | "type">) {
  return file.type || MIME_BY_EXT[file.name.split(".").pop()?.toLowerCase() || ""] || "";
}

export function assetFromFile(file: File): Promise<ProfileAsset> {
  return new Promise((resolve, reject) => {
    if (!file || typeof file.size !== "number" || file.size <= 0) {
      reject(new Error("That file is empty or unavailable. Please choose it again."));
      return;
    }
    const reader = new FileReader();
    const type = mimeTypeForFile(file);
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      if (!raw) {
        reject(new Error("The selected file could not be read. Please try again."));
        return;
      }
      let url: string | null = raw;
      if (url.startsWith("data:") && type.startsWith("font/")) url = url.replace(/^data:[^;,]*/, `data:${type}`);
      else if (url.startsWith("data:application/octet-stream") && type) url = url.replace("data:application/octet-stream", `data:${type}`);
      resolve({ url, name: file.name, type });
    };
    reader.onerror = () => reject(reader.error || new Error("The selected file could not be read."));
    reader.onabort = () => reject(new Error("Reading the selected file was cancelled."));
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The selected file could not be read."));
    }
  });
}

export async function dataUrlToFile(dataUrl: string, name: string, type?: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: type || blob.type || "application/octet-stream" });
}

export async function uploadProfileAsset(kind: string, file: File, premium = false): Promise<ProfileAsset> {
  const form = new FormData();
  form.append("kind", kind);
  if (premium) form.append("premium", "true");
  form.append("file", file, file.name);
  const response = await fetch("/api/v1/profile/assets", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const raw = await response.text();
  let result: { asset?: ProfileAsset; detail?: string } = {};
  try { result = raw ? JSON.parse(raw) as typeof result : {}; } catch { /* handled below */ }
  if (!response.ok || !result.asset?.url) {
    throw new Error(result.detail || "Asset upload failed (server returned " + response.status + ").");
  }
  return result.asset;
}
function profileFromAuthenticatedUser(user: AuthUser | null): ProfileConfig {
  if (!user) return profileDefaults();
  if (user.profile) return normalizeDashboardProfile(user.profile);
  const profile = profileDefaults();
  profile.profile.username = user.username || "choose-username";
  profile.profile.displayName = user.displayName;
  profile.profile.uid = user.id;
  return profile;
}

function profileForUser(user: AuthUser): ProfileConfig {
  return profileFromAuthenticatedUser({ ...user, profile: null });
}

async function loadProfileForUser(user: AuthUser) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/v1/profile/me", {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Profile load failed (server returned " + response.status + ").");
      }
      const result = await response.json() as { profile?: ProfileConfig };
      if (result.profile) return normalizeDashboardProfile(result.profile);
      // A user without a saved profile can safely start from defaults. A failed
      // request must throw instead, otherwise an empty fallback could overwrite
      // existing assets on the next save.
      if (!user.username) return profileForUser(user);
      throw new Error("The profile response did not contain saved profile data.");
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Profile load failed.");
}
