import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/server/account-bans";
import { peekAccountToken, popAccountToken } from "@/lib/server/account-tokens";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { clearSession, revokeOtherSessions } from "@/lib/server/sessions";
import { isSuspended, userById } from "@/lib/server/users";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.token !== "string" || body.token.length < 16 || body.token.length > 256 || typeof body.password !== "string" || typeof body.confirm_password !== "string" || [body.password, body.confirm_password].some(value => value.length < 8 || value.length > 128)) return apiError("Invalid request.", 422);
    if (!await withinLimit(`rl:reset:${clientIp(request)}`, 10, 3600)) return apiError("Too many attempts. Try again later.", 429);
    if (body.password !== body.confirm_password) return apiError("Passwords do not match.");
    const saved = await peekAccountToken("password_reset", body.token);
    if (!saved) return apiError("That reset link is invalid or expired.");
    const user = await userById(saved.user_id);
    if (!user || isSuspended(user)) { await popAccountToken("password_reset", body.token); return apiError("That reset link is invalid or expired."); }
    const hash = await argon2.hash(body.password);
    const db = await database().connect();
    try {
      await db.query("BEGIN");
      // Serialize resets for this account. Failed SQL leaves the Redis link available.
      const locked = await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      if (!locked.rowCount) { await db.query("ROLLBACK"); return apiError("Could not update that password.", 502); }
      if (!await peekAccountToken("password_reset", body.token)) { await db.query("ROLLBACK"); return apiError("That reset link is invalid or expired."); }
      await db.query("UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1", [user.id, hash]);
      if (!await popAccountToken("password_reset", body.token)) { await db.query("ROLLBACK"); return apiError("That reset link is invalid or expired."); }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
    await revokeOtherSessions(user.id);
    const response = NextResponse.json({ ok: true, redirect: "/login" }, { headers: { "Cache-Control": "no-store" } });
    clearSession(response, request);
    return response;
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
