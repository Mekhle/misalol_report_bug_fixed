"use client";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-store";
import { PREVIEW_MESSAGE } from "@/lib/draft-preview";
import type { ProfileConfig } from "@/lib/types";
import { ProfileRenderer } from "@/components/profile/ProfileRenderer";
import { ProfilePageMetadata } from "@/components/profile/ProfilePageMetadata";

function DraftPreview() {
  const { user, isReady } = useAuth();
  const [draft, setDraft] = useState<{ owner: string; config: ProfileConfig } | null>(null);
  useEffect(() => {
    setDraft(null);
    if (!user || !window.opener) return;
    const token = window.location.hash.slice(1);
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== window.location.origin || event.source !== window.opener || data?.type !== PREVIEW_MESSAGE || data.action !== "draft" || data.token !== token) return;
      if (data.owner !== user.id || !data.config) { setDraft(null); return; }
      setDraft({ owner: user.id, config: data.config });
    };
    window.addEventListener("message", receive);
    window.opener.postMessage({ type: PREVIEW_MESSAGE, action: "ready", token, owner: user.id }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, [user?.id]);
  const config = draft?.owner === user?.id ? draft?.config : null;
  if (!config) return <main className="grid min-h-[100svh] place-items-center bg-[#07070a] p-6 text-center text-zinc-300"><p>{!isReady ? "Loading preview…" : !user ? "Sign in to your account and open Profile Preview from the editor." : "Open Profile Preview from your editor to connect this tab to your current draft."}</p></main>;
  return <div className="h-[100svh]"><ProfilePageMetadata config={config} draft /><ProfileRenderer config={config} preview fitViewport /></div>;
}
export default function PreviewPage() { return <AuthProvider><DraftPreview /></AuthProvider>; }
