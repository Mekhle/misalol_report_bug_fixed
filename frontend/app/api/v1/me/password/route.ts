import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { accountPayload } from "@/lib/server/account";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser, revokeOtherSessions, SESSION_COOKIE } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.password !== "string" || typeof body.confirm_password !== "string" || [body.password, body.confirm_password].some(value => value.length < 8 || value.length > 128)) return apiError("Password must be 8-128 characters.", 422);
    if (body.password !== body.confirm_password) return apiError("Passwords do not match.");
    if (user.password_hash && (typeof body.current_password !== "string" || !await argon2.verify(user.password_hash, body.current_password).catch(() => false))) return apiError("Current password is wrong.", 401);
    if (!await withinLimit(`rl:password-change:${user.id}`, 8, 3600)) return apiError("Too many attempts. Please try again shortly.", 429);
    if (user.password_hash && await argon2.verify(user.password_hash, body.password).catch(() => false)) return apiError("Choose a different password.");
    const updated = await database().query("UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1 RETURNING id", [user.id, await argon2.hash(body.password)]);
    if (!updated.rowCount) return apiError("Not authenticated.", 401);
    await revokeOtherSessions(user.id, request.cookies.get(SESSION_COOKIE)?.value);
    return NextResponse.json(await accountPayload(request, false), { headers: { "Cache-Control": "no-store" } });
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
