"use client";

import { useEffect, useState } from "react";
import type { ProfileFont } from "./types";

export interface DefaultFontOption {
  id: ProfileFont;
  slot: number;
  name: string;
  url: string | null;
  mimeType?: string;
}

export const BUILTIN_DEFAULT_FONT: DefaultFontOption = {
  id: "Inter",
  slot: 1,
  name: "Inter",
  url: null,
};

let cachedFonts: DefaultFontOption[] | null = null;
let loadingFonts: Promise<DefaultFontOption[]> | null = null;

async function fetchDefaultFonts() {
  if (cachedFonts) return cachedFonts;
  if (!loadingFonts) {
    loadingFonts = fetch("/api/v1/fonts/defaults", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Default fonts unavailable.");
        const body = await response.json() as { fonts?: DefaultFontOption[] };
        const uploaded = Array.isArray(body.fonts)
          ? body.fonts.filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
          : [];
        cachedFonts = [BUILTIN_DEFAULT_FONT, ...uploaded.filter((item) => item.id !== BUILTIN_DEFAULT_FONT.id)];
        return cachedFonts;
      })
      .catch(() => cachedFonts || [BUILTIN_DEFAULT_FONT])
      .finally(() => { loadingFonts = null; });
  }
  return loadingFonts;
}

export function useDefaultFonts(enabled = true) {
  const [fonts, setFonts] = useState<DefaultFontOption[]>(cachedFonts || [BUILTIN_DEFAULT_FONT]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchDefaultFonts().then((next) => { if (!cancelled) setFonts(next); });
    return () => { cancelled = true; };
  }, [enabled]);
  return fonts;
}
