import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

const catalog = ["nav.overview","nav.analytics","nav.badges","nav.settings","nav.security","nav.constellations","nav.customize","nav.links","nav.leaderboard","nav.premium","nav.templates","customize.assets","customize.assets.avatar","customize.assets.background","customize.assets.backgroundVideo","customize.assets.audio","customize.assets.audioCrop","customize.layout","customize.effects","customize.effects.username","customize.widgets","customize.portfolio","customize.sharing","profile.frame","profile.avatar","profile.avatarBorder","profile.displayName","profile.socials","profile.widgets","profile.badges","profile.audio","profile.views","profile.joinDate","integrations.discord","feature.usernameEffects.glitch","feature.usernameEffects.pulse","feature.usernameEffects.wave","feature.usernameEffects.shadow"];

export async function GET() {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  const flags: Record<string, boolean> = Object.fromEntries(catalog.map((key) => [key, true]));
  try {
    const rows = await database().query<{ key: string; enabled: boolean }>("SELECT key, enabled FROM feature_flags");
    for (const row of rows.rows) flags[row.key] = Boolean(row.enabled);
    return NextResponse.json({ flags }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Match the prior API: feature flags fail open when the optional store is unavailable.
    return NextResponse.json({ flags }, { headers: { "Cache-Control": "no-store" } });
  }
}
