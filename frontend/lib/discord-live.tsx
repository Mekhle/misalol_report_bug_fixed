"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-store";

export type DiscordPresence = "online" | "idle" | "dnd" | "offline";

export type DiscordCard = {
  avatar?: string | null;
  accountAvatar?: string | null;
  username?: string | null;
  globalName?: string | null;
  decoration?: string | null;
  guildTag?: { tag: string; badge: string } | null;
  status?: DiscordPresence | null;
};

export const DISCORD_STATUS_COLORS: Record<DiscordPresence, string> = {
  online: "#23a55a",
  idle: "#f0b232",
  dnd: "#f23f43",
  offline: "#80848e",
};

export const DISCORD_STATUS_LABELS: Record<DiscordPresence, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

const STATUS_RING = "#15151d";

export function DiscordStatusGlyph({ status, className = "" }: { status: DiscordPresence; className?: string }) {
  const color = DISCORD_STATUS_COLORS[status];
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill={STATUS_RING} />
      <g transform="translate(8 8) scale(0.72) translate(-8 -8)">
        {status === "online" && <circle cx="8" cy="8" r="8" fill={color} />}
        {status === "idle" && (
          <>
            <circle cx="8" cy="8" r="8" fill={color} />
            <circle cx="4" cy="4" r="6" fill={STATUS_RING} />
          </>
        )}
        {status === "dnd" && (
          <>
            <circle cx="8" cy="8" r="8" fill={color} />
            <rect x="2" y="6" width="12" height="4" rx="2" fill={STATUS_RING} />
          </>
        )}
        {status === "offline" && (
          <>
            <circle cx="8" cy="8" r="8" fill={color} />
            <circle cx="8" cy="8" r="4" fill={STATUS_RING} />
          </>
        )}
      </g>
    </svg>
  );
}

export type DiscordState = {
  connected: boolean;
  needsReconnect: boolean;
  canDisconnect: boolean;
  username: string;
  status?: DiscordPresence | null;
  serverInvite?: string;
  prefs: { showAvatar: boolean; showDecoration: boolean; showGuildTag: boolean; showStatus: boolean };
  card: DiscordCard;
};

type DiscordLiveValue = {
  state: DiscordState | null;
  reload: () => Promise<void>;
  savePrefs: (prefs: Partial<DiscordState["prefs"]>) => Promise<void>;
  disconnect: () => Promise<void>;
};

const DiscordLiveContext = createContext<DiscordLiveValue | null>(null);

const empty: DiscordState = {
  connected: false,
  needsReconnect: false,
  canDisconnect: false,
  username: "",
  status: null,
  serverInvite: "",
  prefs: { showAvatar: false, showDecoration: false, showGuildTag: false, showStatus: false },
  card: {},
};

export function DiscordLiveProvider({ children }: { children: React.ReactNode }) {
  const { user, isReady, refresh } = useAuth();
  const pathname = usePathname();
  const [state, setState] = useState<DiscordState | null>(null);
  const routeNeedsDiscord = pathname === "/" || pathname.startsWith("/customize") || pathname.startsWith("/security") || pathname.startsWith("/constellations");

  const reload = useCallback(async () => {
    if (!user) {
      setState(null);
      return;
    }
    try {
      const response = await fetch("/api/v1/discord", { credentials: "include", cache: "no-store" });
      if (!response.ok) {
        // Keep the last known connection during a transient API failure.
        setState((current) => current ?? empty);
        return;
      }
      setState(await response.json() as DiscordState);
    } catch {
      // A failed refresh must not erase a valid live Discord state.
      setState((current) => current ?? empty);
    }
  }, [user]);

  useEffect(() => {
    if (!isReady || !routeNeedsDiscord) return;
    void reload();
  }, [isReady, reload, routeNeedsDiscord]);

  useEffect(() => {
    if (!routeNeedsDiscord || !state?.connected) return;
    let disposed = false;
    const refreshStatus = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/v1/discord/status", { credentials: "include", cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<{ status?: DiscordPresence | null }> : null)
        .then((data) => {
          if (!data || disposed) return;
          const nextStatus = data.status || null;
          setState((current) => {
            if (!current || current.status === nextStatus) return current;
            return { ...current, status: nextStatus, card: { ...current.card, status: nextStatus } };
          });
        })
        .catch(() => {});
    };
    const timer = window.setInterval(refreshStatus, 15_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refreshStatus(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [routeNeedsDiscord, state?.connected]);

  const value = useMemo<DiscordLiveValue>(() => ({
    state,
    reload,
    savePrefs: async (prefs) => {
      const previous = state;
      setState((current) => {
        if (!current) return current;
        const nextPrefs = { ...current.prefs, ...prefs };
        return {
          ...current,
          prefs: nextPrefs,
          card: {
            ...current.card,
            avatar: nextPrefs.showAvatar ? (current.card.avatar || current.card.accountAvatar) : null,
            decoration: nextPrefs.showDecoration ? current.card.decoration : null,
            guildTag: nextPrefs.showGuildTag ? current.card.guildTag : null,
            status: nextPrefs.showStatus === false ? null : current.card.status,
          },
          status: nextPrefs.showStatus === false ? null : current.status,
        };
      });
      try {
        const response = await fetch("/api/v1/discord", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        });
        const result = await response.json() as DiscordState & { detail?: string };
        if (!response.ok) throw new Error(String(result.detail || "Could not save Discord display options."));
        setState(result);
      } catch (error) {
        setState(previous);
        throw error;
      }
    },
    disconnect: async () => {
      const response = await fetch("/api/v1/discord/disconnect", { method: "POST", credentials: "include" });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(String(result.detail || "Could not disconnect Discord."));
      setState(empty);
      await refresh();
    },
  }), [reload, refresh, state]);

  return <DiscordLiveContext.Provider value={value}>{children}</DiscordLiveContext.Provider>;
}

export function useDiscordLive() {
  return useContext(DiscordLiveContext);
}
