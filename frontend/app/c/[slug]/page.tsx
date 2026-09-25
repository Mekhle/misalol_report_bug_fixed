import { PublicConstellationView } from "@/components/constellations/PublicConstellationView";
import type { PublicConstellation } from "@/lib/constellations";

export const dynamic = "force-dynamic";

type PublicResponse = { group?: PublicConstellation; detail?: string };

async function loadConstellation(slug: string): Promise<{ group: PublicConstellation | null; error: string }> {
  const apiOrigin = (process.env.MISA_BACKEND_URL || process.env.API_PROXY_TARGET || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${apiOrigin}/api/constellations/public/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null) as PublicResponse | null;
    if (!response.ok || !payload?.group) {
      return { group: null, error: typeof payload?.detail === "string" ? payload.detail : "This Constellation is unavailable." };
    }
    return { group: payload.group, error: "" };
  } catch {
    return { group: null, error: "This Constellation could not be loaded." };
  }
}

export default async function PublicConstellationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await loadConstellation(slug);
  return <PublicConstellationView group={result.group} error={result.error} />;
}