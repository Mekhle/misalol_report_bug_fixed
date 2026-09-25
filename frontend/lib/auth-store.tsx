"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SwitcherAccount } from "@/lib/account-security";
import type { ProfileConfig } from "@/lib/types";
import { clearDashboardCache } from "@/lib/dashboard-cache";

export interface AuthUser {
  id: string;
  accountId: string;
  username: string | null;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  telegramUsername: string | null;
  pendingEmail: string | null;
  hasPassword: boolean;
  mfaEnabled: boolean;
  mfaCodesLeft: number;
  uid: string;
  isAdmin: boolean;
  premium: boolean;
  isStaff: boolean;
  staffRole: "owner" | "admin" | "moderator" | null;
  isTemplateCreator: boolean;
  providers?: { email: boolean; google: boolean; discord: boolean; telegram: boolean };
  accounts: SwitcherAccount[];
  profile?: ProfileConfig | null;
}

type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };
interface AuthContextValue {
  user: AuthUser | null;
  isReady: boolean;
  signUp: (input: { username: string; displayName: string; email: string; password: string }) => Promise<AuthResult>;
  login: (identifier: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CHANNEL_NAME = "misa-auth-state";
const AUTH_MAX_AGE = 30_000;
type AuthEvent = "signed-out" | "revalidate";

let sharedUser: AuthUser | null | undefined;
let sharedUserLoadedAt = 0;
let sharedUserRequest: Promise<AuthUser | null> | null = null;

function announceAuthEvent(event: AuthEvent) {
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
  } catch {
    // Focus revalidation still protects browsers without BroadcastChannel.
  }
}

function normalizeUser(value: Record<string, unknown>): AuthUser {
  return {
    id: String(value.id || ""),
    premium: value.premium === true,
    accountId: String(value.account_id || value.accountId || ""),
    username: value.username ? String(value.username) : null,
    displayName: String(value.display_name || value.displayName || value.username || "Misa user"),
    email: value.email ? String(value.email) : null,
    emailVerified: Boolean(value.email_verified || value.emailVerified),
    telegramUsername: value.telegram_username ? String(value.telegram_username) : (value.telegramUsername ? String(value.telegramUsername) : null),
    pendingEmail: value.pending_email ? String(value.pending_email) : (value.pendingEmail ? String(value.pendingEmail) : null),
    hasPassword: Boolean(value.has_password || value.hasPassword || (value.providers as AuthUser["providers"] | undefined)?.email),
    mfaEnabled: Boolean(value.mfa_enabled || value.mfaEnabled),
    mfaCodesLeft: Number(value.mfa_codes_left || value.mfaCodesLeft || 0),
    uid: String(value.id || value.uid || ""),
    isAdmin: Boolean(value.is_admin || value.isAdmin),
    staffRole: (value.staff_role || value.staffRole || null) as AuthUser["staffRole"],
    isStaff: Boolean(value.is_staff || value.isStaff || value.staff_role || value.staffRole),
    isTemplateCreator: Boolean(value.is_template_creator || value.isTemplateCreator || value.is_admin || value.isAdmin),
    providers: value.providers as AuthUser["providers"],
    accounts: Array.isArray(value.accounts) ? value.accounts as SwitcherAccount[] : [],
    profile: value.profile === null ? null : value.profile && typeof value.profile === "object" ? value.profile as ProfileConfig : undefined,
  };
}

function storeSharedUser(user: AuthUser | null) {
  sharedUser = user;
  sharedUserLoadedAt = Date.now();
  return user;
}

function resetSharedUser() {
  sharedUser = undefined;
  sharedUserLoadedAt = 0;
  sharedUserRequest = null;
}

async function requestCurrentUser(force = false): Promise<AuthUser | null> {
  if (!force && sharedUser !== undefined && Date.now() - sharedUserLoadedAt < AUTH_MAX_AGE) return sharedUser;
  if (sharedUserRequest) return sharedUserRequest;
  const request = (async () => {
    const response = await fetch("/api/v1/me", { credentials: "include", cache: "no-store" });
    if (response.status === 401 || response.status === 403) return storeSharedUser(null);
    if (!response.ok) throw new Error(`Session request failed (${response.status}).`);
    return storeSharedUser(normalizeUser(await response.json() as Record<string, unknown>));
  })();
  sharedUserRequest = request;
  try {
    return await request;
  } finally {
    if (sharedUserRequest === request) sharedUserRequest = null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => sharedUser ?? null);
  const [isReady, setIsReady] = useState(() => sharedUser !== undefined);
  const userRef = useRef<AuthUser | null>(sharedUser ?? null);
  const requestVersion = useRef(0);

  const commitUser = useCallback((next: AuthUser | null) => {
    const current = userRef.current;
    const resolved = next && next.profile === undefined && current?.profile !== undefined
      ? { ...next, profile: current.profile }
      : next;
    storeSharedUser(resolved);
    userRef.current = resolved;
    setUser((existing) => JSON.stringify(existing) === JSON.stringify(resolved) ? existing : resolved);
  }, []);

  const loadCurrentUser = useCallback(async (force = false) => {
    const version = ++requestVersion.current;
    try {
      const next = await requestCurrentUser(force);
      if (version !== requestVersion.current) return;
      userRef.current = next;
      setUser((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    } catch {
      // Preserve the last valid user during transient network failures.
    } finally {
      if (version === requestVersion.current) setIsReady(true);
    }
  }, []);

  useEffect(() => {
    void loadCurrentUser();
    const onFocus = () => { void loadCurrentUser(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void loadCurrentUser(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data === "signed-out") {
          resetSharedUser();
          clearDashboardCache();
        }
        if (event.data === "signed-out" || event.data === "revalidate") void loadCurrentUser(true);
      };
    } catch {
      channel = null;
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      channel?.close();
      requestVersion.current += 1;
    };
  }, [loadCurrentUser]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isReady,
    signUp: async () => ({ ok: false, error: "Create your account from the main signup page." }),
    login: async () => ({ ok: false, error: "Log in from the main login page." }),
    logout: async () => {
      requestVersion.current += 1;
      try {
        await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
      } finally {
        resetSharedUser();
        clearDashboardCache();
        userRef.current = null;
        setUser(null);
        announceAuthEvent("signed-out");
        window.location.assign("/login");
      }
    },
    updateDisplayName: async (displayName) => {
      const response = await fetch("/api/v1/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ display_name: displayName }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(result.detail || result.error || "Could not update your display name."));
      commitUser(normalizeUser(result));
    },
    updateUsername: async (username) => {
      const response = await fetch("/api/v1/me/username", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(result.detail || result.error || "Could not change that username."));
      commitUser(normalizeUser(result));
    },
    refresh: async () => {
      await loadCurrentUser(true);
    },
  }), [commitUser, isReady, loadCurrentUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}