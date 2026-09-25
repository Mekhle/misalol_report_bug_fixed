import { NextRequest, NextResponse } from "next/server";
import { clientIp, rememberSignupIp, userIsBanned } from "@/lib/server/account-bans";
import { readSwitcherIds, rememberSwitcherUser } from "@/lib/server/account-security";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { attachSession, createSession, currentUser, destroySession, revokeOtherSessions, SESSION_COOKIE } from "@/lib/server/sessions";
import { isSuspended, touchLogin, userById } from "@/lib/server/users";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    if (!await withinLimit(`rl:switch:${clientIp(request)}`, 20, 3600)) return apiError("Too many attempts. Please try again shortly.", 429);
    const current = await currentUser(request);
    if (!current) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.user_id !== "string" || body.user_id.length < 8 || body.user_id.length > 64) return apiError("Invalid request.", 422);
    if (!readSwitcherIds(request).includes(body.user_id)) return apiError("That account is not saved on this browser.", 403);
    const response = NextResponse.json({ ok: true, redirect: process.env.MISA_DASHBOARD_URL || "/dashboard" }, { headers: { "Cache-Control": "no-store" } });
    if (body.user_id === current.id) return response;
    const target = await userById(body.user_id);
    if (!target) return apiError("That account is not available.", 403);
    await rememberSignupIp(target.id, request);
    if (await userIsBanned(target)) {
      await revokeOtherSessions(target.id);
      return apiError("That account is not available.", 403);
    }
    if (isSuspended(target)) return apiError("That account is not available.", 403);
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
    await touchLogin(target.id);
    const session = await createSession(target.id, request, true);
    attachSession(response, request, session.token, session.ttl);
    rememberSwitcherUser(response, request, target.id);
    return response;
  } catch { return apiError("Authentication is temporarily unavailable. Please try again.", 503); }
}

