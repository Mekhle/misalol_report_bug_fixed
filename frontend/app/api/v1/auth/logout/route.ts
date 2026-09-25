import { NextRequest, NextResponse } from "next/server";
import { clearSession, destroySession, SESSION_COOKIE } from "@/lib/server/sessions";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    // Clear the browser cookie even if Dragonfly is temporarily unavailable.
  }
  const response = NextResponse.json({ ok: true, redirect: "/" }, { headers: { "Cache-Control": "no-store" } });
  clearSession(response, request);
  return response;
}
