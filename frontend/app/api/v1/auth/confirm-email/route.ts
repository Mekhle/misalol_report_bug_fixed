import { NextRequest, NextResponse } from "next/server";
import { publicOrigin, settingsPath } from "@/lib/server/account-mail";
import { peekAccountToken, popAccountToken } from "@/lib/server/account-tokens";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { userByEmail } from "@/lib/server/users";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  const redirect = (status: string) => { const url = new URL(settingsPath(), publicOrigin(request)); url.searchParams.set("email", status); return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } }); };
  try {
    const token = request.nextUrl.searchParams.get("token") || "";
    const saved = token ? await peekAccountToken("email_change", token) : null;
    if (!saved?.user_id || !saved.email) return redirect("invalid");
    const email = saved.email.trim().toLowerCase();
    const existing = await userByEmail(email);
    if (existing && existing.id !== saved.user_id) { await popAccountToken("email_change", token); return redirect("taken"); }
    try {
      const updated = await database().query("UPDATE users SET email=$2,email_verified=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id", [saved.user_id, email]);
      if (!updated.rowCount) return redirect("invalid");
    } catch (error) {
      if ((error as {code?: string}).code !== "23505") throw error;
      await popAccountToken("email_change", token);
      return redirect("taken");
    }
    await popAccountToken("email_change", token);
    return redirect("confirmed");
  } catch { return apiError("Account storage is temporarily unavailable. Please try again.", 503); }
}
