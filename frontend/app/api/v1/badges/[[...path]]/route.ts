import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  BADGE_ID_REGEX,
  collectionForUser,
  getBadgeIcon,
  setFeatured,
} from "@/lib/server/achievements";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function routeParts(params: { path?: string[] }): string[] {
  return params.path || [];
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const parts = routeParts(await params);

  if (parts.length === 1 && parts[0] === "me") {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    try {
      const collection = await collectionForUser(user.id);
      return json(collection);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "USER_NOT_FOUND") {
        return apiError("User not found.", 404);
      }
      throw err;
    }
  }

  if (parts.length === 2 && parts[1] === "icon") {
    const badgeId = parts[0];
    if (!BADGE_ID_REGEX.test(badgeId)) {
      return apiError("Badge not found.", 404);
    }
    const result = await getBadgeIcon(badgeId);
    if (!result) {
      return apiError("Badge icon not found.", 404);
    }
    if (result.type === "redirect" && result.url) {
      return NextResponse.redirect(result.url, {
        status: 302,
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }
    if (result.type === "data" && result.buffer) {
      return new NextResponse(new Uint8Array(result.buffer), {
        status: 200,
        headers: {
          "Content-Type": result.contentType || "image/png",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    return apiError("Badge icon not found.", 404);
  }

  return apiError("Not found.", 404);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const parts = routeParts(await params);

  if (parts.length === 2 && parts[0] === "me" && parts[1] === "featured") {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }

    const badgeIds = Array.isArray(payload.badge_ids)
      ? (payload.badge_ids as string[])
      : Array.isArray(payload.badgeIds)
      ? (payload.badgeIds as string[])
      : [];

    if (badgeIds.some((id) => typeof id !== "string" || !BADGE_ID_REGEX.test(id))) {
      return apiError("Invalid badge selection.", 400);
    }

    try {
      const selected = await setFeatured(user.id, badgeIds);
      return json({ ok: true, badgeIds: selected });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "FEATURED_LIMIT") {
        return apiError("You can feature at most five badges.", 400);
      }
      if (msg === "NOT_OWNED") {
        return apiError("Only owned badges can be featured.", 400);
      }
      return apiError(msg || "Could not update featured badges.", 400);
    }
  }

  return apiError("Not found.", 404);
}
