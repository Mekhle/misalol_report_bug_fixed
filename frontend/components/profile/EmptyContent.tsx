"use client";
import { useEffect, useRef } from "react";
/** Shared decoration runtime also powers the server-rendered public profile. */
export function EmptyContent({ title, subtitle }: { title?: string; subtitle?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const url = "/dashboard/profile-empty.mjs";
    void import(/* webpackIgnore: true */ url).then((module: { mountEmpty: (host: HTMLElement) => () => void }) => {
      if (!disposed && ref.current) cleanup = module.mountEmpty(ref.current);
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return <div className="profile-empty" aria-label="No content configured">
    <div ref={ref} data-empty-face aria-hidden="true" />
    {(title || subtitle) && <div className="profile-empty-copy">{title && <h3>{title}</h3>}{subtitle && <p>{subtitle}</p>}</div>}
  </div>;
}
