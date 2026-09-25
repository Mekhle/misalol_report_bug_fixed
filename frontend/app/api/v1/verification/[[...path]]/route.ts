import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
import { applyVerification, myVerification } from "@/lib/server/verification";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function routePath(params: { path?: string[] }): string {
  const parts = params.path || [];
  return parts.join("/").toLowerCase();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const user = await currentUser(request);
  if (!user) return apiError("Not authenticated.", 401);

  const subpath = routePath(await params);
  if (subpath === "me") {
    const result = await myVerification(user);
    return json(result);
  }

  return apiError("Not found.", 404);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const user = await currentUser(request);
  if (!user) return apiError("Not authenticated.", 401);

  const subpath = routePath(await params);
  if (subpath === "me") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }

    try {
      const result = await applyVerification(user, payload.reason, payload.proofUrl);
      return json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification request failed.";
      if (msg === "RATE_LIMIT") return apiError("Rate limit exceeded.", 429);
      if (msg === "ALREADY_VERIFIED") return apiError("This account is already verified.", 409);
      if (msg === "ALREADY_PENDING") return apiError("A verification request is already pending.", 409);
      if (msg === "REASON_TOO_SHORT") return apiError("Tell us a bit more about why you should be verified.", 400);
      if (msg === "INVALID_PROOF_URL") return apiError("Use an http or https proof link.", 400);
      return apiError(msg, 400);
    }
  }

  return apiError("Not found.", 404);
}
