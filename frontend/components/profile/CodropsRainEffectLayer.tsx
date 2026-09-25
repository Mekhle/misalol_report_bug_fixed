"use client";

import { useEffect, useState } from "react";

export function CodropsRainEffectLayer({ className = "" }: { className?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  if (!enabled) return null;
  return (
    <iframe
      className={`codrops-rain-effect pointer-events-none absolute inset-0 h-full w-full border-0 ${className}`}
      src="/dashboard/vendor/rain-effect/profile.html#slide-2"
      title="Codrops rain effect"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}