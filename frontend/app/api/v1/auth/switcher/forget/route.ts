import { NextRequest, NextResponse } from "next/server";
import { addSwitcherId, attachSwitcher, readSwitcherIds } from "@/lib/server/account-security";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const current = await currentUser(request);
    if (!current) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.user_id !== "string" || body.user_id.length < 8 || body.user_id.length > 64) return apiError("Invalid request.", 422);
    let ids = readSwitcherIds(request).filter(id => id !== body.user_id);
    if (!ids.includes(current.id)) ids = addSwitcherId(ids, current.id);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    attachSwitcher(response, request, ids);
    return response;
  } catch { return apiError("Authentication is temporarily unavailable. Please try again.", 503); }
}
