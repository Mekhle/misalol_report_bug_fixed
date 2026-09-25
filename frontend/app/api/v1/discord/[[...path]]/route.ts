import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/server/account-bans";
import {
  disconnectDiscord,
  liveDiscordState,
  publicPresenceForUser,
  updateDiscordPrefs,
} from "@/lib/server/discord";
import { apiError } from "@/lib/server/http";
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

  const user = await currentUser(request);
  if (!user) return apiError("Not authenticated.", 401);

  const subpath = routePath(await params);
  if (!subpath || subpath === "") {
    const state = await liveDiscordState(user);
    return json(state);
  }

  if (subpath === "status") {
    const status = await publicPresenceForUser(user);
    return json({ status });
  }

  return apiError("Not found.", 404);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const user = await currentUser(request);
  if (!user) return apiError("Not authenticated.", 401);

  const subpath = routePath(await params);
  if (subpath && subpath !== "") return apiError("Not found.", 404);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON payload.", 400);
  }

  try {
    const state = await updateDiscordPrefs(user, {
      showAvatar: typeof payload.showAvatar === "boolean" ? payload.showAvatar : undefined,
      showDecoration: typeof payload.showDecoration === "boolean" ? payload.showDecoration : undefined,
      showGuildTag: typeof payload.showGuildTag === "boolean" ? payload.showGuildTag : undefined,
      showStatus: typeof payload.showStatus === "boolean" ? payload.showStatus : undefined,
    });
    return json(state);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Could not update Discord preferences.";
    return apiError(msg, 400);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const user = await currentUser(request);
  if (!user) return apiError("Not authenticated.", 401);

  const subpath = routePath(await params);
  if (subpath === "disconnect") {
    try {
      const result = await disconnectDiscord(user, clientIp(request));
      return json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Disconnect failed.";
      if (msg === "RATE_LIMIT") return apiError("Too many attempts. Try again later.", 429);
      return apiError(msg, 400);
    }
  }

  return apiError("Not found.", 404);
}
