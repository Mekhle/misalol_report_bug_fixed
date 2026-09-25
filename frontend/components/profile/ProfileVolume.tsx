"use client";
import { useEffect, type RefObject } from "react";
import { usesBackgroundVideoAudio, usesUploadedProfileAudio } from "@/lib/audio";
import type { ProfileConfig } from "@/lib/types";
export function ProfileVolume({ config, rootRef }: { config: ProfileConfig; rootRef: RefObject<HTMLDivElement | null> }) {
  const video = usesBackgroundVideoAudio(config.assets), audio = usesUploadedProfileAudio(config.assets);
  const background = config.settings.backgroundColor, image = config.assets.background.url, volume = config.assets.volume;
  useEffect(() => {
    if (!video && !audio) return;
    let disposed = false, cleanup: (() => void) | undefined;
    const url = "/dashboard/profile-volume.mjs";
    void import(/* webpackIgnore: true */ url).then((module: { mountVolume: (root: HTMLElement, options: object) => () => void }) => {
      if (!disposed && rootRef.current) cleanup = module.mountVolume(rootRef.current, { video, background, image, volume: volume / 100 });
    });
    return () => { disposed = true; cleanup?.(); };
  }, [video, audio, background, image, volume, rootRef]);
  return null;
}
