"use client";

import { useEffect, useState } from "react";
import type { ProfileBadge } from "@/lib/types";

export function BadgeArtwork({ badge, className = "h-6 w-6", alt = "" }: { badge: Pick<ProfileBadge, "name" | "icon" | "previewUrl" | "assetUrl" | "animated">; className?: string; alt?: string }) {
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const preview = badge.previewUrl || badge.icon || (!badge.animated ? badge.assetUrl : "") || "";
  const source = badge.animated && active && !reduced && badge.assetUrl ? badge.assetUrl : preview;
  if (!source) return null;
  return (
    <img
      src={source}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${className} object-contain`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
    />
  );
}