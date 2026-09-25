"use client";
import { useEffect, type RefObject } from "react";
import type { ProfileConfig } from "@/lib/types";
const modules: Record<string, string> = { "Cursor Cat": "cat", Snowflakes: "snowflakes", "Ghost Cursor": "ghost", "Following Dot": "dot", Bubbles: "bubbles" };
export function PremiumCursor({ config, rootRef }: { config: ProfileConfig; rootRef: RefObject<HTMLDivElement | null> }) {
  const effect = config.settings.premium?.cursorEffect || "None", color = config.settings.premium?.cursorColor || "#ffffff";
  useEffect(() => {
    const file = modules[effect];
    if (!file || !matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false, cleanup: (() => void) | undefined;
    const url = `/dashboard/premium-cursors/${file}.mjs`;
    void import(/* webpackIgnore: true */ url).then((module: { mount: (root: HTMLElement, color: string) => () => void }) => { if (!disposed && rootRef.current) cleanup = module.mount(rootRef.current, color); });
    return () => { disposed = true; cleanup?.(); };
  }, [effect, color, rootRef]);
  return null;
}
