import { NextRequest, NextResponse } from "next/server";
import { accountPayload } from "@/lib/server/account";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
import { changeUsername, UsernameError, validateUsername } from "@/lib/server/usernames";
export const runtime = "nodejs";
export async function PATCH(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.username !== "string" || body.username.length < 3 || body.username.length > 24) return apiError("Username must be 3-24 characters.", 422);
    const renamed = await changeUsername(user.id, validateUsername(body.username));
    // Python records this counter after commit, without rejecting completed renames.
    if (renamed) await withinLimit(`rl:rename:${user.id}`, 3, 86400).catch(() => false);
    return NextResponse.json(await accountPayload(request, false), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof UsernameError ? apiError(error.message, error.status) : apiError("Could not change that username. Please try again.", 502);
  }
}
