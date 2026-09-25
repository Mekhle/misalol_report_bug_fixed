import { NextRequest, NextResponse } from "next/server";
import { rememberSwitcherUser } from "@/lib/server/account-security";
import { accountPayload } from "@/lib/server/account";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const result = await accountPayload(request);
    if (!result) return apiError("Not authenticated.", 401);
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    rememberSwitcherUser(response, request, result.id);
    return response;
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
export async function PATCH(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.display_name !== "string" || body.display_name.length < 1 || body.display_name.length > 128) return apiError("Display name must be 1-128 characters.", 422);
    const result = await database().query("UPDATE users SET display_name=$2,updated_at=NOW() WHERE id=$1 RETURNING id", [user.id, body.display_name.trim()]);
    if (!result.rowCount) return apiError("Not authenticated.", 401);
    return NextResponse.json(await accountPayload(request, false), { headers: { "Cache-Control": "no-store" } });
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
