"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-store";
import { useProfile } from "./profile-store";

export const PREVIEW_MESSAGE = "misa-draft-preview-v1";
const DraftPreviewContext = createContext<{ open: () => void; href: string; target: string; blocked: boolean; active: boolean } | null>(null);

/** Reuse the dashboard preview session, or provide one when an editor is mounted independently. */
export function DraftPreviewBoundary({ children }: { children: React.ReactNode }) {
  const preview = useContext(DraftPreviewContext);
  return preview ? <>{children}</> : <DraftPreviewProvider>{children}</DraftPreviewProvider>;
}

/** Drafts only cross a same-origin, owner-checked window connection. Nothing is published or stored. */
export function DraftPreviewProvider({ children }: { children: React.ReactNode }) {
  const { config, profileReady } = useProfile();
  const { user } = useAuth();
  const child = useRef<Window | null>(null);
  const token = useRef("");
  const [href, setHref] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [active, setActive] = useState(false);
  const latest = useRef({ config, user, profileReady });
  latest.current = { config, user, profileReady };
  const target = "misa-profile-draft";
  const send = () => {
    const state = latest.current;
    if (child.current && !child.current.closed) child.current.postMessage({ type: PREVIEW_MESSAGE, action: "draft", token: token.current, owner: state.user?.id, config: state.user && state.profileReady ? state.config : null }, window.location.origin);
  };
  useEffect(() => {
    token.current = crypto.randomUUID();
    setHref(`/dashboard/preview#${token.current}`);
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== window.location.origin || !event.source || data?.type !== PREVIEW_MESSAGE || data.token !== token.current || data.owner !== latest.current.user?.id) return;
      if (data.action === "ready" && (!child.current || child.current.closed || event.source === child.current)) {
        child.current = event.source as Window;
        setActive(true); setBlocked(false); send();
      }
    };
    const revoke = () => child.current?.postMessage({ type: PREVIEW_MESSAGE, action: "draft", token: token.current, config: null }, window.location.origin);
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", revoke);
    return () => { revoke(); window.removeEventListener("message", receive); window.removeEventListener("pagehide", revoke); };
  }, []);
  useEffect(() => {
    // Coalesce quick field/slider edits; never make a save request for preview updates.
    const timer = window.setTimeout(send, 40);
    return () => window.clearTimeout(timer);
  }, [config, user, profileReady]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (child.current?.closed) { child.current = null; setActive(false); } }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const open = () => {
    if (!user || !profileReady || !href) return;
    if (child.current && !child.current.closed) { child.current.focus(); send(); return; }
    child.current = window.open(href, target);
    setBlocked(!child.current);
    setActive(!!child.current);
    child.current?.focus();
  };
  return <DraftPreviewContext.Provider value={{ open, href, target, blocked, active }}>{children}</DraftPreviewContext.Provider>;
}
export function useDraftPreview() {
  const value = useContext(DraftPreviewContext);
  if (!value) throw new Error("Draft preview requires the dashboard provider");
  return value;
}
