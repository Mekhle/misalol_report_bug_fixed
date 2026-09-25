import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  constellationDetail,
  createConstellation,
  createConstellationInvite,
  DomainError,
  joinConstellationByToken,
  listConstellationsForUser,
  publicConstellation,
  removeConstellationBackground,
  removeConstellationMember,
  respondConstellationInvitation,
  revokeConstellationInvite,
  transferConstellationOwnership,
  unpublishConstellation,
  updateConstellation,
  updateConstellationBackgroundColor,
  updateConstellationMember,
  updateConstellationMemberProfile,
  updateConstellationSharedEffect,
  updateConstellationSharedAsset,
  uploadConstellationSharedAsset,
  deleteConstellation,
  uploadConstellationBackground,
  publishConstellation,
} from "@/lib/server/constellations";
import { apiError } from "@/lib/server/http";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
import { userByUsername } from "@/lib/server/users";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function routeParts(params: { path?: string[] }): string[] {
  return params.path || [];
}

async function requireConstellationUser(request: NextRequest) {
  const user = await currentUser(request);
  const now = new Date();
  const isSuspended = Boolean(
    user?.suspended_at &&
    (!user.suspended_until || new Date(user.suspended_until) > now)
  );
  if (!user || !user.username || isSuspended) {
    throw new DomainError("Sign in to manage Constellations.", 401);
  }
  const ok = await withinLimit(`rl:constellations:${user.id}`, 180, 300);
  if (!ok) {
    throw new DomainError("Rate limit exceeded. Please try again later.", 429);
  }
  return user;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  const parts = routeParts(await params);

  // GET /api/constellations/public/:slug (unauthenticated public route)
  if (parts.length === 2 && parts[0] === "public") {
    try {
      const group = await publicConstellation(parts[1]);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Constellation not found.", 404);
    }
  }

  // All subsequent GET routes require authentication
  let user;
  try {
    user = await requireConstellationUser(request);
  } catch (err) {
    if (err instanceof DomainError) return apiError(err.message, err.status);
    return apiError("Sign in to manage Constellations.", 401);
  }

  // GET /api/constellations/bootstrap
  if (parts.length === 1 && parts[0] === "bootstrap") {
    return json({
      me: {
        id: user.id,
        username: user.username || "",
        displayName: user.display_name || user.username || "",
        avatarUrl: user.avatar_url,
      },
    });
  }

  // GET /api/constellations
  if (parts.length === 0) {
    try {
      const data = await listConstellationsForUser(user.id);
      return json(data);
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Failed to list Constellations.", 500);
    }
  }

  // GET /api/constellations/:id
  if (parts.length === 1) {
    try {
      const group = await constellationDetail(parts[0], user.id);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Constellation not found.", 404);
    }
  }

  return apiError("Not found.", 404);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  let user;
  try {
    user = await requireConstellationUser(request);
  } catch (err) {
    if (err instanceof DomainError) return apiError(err.message, err.status);
    return apiError("Sign in to manage Constellations.", 401);
  }

  const parts = routeParts(await params);

  // POST /api/constellations (create)
  if (parts.length === 0) {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const group = await createConstellation(user, {
        name: String(payload.name || ""),
        slug: String(payload.slug || ""),
        capacity: Number(payload.capacity),
        assignmentMode: payload.assignmentMode ? String(payload.assignmentMode) : undefined,
      });
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Failed to create Constellation.", 400);
    }
  }

  // POST /api/constellations/join/:token
  if (parts.length === 2 && parts[0] === "join") {
    try {
      const group = await joinConstellationByToken(parts[1], user);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Failed to join Constellation.", 400);
    }
  }

  const groupId = parts[0];

  // POST /api/constellations/:id/invite
  if (parts.length === 2 && parts[1] === "invite") {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {}
    let targetUser = null;
    if (payload.username) {
      const targetName = String(payload.username).trim().toLowerCase().replace(/^@/, "");
      targetUser = await userByUsername(targetName);
      if (!targetUser) return apiError("That Misa user was not found.", 404);
      if (targetUser.id === user.id) return apiError("You are already in this Constellation.", 409);
    }
    try {
      const res = await createConstellationInvite(groupId, user.id, targetUser);
      return json(res);
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Invite creation failed.", 400);
    }
  }

  // POST /api/constellations/:id/invitations/:invId/respond
  if (parts.length === 4 && parts[1] === "invitations" && parts[3] === "respond") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const res = await respondConstellationInvitation(groupId, parts[2], user, Boolean(payload.accept));
      return json(res);
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Respond to invitation failed.", 400);
    }
  }

  // POST /api/constellations/:id/transfer
  if (parts.length === 2 && parts[1] === "transfer") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    const newOwnerId = String(payload.userId || payload.user_id || "");
    try {
      const group = await transferConstellationOwnership(groupId, user.id, newOwnerId);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Transfer failed.", 400);
    }
  }

  // POST /api/constellations/:id/publish
  if (parts.length === 2 && parts[1] === "publish") {
    try {
      const group = await publishConstellation(groupId, user.id);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Publish failed.", 400);
    }
  }

  // POST /api/constellations/:id/unpublish
  if (parts.length === 2 && parts[1] === "unpublish") {
    try {
      const group = await unpublishConstellation(groupId, user.id);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Unpublish failed.", 400);
    }
  }

  // POST /api/constellations/:id/background (multipart upload)
  if (parts.length === 2 && parts[1] === "background") {
    try {
      const formData = await request.formData();
      const kind = (String(formData.get("kind") || "image").toLowerCase()) as "image" | "video";
      const color = String(formData.get("color") || "#08080d");
      const file = formData.get("file");

      if (!file || !(file instanceof Blob)) {
        return apiError("File is required.", 400);
      }

      const contentType = file.type || "application/octet-stream";
      const allowed = kind === "image"
        ? ["image/png", "image/jpeg", "image/webp", "image/gif"]
        : ["video/mp4", "video/webm", "video/quicktime"];

      if (!allowed.includes(contentType)) {
        return apiError("That background file type is not supported.", 400);
      }

      const limit = kind === "image" ? 40_000_000 : 110_000_000;
      if (file.size > limit) {
        return apiError("That background file is too large.", 413);
      }

      const buffer = new Uint8Array(await file.arrayBuffer());
      const filename = (file as { name?: string }).name || "background";

      const group = await uploadConstellationBackground(
        groupId,
        user.id,
        kind,
        color,
        buffer,
        filename,
        contentType
      );
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Background upload failed.", 400);
    }
  }

  // POST /api/constellations/:id/shared/:kind
  if (parts.length === 3 && parts[1] === "shared") {
    const kind = parts[2];
    const rules: Record<string, { types: string[]; limit: number }> = {
      cursor: { types: ["image/png", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"], limit: 5_000_000 },
      audio: { types: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/webm"], limit: 40_000_000 },
      audioCover: { types: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: 15_000_000 },
      effectVideo: { types: ["video/mp4", "video/webm", "video/quicktime"], limit: 110_000_000 },
    };
    const rule = rules[kind];
    if (!rule) return apiError("Unsupported shared asset.", 422);
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || !(file instanceof Blob)) return apiError("File is required.", 400);
      const names: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac" };
      const filename = (file as { name?: string }).name || kind;
      const suffix = filename.slice(filename.lastIndexOf(".")).toLowerCase();
      const contentType = !file.type || file.type === "application/octet-stream" ? (names[suffix] || file.type) : file.type.toLowerCase();
      if (!rule.types.includes(contentType)) return apiError(`That shared ${kind} file type is not supported.`, 400);
      if (file.size > rule.limit) return apiError(`That shared ${kind} file is too large.`, 413);
      const group = await uploadConstellationSharedAsset(groupId, user.id, kind, new Uint8Array(await file.arrayBuffer()), filename, contentType, String(form.get("title") || "").trim().slice(0, 120));
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Shared asset upload failed.", 400);
    }
  }
  return apiError("Not found.", 404);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  let user;
  try {
    user = await requireConstellationUser(request);
  } catch (err) {
    if (err instanceof DomainError) return apiError(err.message, err.status);
    return apiError("Sign in to manage Constellations.", 401);
  }

  const parts = routeParts(await params);
  const groupId = parts[0];

  // PATCH /api/constellations/:id
  if (parts.length === 1) {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const group = await updateConstellation(groupId, user.id, payload);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Update failed.", 400);
    }
  }

  // PATCH /api/constellations/:id/members/:memberId
  if (parts.length === 3 && parts[1] === "members") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const group = await updateConstellationMember(groupId, user.id, parts[2], payload);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Update member failed.", 400);
    }
  }

  // PATCH /api/constellations/:id/background
  if (parts.length === 2 && parts[1] === "background") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const group = await updateConstellationBackgroundColor(groupId, user.id, String(payload.color || ""));
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Background update failed.", 400);
    }
  }

  // PATCH /api/constellations/:id/shared/effect
  if (parts.length === 3 && parts[1] === "shared" && parts[2] === "effect") {
    let payload: Record<string, unknown>;
    try { payload = await request.json() as Record<string, unknown>; } catch { return apiError("Invalid JSON payload.", 400); }
    try {
      const group = await updateConstellationSharedEffect(groupId, user.id, String(payload.effect || ""));
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Shared effect update failed.", 400);
    }
  }
  return apiError("Not found.", 404);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  let user;
  try {
    user = await requireConstellationUser(request);
  } catch (err) {
    if (err instanceof DomainError) return apiError(err.message, err.status);
    return apiError("Sign in to manage Constellations.", 401);
  }

  const parts = routeParts(await params);
  const groupId = parts[0];

  // PUT /api/constellations/:id/profile
  if (parts.length === 2 && parts[1] === "profile") {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON payload.", 400);
    }
    try {
      const group = await updateConstellationMemberProfile(groupId, user, payload);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Update member profile failed.", 400);
    }
  }

  return apiError("Not found.", 404);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  let user;
  try {
    user = await requireConstellationUser(request);
  } catch (err) {
    if (err instanceof DomainError) return apiError(err.message, err.status);
    return apiError("Sign in to manage Constellations.", 401);
  }

  const parts = routeParts(await params);
  const groupId = parts[0];

  // DELETE /api/constellations/:id/invitations/:invId
  if (parts.length === 3 && parts[1] === "invitations") {
    try {
      const group = await revokeConstellationInvite(groupId, parts[2], user.id);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Revoke invitation failed.", 400);
    }
  }

  // DELETE /api/constellations/:id/members/:memberId
  if (parts.length === 3 && parts[1] === "members") {
    try {
      const res = await removeConstellationMember(groupId, user.id, parts[2]);
      return json(res);
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Remove member failed.", 400);
    }
  }

  // DELETE /api/constellations/:id/background
  if (parts.length === 2 && parts[1] === "background") {
    try {
      const group = await removeConstellationBackground(groupId, user.id);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Remove background failed.", 400);
    }
  }

  // DELETE /api/constellations/:id/shared/:kind
  if (parts.length === 3 && parts[1] === "shared") {
    try {
      const group = await updateConstellationSharedAsset(groupId, user.id, parts[2], null);
      return json({ group });
    } catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Remove shared asset failed.", 400);
    }
  }

  // DELETE /api/constellations/:id
  if (parts.length === 1) {
    try { return json(await deleteConstellation(groupId, user.id)); }
    catch (err) {
      if (err instanceof DomainError) return apiError(err.message, err.status);
      return apiError("Delete Constellation failed.", 400);
    }
  }
  return apiError("Not found.", 404);
}
