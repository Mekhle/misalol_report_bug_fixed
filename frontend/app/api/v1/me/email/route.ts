import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { mailerConfigured, publicOrigin, sendAccountMail, settingsPath } from "@/lib/server/account-mail";
import { popAccountToken, putAccountToken } from "@/lib/server/account-tokens";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { normalizeAccountEmail } from "@/lib/server/email-validation";
import { currentUser } from "@/lib/server/sessions";
import { userByEmail } from "@/lib/server/users";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    const body = await request.json().catch(() => null);
    const email = normalizeAccountEmail(body?.email);
    if (!email) return apiError("Enter a valid email address.", 422);
    if (user.password_hash && (typeof body?.password !== "string" || !await argon2.verify(user.password_hash, body.password).catch(() => false))) return apiError("Current password is wrong.", 401);
    if (!await withinLimit(`rl:email-change:${user.id}`, 5, 86400)) return apiError("Too many attempts. Try again later.", 429);
    const same = email === (user.email || "").trim().toLowerCase();
    if (same && user.email_verified) return apiError("This email is already confirmed.");
    if (!same) { const existing = await userByEmail(email); if (existing && existing.id !== user.id) return apiError("That email is already used.", 409); }
    if (!mailerConfigured()) return apiError("Email confirmation is not configured.", 503);
    const token = await putAccountToken("email_change", { user_id: user.id, email });
    if (!await sendAccountMail(email, "email_change", `${publicOrigin(request)}/api/v1/auth/confirm-email?token=${token}`)) {
      await popAccountToken("email_change", token);
      return apiError("Could not send the confirmation email.", 502);
    }
    if (user.email && user.email !== email) await sendAccountMail(user.email, "email_notice", new URL(settingsPath(), publicOrigin(request)).href);
    return NextResponse.json({ ok: true, pending_email: email }, { headers: { "Cache-Control": "no-store" } });
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
