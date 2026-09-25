import { rememberSignupIp, userIsBanned } from "@/lib/server/account-bans";
import { rememberSwitcherUser } from "@/lib/server/account-security";
﻿import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { withinLimit } from "@/lib/server/rate-limit";
import { attachSession, createSession, destroySession, revokeOtherSessions, SESSION_COOKIE } from "@/lib/server/sessions";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { isSuspended, touchLogin, userByEmail } from "@/lib/server/users";
import { createMfaTicket, mfaEnabled } from "@/lib/server/mfa";

export const runtime = "nodejs";

function clientKey(request: NextRequest) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  let body: { email?: unknown; password?: unknown; remember?: unknown; turnstile_token?: unknown };
  try { body = await request.json(); } catch { return apiError("Invalid request."); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;
  if (!await withinLimit(`rl:login:${clientKey(request)}`, 12, 60)) return apiError("Too many attempts. Please try again shortly.", 429);
  if (!await verifyTurnstile(request, body.turnstile_token)) return apiError("Security verification failed. Please try again.", 403);
  if (!email || !password) return apiError("Invalid email or password.", 401);
  try {
    const user = await userByEmail(email);
    if (!user?.password_hash || !await argon2.verify(user.password_hash, password)) return apiError("Invalid email or password.", 401);
    await rememberSignupIp(user.id, request);
    if (await userIsBanned(user)) { await revokeOtherSessions(user.id); return apiError("This account is banned.", 403); }
    if (isSuspended(user)) return apiError("This account is currently suspended.", 403);
    if (await mfaEnabled(user.id)) return NextResponse.json({ ok: true, mfa_required: true, ticket: await createMfaTicket(user.id, remember) }, { headers: { "Cache-Control": "no-store" } });
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
    const { token, ttl } = await createSession(user.id, request, remember);
    await touchLogin(user.id);
    const response = NextResponse.json({ ok: true, redirect: process.env.MISA_DASHBOARD_URL || "/dashboard" }, { headers: { "Cache-Control": "no-store" } });
    attachSession(response, request, token, ttl);
    rememberSwitcherUser(response, request, user.id);
    return response;
  } catch {
    return apiError("Authentication is temporarily unavailable. Please try again.", 503);
  }
}


