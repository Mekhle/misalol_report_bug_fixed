import { createHmac } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/server/account-bans";
import { mailerConfigured, publicOrigin, sendAccountMail } from "@/lib/server/account-mail";
import { accountSecret } from "@/lib/server/account-security";
import { putAccountToken } from "@/lib/server/account-tokens";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { normalizeAccountEmail } from "@/lib/server/email-validation";
import { isSuspended, userByEmail } from "@/lib/server/users";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const body = await request.json().catch(() => null);
    const email = normalizeAccountEmail(body?.email);
    if (!email) return apiError("Enter a valid email address.", 422);
    if (!await withinLimit(`rl:forgot:${clientIp(request)}`, 5, 3600)) return apiError("Too many attempts. Try again later.", 429);
    // Python uses the backup-code normalizer before HMAC for this rate-limit key.
    const hash = createHmac("sha256", accountSecret()).update(email.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "")).digest("hex").slice(0, 24);
    if (!await withinLimit(`rl:forgot-email:${hash}`, 3, 3600)) return apiError("Too many attempts. Try again later.", 429);
    const user = await userByEmail(email);
    if (user?.email && !isSuspended(user) && mailerConfigured()) {
      const token = await putAccountToken("password_reset", { user_id: user.id });
      const url = `${publicOrigin(request)}/reset-password?token=${token}`;
      const recipient = user.email;
      after(async () => { await sendAccountMail(recipient, "password_reset", url); });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
