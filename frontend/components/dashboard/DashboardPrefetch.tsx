"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { loadAnalytics } from "@/lib/analytics";
import { loadBadgeCollection } from "@/lib/badges";
import { loadConstellationDashboard } from "@/lib/constellations";

export function DashboardPrefetch() {
  const router = useRouter();
  const { isReady, user } = useAuth();

  useEffect(() => {
    if (!isReady || !user) return;
    const commonTimer = window.setTimeout(() => {
      router.prefetch("/analytics");
      router.prefetch("/badges");
      router.prefetch("/settings");
      router.prefetch("/links");
      void Promise.allSettled([loadAnalytics("7D"), loadBadgeCollection()]);
    }, 500);
    const constellationTimer = window.setTimeout(() => {
      router.prefetch("/constellations");
      void loadConstellationDashboard().catch(() => undefined);
    }, 1800);
    return () => {
      window.clearTimeout(commonTimer);
      window.clearTimeout(constellationTimer);
    };
  }, [isReady, router, user]);

  return null;
}