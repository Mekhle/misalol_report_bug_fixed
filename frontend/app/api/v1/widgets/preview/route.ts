import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
import { resolveProfileWidgets } from "@/lib/server/widgets";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) {
    return apiError("Not found.", 404);
  }

  const user = await currentUser(request);
  if (!user) {
    return apiError("Not authenticated.", 401);
  }

  const ok = await withinLimit(`rl:widgets-preview:${user.id}`, 30, 60);
  if (!ok) {
    return apiError("Rate limit exceeded.", 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("Invalid widget payload.", 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return apiError("Invalid widget payload.", 400);
  }

  const widgets = await resolveProfileWidgets(payload as Record<string, unknown>, true);
  return NextResponse.json({ widgets }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
