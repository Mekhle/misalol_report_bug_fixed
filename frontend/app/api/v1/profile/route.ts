import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { publicProfile } from "@/lib/server/profiles";
import { currentHandleFor, usernameRedirect } from "@/lib/server/usernames";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  const username = request.nextUrl.searchParams.get("username") || "";
  const handle = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/i.test(handle)) return apiError("Profile not found.", 404);
  const alias = await currentHandleFor(handle);
  if (alias) return usernameRedirect(`/api/v1/profile?username=${alias}`);
  try {
    const profile = await publicProfile(handle);
    return profile ? NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } }) : apiError("Profile not found.", 404);
  } catch {
    return apiError("Profile storage is temporarily unavailable. Please try again.", 503);
  }
}
