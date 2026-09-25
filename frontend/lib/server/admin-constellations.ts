import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AdminError, type AdminAccount } from "./admin-auth";
import { adminTransaction, adminUuid, audit } from "./admin-operations";
import { database } from "./postgres";
import { deleteFromR2 } from "./r2";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

function parseJson(val: unknown, fallback: unknown) {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val != null ? val : fallback;
}

function iso(val: unknown): string | null {
  if (!val) return null;
  return new Date(val as string | Date).toISOString();
}

async function getConstellationDetail(groupId: string) {
  const db = database();
  const group = (await db.query<Record<string, unknown>>(`
    SELECT c.*, u.username AS owner_username
    FROM constellations c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.id = $1
  `, [groupId])).rows[0];

  if (!group) throw new AdminError("Constellation not found.", 404);

  const memberRows = (await db.query<Record<string, unknown>>(`
    SELECT m.*, u.username, u.display_name, u.avatar_url, u.created_at AS user_created_at,
           u.suspended_at, u.suspended_until
    FROM constellation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.constellation_id = $1
    ORDER BY m.slot, m.joined_at
  `, [groupId])).rows;

  const now = new Date();
  const members = memberRows.map((row) => {
    const suspended = Boolean(
      row.suspended_at &&
      (!row.suspended_until || new Date(row.suspended_until as string | Date) > now)
    );
    return {
      userId: String(row.user_id),
      username: String(row.username || ""),
      displayName: String(row.display_name || row.username || "Misa user"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      role: String(row.role || "member"),
      slot: Number(row.slot),
      position: { x: Number(row.position_x), y: Number(row.position_y) },
      scale: Number(row.scale),
      frameOverride: row.frame_override ? String(row.frame_override) : null,
      joinedAt: iso(row.joined_at),
      active: !suspended,
    };
  });

  const inviteRows = (await db.query<Record<string, unknown>>(`
    SELECT i.*, u.username AS inviter_username
    FROM constellation_invitations i
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.constellation_id = $1
    ORDER BY i.created_at DESC
  `, [groupId])).rows;

  const invitations = inviteRows.map((row) => {
    const exp = row.expires_at ? new Date(row.expires_at as string | Date) : now;
    const status = row.revoked_at
      ? "revoked"
      : row.accepted_at
      ? "accepted"
      : exp <= now
      ? "expired"
      : "pending";
    return {
      id: String(row.id),
      groupId: String(row.constellation_id),
      userId: row.invited_user_id ? String(row.invited_user_id) : null,
      username: row.invited_username ? String(row.invited_username) : null,
      inviterUsername: row.inviter_username ? String(row.inviter_username) : null,
      status,
      expiresAt: iso(row.expires_at),
      createdAt: iso(row.created_at),
    };
  });

  const occupied = new Set(members.map((m) => m.slot));
  const capacity = Number(group.capacity);
  const availableSlots: number[] = [];
  for (let s = 1; s <= capacity; s++) {
    if (!occupied.has(s)) availableSlots.push(s);
  }

  return {
    id: String(group.id),
    ownerId: String(group.owner_id),
    ownerUsername: group.owner_username ? String(group.owner_username) : null,
    name: String(group.name || ""),
    slug: String(group.slug || ""),
    description: String(group.description || ""),
    capacity,
    assignmentMode: String(group.assignment_mode || "owner"),
    globalFont: String(group.global_font || "Inter"),
    allowMemberFonts: Boolean(group.allow_member_fonts),
    allowMemberMove: Boolean(group.allow_member_move),
    allowMemberResize: Boolean(group.allow_member_resize),
    frameMode: String(group.frame_mode || "member"),
    background: parseJson(group.background, { type: "color", color: "#08080d" }),
    sharedAssets: parseJson(group.shared_assets, { cursor: null, audio: null, audioCover: null, effectVideo: null, effect: "None" }),
    status: String(group.status || "draft"),
    published: group.status === "published",
    publicPath: `/c/${group.slug}`,
    members,
    invitations,
    availableSlots,
    canPublish: members.length === capacity && members.every((m) => m.active),
    hasUnpublishedChanges: group.status === "draft" && group.published_at != null,
    createdAt: iso(group.created_at),
    updatedAt: iso(group.updated_at),
    publishedAt: iso(group.published_at),
  };
}

export async function adminConstellationsRoute(
  request: NextRequest,
  path: string[],
  admin: AdminAccount & { staffRole: string }
) {
  if (path[0] !== "constellations") return null;
  const method = request.method;

  // List constellations: GET /admin/constellations
  if (path.length === 1 && method === "GET") {
    const search = (request.nextUrl.searchParams.get("search") || "").trim();
    const status = (request.nextUrl.searchParams.get("status") || "").trim();
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(Number.isInteger(rawLimit) ? rawLimit : 100, 200));

    const rows = (await database().query<Record<string, unknown>>(`
      SELECT c.id, c.name, c.slug, c.status, c.capacity, c.created_at, c.updated_at, c.owner_id,
             u.username AS owner_username, COUNT(m.user_id)::int AS member_count
      FROM constellations c
      LEFT JOIN users u ON u.id = c.owner_id
      LEFT JOIN constellation_members m ON m.constellation_id = c.id
      WHERE ($1 = '' OR c.name ILIKE '%'||$1||'%' OR c.slug ILIKE '%'||$1||'%'
             OR u.username ILIKE '%'||$1||'%' OR c.id::text = $1 OR c.owner_id::text = $1)
        AND ($2 = '' OR c.status = $2)
      GROUP BY c.id, u.username
      ORDER BY c.updated_at DESC
      LIMIT $3
    `, [search, status, limit])).rows;

    const constellations = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      capacity: Number(row.capacity),
      memberCount: Number(row.member_count),
      ownerId: String(row.owner_id),
      ownerUsername: row.owner_username ? String(row.owner_username) : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));

    return json({ constellations });
  }

  // Constellation detail: GET /admin/constellations/{constellation_id}
  if (path.length === 2 && method === "GET") {
    const groupId = adminUuid(path[1]);
    const detail = await getConstellationDetail(groupId);
    return json({ constellation: detail });
  }

  // Suspend / Restore status: PATCH /admin/constellations/{constellation_id}/status
  if (path.length === 3 && path[2] === "status" && method === "PATCH") {
    const groupId = adminUuid(path[1]);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.suspended !== "boolean") {
      throw new AdminError("Invalid request.", 422);
    }

    await adminTransaction(async (db) => {
      const group = (await db.query<{ id: string }>(
        "SELECT id FROM constellations WHERE id = $1 FOR UPDATE",
        [groupId]
      )).rows[0];
      if (!group) throw new AdminError("Constellation not found.", 404);

      await db.query(
        "UPDATE constellations SET status = $2, updated_at = NOW() WHERE id = $1",
        [groupId, body.suspended ? "suspended" : "draft"]
      );

      await audit(
        db,
        admin.id,
        body.suspended ? "constellation.admin.suspended" : "constellation.admin.restored",
        "constellation",
        groupId
      );
    });

    const detail = await getConstellationDetail(groupId);
    return json({ constellation: detail });
  }

  // Remove member: DELETE /admin/constellations/{constellation_id}/members/{member_id}
  if (path.length === 4 && path[2] === "members" && method === "DELETE") {
    if (!["owner", "admin"].includes(admin.staffRole)) {
      throw new AdminError("Only owners and administrators can remove members.", 403);
    }
    const groupId = adminUuid(path[1]);
    const targetId = adminUuid(path[3]);

    await adminTransaction(async (db) => {
      const group = (await db.query<{ owner_id: string }>(
        "SELECT owner_id FROM constellations WHERE id = $1 FOR UPDATE",
        [groupId]
      )).rows[0];
      if (!group) throw new AdminError("Constellation not found.", 404);

      if (String(group.owner_id) === targetId) {
        throw new AdminError("Transfer or delete the Constellation instead of removing its owner.", 409);
      }

      const result = await db.query(
        "DELETE FROM constellation_members WHERE constellation_id = $1 AND user_id = $2",
        [groupId, targetId]
      );
      if (!result.rowCount) throw new AdminError("Member not found.", 404);

      await db.query(
        "UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'",
        [groupId]
      );

      await audit(db, admin.id, "constellation.admin.member_removed", "constellation", groupId, {
        userId: targetId,
      });
    });

    const detail = await getConstellationDetail(groupId);
    return json({ constellation: detail });
  }

  // Revoke invitation: DELETE /admin/constellations/{constellation_id}/invitations/{invitation_id}
  if (path.length === 4 && path[2] === "invitations" && method === "DELETE") {
    const groupId = adminUuid(path[1]);
    const invitationId = adminUuid(path[3]);

    await adminTransaction(async (db) => {
      const group = (await db.query<{ id: string }>(
        "SELECT id FROM constellations WHERE id = $1 FOR UPDATE",
        [groupId]
      )).rows[0];
      if (!group) throw new AdminError("Constellation not found.", 404);

      const result = await db.query(
        "UPDATE constellation_invitations SET revoked_at = NOW() WHERE id = $1 AND constellation_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
        [invitationId, groupId]
      );
      if (!result.rowCount) throw new AdminError("Invitation not found.", 404);

      await audit(db, admin.id, "constellation.admin.invite_revoked", "constellation", groupId, {
        invitationId,
      });
    });

    const detail = await getConstellationDetail(groupId);
    return json({ constellation: detail });
  }

  // Delete constellation: DELETE /admin/constellations/{constellation_id}
  if (path.length === 2 && method === "DELETE") {
    if (!["owner", "admin"].includes(admin.staffRole)) {
      throw new AdminError("Only owners and administrators can delete Constellations.", 403);
    }
    const groupId = adminUuid(path[1]);

    let backgroundKey: string | null = null;
    let sharedKeys: string[] = [];

    await adminTransaction(async (db) => {
      const group = (await db.query<{ background: unknown; shared_assets: unknown }>(
        "SELECT background, shared_assets FROM constellations WHERE id = $1 FOR UPDATE",
        [groupId]
      )).rows[0];
      if (!group) throw new AdminError("Constellation not found.", 404);

      const background = parseJson(group.background, {}) as Record<string, unknown>;
      const sharedAssets = parseJson(group.shared_assets, {}) as Record<string, unknown>;

      if (background && typeof background.key === "string") {
        backgroundKey = background.key;
      }
      if (sharedAssets && typeof sharedAssets === "object") {
        for (const item of Object.values(sharedAssets)) {
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>).key === "string") {
            sharedKeys.push((item as Record<string, unknown>).key as string);
          }
        }
      }

      await audit(db, admin.id, "constellation.admin.deleted", "constellation", groupId);
      await db.query("DELETE FROM constellations WHERE id = $1", [groupId]);
    });

    if (backgroundKey) {
      await deleteFromR2(backgroundKey).catch(() => {});
    }
    for (const key of sharedKeys) {
      await deleteFromR2(key).catch(() => {});
    }

    return json({ deleted: true, backgroundKey, sharedKeys });
  }

  return null;
}
