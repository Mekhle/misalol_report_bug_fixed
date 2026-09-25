import { dashboardRequest, peekDashboardCache } from "./dashboard-cache";

export type AnalyticsRange = "3D" | "7D" | "30D" | "90D";

export interface AnalyticsSummary {
  range: AnalyticsRange;
  views: number;
  clicks: number;
  clickRate: number;
  avgDailyViews: number;
  viewsChange: number;
  clicksChange: number;
  clickRateChange: number;
  avgDailyViewsChange: number;
  series: Array<{ label: string; views: number }>;
  devices: { desktop: number; mobile: number; tablet: number };
  referrers: Array<{ label: string; count: number }>;
  socials: Array<{ id: string; label: string; clicks: number }>;
  countries: Array<{ label: string; count: number }>;
}

export const emptyAnalytics = (range: AnalyticsRange = "7D"): AnalyticsSummary => ({
  range,
  views: 0,
  clicks: 0,
  clickRate: 0,
  avgDailyViews: 0,
  viewsChange: 0,
  clicksChange: 0,
  clickRateChange: 0,
  avgDailyViewsChange: 0,
  series: [],
  devices: { desktop: 0, mobile: 0, tablet: 0 },
  referrers: [],
  socials: [],
  countries: [],
});

const analyticsKey = (range: AnalyticsRange) => `analytics:${range}`;

export function peekAnalytics(range: AnalyticsRange) {
  return peekDashboardCache<AnalyticsSummary>(analyticsKey(range));
}

export function loadAnalytics(range: AnalyticsRange, force = false): Promise<AnalyticsSummary> {
  return dashboardRequest(analyticsKey(range), async () => {
    const response = await fetch(`/api/v1/analytics/me?range=${range}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not load analytics.");
    return response.json() as Promise<AnalyticsSummary>;
  }, { maxAge: 60_000, force });
}

export function formatChange(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function socialColor(label: string) {
  const key = label.toLowerCase();
  if (key.includes("discord")) return "#8d9bff";
  if (key.includes("instagram")) return "#ef9cbb";
  if (key.includes("youtube")) return "#ff6b68";
  if (key.includes("telegram")) return "#73c5ea";
  if (key.includes("github")) return "#d0d4dc";
  if (key === "x" || key.includes("twitter")) return "#9aa3b5";
  if (key.includes("tiktok")) return "#7ee0d6";
  if (key.includes("spotify")) return "#6fe3a1";
  return "#9b87f5";
}