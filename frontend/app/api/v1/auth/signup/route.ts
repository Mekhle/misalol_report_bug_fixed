import { rememberSignupIp, requestIpIsBanned } from "@/lib/server/account-bans";
import { rememberSwitcherUser } from "@/lib/server/account-security";
import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { normalizeAccountEmail } from "@/lib/server/email-validation";
import { withinLimit } from "@/lib/server/rate-limit";
import { attachSession, createSession, destroySession, SESSION_COOKIE } from "@/lib/server/sessions";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { createEmailUser, touchLogin, userByEmail } from "@/lib/server/users";

export const runtime = "nodejs";

function clientKey(request: NextRequest) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  let body: { email?: unknown; password?: unknown; confirm_password?: unknown; tos?: unknown; turnstile_token?: unknown };
  try { body = await request.json(); } catch { return apiError("Invalid request."); }
  const email = normalizeAccountEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm_password === "string" ? body.confirm_password : "";
  if (!await withinLimit(`rl:signup:${clientKey(request)}`, 8, 60)) return apiError("Too many attempts. Please try again shortly.", 429);
  if (!await verifyTurnstile(request, body.turnstile_token)) return apiError("Security verification failed. Please try again.", 403);
  if (body.tos !== true) return apiError("You must accept the Terms of Service.");
  if (!email) return apiError("Enter a valid email address.", 422);
  if (password.length < 8 || password.length > 128) return apiError("Password must be 8-128 characters.");
  if (password !== confirm) return apiError("Passwords do not match.");
  try {
    if (await requestIpIsBanned(request)) return apiError("New accounts cannot be created from this network.", 403);
    if (await userByEmail(email)) return apiError("An account with this email already exists.", 409);
    const user = await createEmailUser(email, await argon2.hash(password), email.split("@", 1)[0]);
    await rememberSignupIp(user.id, request);
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
    await touchLogin(user.id);
    const { token, ttl } = await createSession(user.id, request);
    const response = NextResponse.json({ ok: true, redirect: process.env.MISA_DASHBOARD_URL || "/dashboard" }, { headers: { "Cache-Control": "no-store" } });
    attachSession(response, request, token, ttl);
    rememberSwitcherUser(response, request, user.id);
    return response;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23505") return apiError("An account with this email already exists.", 409);
    return apiError("Account creation is temporarily unavailable. Please try again.", 503);
  }
}
