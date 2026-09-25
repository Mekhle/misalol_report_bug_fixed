import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/server/account-bans";
import { leaderboard } from "@/lib/server/community";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function routePath(params: { path?: string[] }): string {
  const parts = params.path || [];
  return parts.join("/").toLowerCase();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const subpath = routePath(await params);
  if (subpath !== "leaderboard") return apiError("Not found.", 404);

  const ip = clientIp(request);
  const ok = await withinLimit(`rl:leaderboard:${ip}`, 30, 60);
  if (!ok) return apiError("Rate limit exceeded.", 429);

  const searchParams = request.nextUrl.searchParams;
  const range = searchParams.get("range") || "7D";
  const metric = searchParams.get("metric") || "views";
  const sort = searchParams.get("sort") || "popular";

  const user = await currentUser(request);
  const viewerId = user ? user.id : null;

  const result = await leaderboard(range, metric, sort, viewerId);
  return json(result);
}
