"use client";
import { useEffect } from "react";
import { sharePageCopy } from "@/lib/share";
import type { ProfileConfig } from "@/lib/types";

/** Page metadata belongs to a standalone profile, never to its dashboard editor. */
export function ProfilePageMetadata({ config, draft = false }: { config: ProfileConfig; draft?: boolean }) {
  const copy = sharePageCopy(config);
  const title = copy.title + (draft ? " · Draft preview" : "");
  const description = copy.description, animate = config.settings.tabTitleAnimate;
  const favicon = config.assets.favicon?.url || "/dashboard/favicon-awake.png";
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    let offset = 0;
    const padded = title + "   ";
    const timer = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches ? window.setInterval(() => { offset = (offset + 1) % padded.length; document.title = padded.slice(offset) + padded.slice(0, offset); }, 450) : undefined;
    return () => { window.clearInterval(timer); document.title = previous; };
  }, [title, animate]);
  useEffect(() => {
    const selector = 'meta[name="description"]';
    let meta = document.querySelector<HTMLMetaElement>(selector);
    const existing = !!meta, previous = meta?.content;
    if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.append(meta); }
    meta.content = description;
    return () => { if (existing) meta.content = previous || ""; else meta.remove(); };
  }, [description]);
  useEffect(() => {
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
    const saved = icons.map(icon => ({ icon, href: icon.href }));
    icons.forEach(icon => { icon.href = favicon; });
    return () => saved.forEach(({ icon, href }) => { icon.href = href; });
  }, [favicon]);
  return null;
}
