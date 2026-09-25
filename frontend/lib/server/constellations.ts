import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit } from "./admin-operations";
import { database, one } from "./postgres";
import { hasPremium } from "./profile-persistence";
import { deleteFromR2, r2Enabled, uploadToR2 } from "./r2";
import type { User } from "./users";

export const INVITATION_DAYS = 7;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 4;

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normalizedSlug(value: string): string {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug)) {
    throw new DomainError("Use 2–32 lowercase letters, numbers, or internal hyphens for the URL.", 422);
  }
  return slug;
}

export function defaultPositions(capacity: number): Array<{ x: number; y: number }> {
  const examples: Record<number, Array<{ x: number; y: number }>> = {
    2: [{ x: 27.0, y: 50.0 }, { x: 73.0, y: 50.0 }],
    3: [{ x: 50.0, y: 27.0 }, { x: 25.0, y: 68.0 }, { x: 75.0, y: 68.0 }],
    4: [{ x: 28.0, y: 30.0 }, { x: 72.0, y: 30.0 }, { x: 28.0, y: 72.0 }, { x: 72.0, y: 72.0 }],
  };
  const list = examples[capacity];
  if (!list) throw new DomainError("Constellations support 2–4 profiles.", 422);
  return list;
}

export function defaultScale(capacity: number): number {
  const scales: Record<number, number> = { 2: 0.86, 3: 0.76, 4: 0.62 };
  const scale = scales[capacity];
  if (scale === undefined) throw new DomainError("Constellations support 2–4 profiles.", 422);
  return scale;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value != null ? value : fallback) as T;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function iso(val: unknown): string | null {
  if (!val) return null;
  return new Date(val as string | Date).toISOString();
}

export type ConstellationMember = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  slot: number;
  position: { x: number; y: number };
  scale: number;
  frameOverride: string;
  joinedAt: string | null;
  active: boolean;
  profile?: Record<string, unknown>;
};

export type ConstellationInvitation = {
  id: string;
  groupId: string;
  userId: string | null;
  username: string | null;
  inviterUsername: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string | null;
  createdAt: string | null;
};

export type ConstellationDetail = {
  id: string;
  ownerId?: string;
  ownerUsername: string | null;
  name: string;
  slug: string;
  description: string;
  capacity: number;
  assignmentMode: string;
  globalFont: string;
  allowMemberFonts: boolean;
  allowMemberMove: boolean;
  allowMemberResize: boolean;
  frameMode: string;
  background: Record<string, unknown>;
  sharedAssets: Record<string, unknown>;
  status: string;
  published: boolean;
  publicPath: string;
  members: ConstellationMember[];
  invitations?: ConstellationInvitation[];
  availableSlots?: number[];
  canPublish: boolean;
  hasUnpublishedChanges: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
};

export async function getConstellationGroup(groupId: string, lock = false) {
  const db = database();
  const query = `
    SELECT c.*, u.username AS owner_username
    FROM constellations c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.id = $1
  ` + (lock ? " FOR UPDATE OF c" : "");

  try {
    const row = (await db.query<Record<string, unknown>>(query, [groupId])).rows[0];
    if (!row) throw new DomainError("Constellation not found.", 404);
    return row;
  } catch (err: unknown) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("Constellation not found.", 404);
  }
}

export async function getConstellationMembership(groupId: string, userId: string) {
  const db = database();
  try {
    return (await db.query<Record<string, unknown>>(
      "SELECT * FROM constellation_members WHERE constellation_id = $1 AND user_id = $2",
      [groupId, userId]
    )).rows[0] || null;
  } catch {
    return null;
  }
}

export async function requireMember(groupId: string, userId: string, lock = false) {
  const group = await getConstellationGroup(groupId, lock);
  const member = await getConstellationMembership(groupId, userId);
  if (!member) throw new DomainError("Constellation not found.", 404);
  return { group, member };
}

export async function requireOwner(groupId: string, userId: string, lock = false) {
  const group = await getConstellationGroup(groupId, lock);
  if (String(group.owner_id) !== userId) {
    throw new DomainError("Only the Constellation owner can do that.", 403);
  }
  return group;
}

export async function fetchMemberRows(groupId: string) {
  const db = database();
  return (await db.query<Record<string, unknown>>(`
    SELECT m.*, u.username, u.display_name, u.avatar_url, u.created_at AS user_created_at,
           u.suspended_at, u.suspended_until
    FROM constellation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.constellation_id = $1
    ORDER BY m.slot, m.joined_at
  `, [groupId])).rows;
}

export async function fetchInvitations(groupId: string): Promise<ConstellationInvitation[]> {
  const db = database();
  const rows = (await db.query<Record<string, unknown>>(`
    SELECT i.*, u.username AS inviter_username
    FROM constellation_invitations i
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.constellation_id = $1
    ORDER BY i.created_at DESC
  `, [groupId])).rows;

  const now = Date.now();
  return rows.map((row) => {
    const expiresAt = row.expires_at ? new Date(row.expires_at as string | Date).getTime() : 0;
    let status: ConstellationInvitation["status"] = "pending";
    if (row.revoked_at) status = "revoked";
    else if (row.accepted_at) status = "accepted";
    else if (expiresAt <= now) status = "expired";

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
}

function serializeConstellation(
  group: Record<string, unknown>,
  members: ConstellationMember[],
  invitations?: ConstellationInvitation[]
): ConstellationDetail {
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
    name: String(group.name),
    slug: String(group.slug),
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
    status: String(group.status),
    published: group.status === "published",
    publicPath: `/c/${group.slug}`,
    members,
    invitations: invitations || [],
    availableSlots,
    canPublish: members.length === capacity && members.every((m) => m.active),
    hasUnpublishedChanges: group.status === "draft" && group.published_at != null,
    createdAt: iso(group.created_at),
    updatedAt: iso(group.updated_at),
    publishedAt: iso(group.published_at),
  };
}

export async function constellationDetail(groupId: string, userId: string): Promise<ConstellationDetail> {
  const { group } = await requireMember(groupId, userId);
  const isOwner = String(group.owner_id) === userId;
  const memberRows = await fetchMemberRows(groupId);

  const now = new Date();
  const members: ConstellationMember[] = memberRows.map((row) => {
    const suspended = Boolean(
      row.suspended_at &&
      (!row.suspended_until || new Date(row.suspended_until as string | Date) > now)
    );
    const profile = parseJson<Record<string, unknown> | undefined>(row.profile_config, undefined);

    return {
      userId: String(row.user_id),
      username: String(row.username || ""),
      displayName: String(row.display_name || row.username || "Misa user"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      role: String(row.role || "member"),
      slot: Number(row.slot),
      position: { x: Number(row.position_x), y: Number(row.position_y) },
      scale: Number(row.scale),
      frameOverride: String(row.frame_override || "inherit"),
      joinedAt: iso(row.joined_at),
      active: !suspended,
      profile,
    };
  });

  const invitations = isOwner ? await fetchInvitations(groupId) : [];
  return serializeConstellation(group, members, invitations);
}

export async function createConstellation(
  user: User,
  data: { name: string; slug: string; capacity: number; assignmentMode?: string }
): Promise<ConstellationDetail> {
  const title = String(data.name || "").trim();
  const slug = normalizedSlug(data.slug);
  const capacity = Number(data.capacity);
  const assignmentMode = data.assignmentMode || "owner";

  if (title.length < 1 || title.length > 60) {
    throw new DomainError("Give your Constellation a name of 1–60 characters.", 422);
  }
  if (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY || !["owner", "self"].includes(assignmentMode)) {
    throw new DomainError("Choose valid slots and assignment permissions.", 422);
  }

  const groupId = randomUUID();
  const pos = defaultPositions(capacity)[0];
  const initialProfile = {
    profile: {
      username: user.username,
      displayName: user.display_name || user.username,
      uid: user.id,
      joinedAt: user.created_at || "",
    },
  };

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO constellations (id, owner_id, name, slug, capacity, assignment_mode)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [groupId, user.id, title, slug, capacity, assignmentMode]);

    await client.query(`
      INSERT INTO constellation_members (constellation_id, user_id, role, slot, position_x, position_y, scale, profile_config)
      VALUES ($1, $2, 'owner', 1, $3, $4, $5, $6::jsonb)
    `, [groupId, user.id, pos.x, pos.y, defaultScale(capacity), JSON.stringify(initialProfile)]);

    await audit(client, user.id, "constellation.created", "constellation", groupId, { capacity });
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      throw new DomainError("That Constellation URL is already taken.", 409);
    }
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, user.id);
}

export async function listConstellationsForUser(userId: string) {
  const db = database();
  const idRows = (await db.query<{ id: string }>(`
    SELECT c.id
    FROM constellations c
    JOIN constellation_members m ON m.constellation_id = c.id
    WHERE m.user_id = $1
    ORDER BY c.updated_at DESC
  `, [userId])).rows;

  const invRows = (await db.query<Record<string, unknown>>(`
    SELECT i.*, c.name AS group_name, c.capacity, u.username AS inviter_username
    FROM constellation_invitations i
    JOIN constellations c ON c.id = i.constellation_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.invited_user_id = $1 AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `, [userId])).rows;

  const groups = await Promise.all(idRows.map((r) => constellationDetail(r.id, userId)));

  const invitations = invRows.map((row) => ({
    id: String(row.id),
    groupId: String(row.constellation_id),
    groupName: String(row.group_name || ""),
    capacity: Number(row.capacity),
    userId: String(row.invited_user_id || ""),
    username: String(row.invited_username || ""),
    inviterUsername: String(row.inviter_username || ""),
    status: "pending",
    expiresAt: iso(row.expires_at),
  }));

  return { groups, invitations };
}

export async function updateConstellation(
  groupId: string,
  actorId: string,
  patch: Record<string, unknown>
): Promise<ConstellationDetail> {
  const allowed = new Set([
    "name", "slug", "description", "capacity", "assignmentMode",
    "globalFont", "allowMemberFonts", "allowMemberMove", "allowMemberResize", "frameMode"
  ]);

  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new DomainError("Unsupported Constellation setting.", 422);
  }

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];

    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const name = patch.name !== undefined ? String(patch.name).trim() : String(group.name);
    const slug = patch.slug !== undefined ? normalizedSlug(String(patch.slug)) : String(group.slug);
    const description = patch.description !== undefined ? String(patch.description || "").trim() : String(group.description || "");
    const capacity = patch.capacity !== undefined ? Number(patch.capacity) : Number(group.capacity);
    const assignmentMode = patch.assignmentMode !== undefined ? String(patch.assignmentMode) : String(group.assignment_mode);
    const globalFont = patch.globalFont !== undefined ? String(patch.globalFont || "Inter").slice(0, 120) : String(group.global_font || "Inter");
    const allowMemberFonts = patch.allowMemberFonts !== undefined ? Boolean(patch.allowMemberFonts) : Boolean(group.allow_member_fonts);
    const allowMemberMove = patch.allowMemberMove !== undefined ? Boolean(patch.allowMemberMove) : Boolean(group.allow_member_move);
    const allowMemberResize = patch.allowMemberResize !== undefined ? Boolean(patch.allowMemberResize) : Boolean(group.allow_member_resize);
    const frameMode = patch.frameMode !== undefined ? String(patch.frameMode) : String(group.frame_mode);

    if (name.length < 1 || name.length > 60 || description.length > 500) {
      throw new DomainError("Check the name and description lengths.", 422);
    }

    const highestSlotRow = (await client.query<{ max: number | null }>(`
      SELECT COALESCE(MAX(slot), 0) AS max FROM constellation_members WHERE constellation_id = $1
    `, [groupId])).rows[0];
    const highest = Number(highestSlotRow?.max || 0);

    if (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY || capacity < highest) {
      throw new DomainError("The slot count cannot exclude an assigned member.", 409);
    }
    if (!["owner", "self"].includes(assignmentMode) || !["member", "framed", "frameless"].includes(frameMode)) {
      throw new DomainError("Invalid Constellation permissions.", 422);
    }

    await client.query(`
      UPDATE constellations
      SET name = $2, slug = $3, description = $4, capacity = $5, assignment_mode = $6,
          global_font = $7, allow_member_fonts = $8, allow_member_move = $9, allow_member_resize = $10,
          frame_mode = $11, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW()
      WHERE id = $1
    `, [
      groupId, name, slug, description, capacity, assignmentMode,
      globalFont, allowMemberFonts, allowMemberMove, allowMemberResize, frameMode
    ]);

    await audit(client, actorId, "constellation.settings.updated", "constellation", groupId, { fields: Object.keys(patch).sort() });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function createConstellationInvite(
  groupId: string,
  actorId: string,
  targetUser?: User | null
): Promise<{ invitation: Record<string, unknown> }> {
  const token = randomBytes(24).toString("base64url");
  const invitationId = randomUUID();
  const expires = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];

    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const countRow = (await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM constellation_members WHERE constellation_id = $1
    `, [groupId])).rows[0];
    if (Number(countRow?.count || 0) >= Number(group.capacity)) {
      throw new DomainError("This Constellation is full.", 409);
    }

    if (targetUser) {
      const existing = (await client.query(`
        SELECT 1 FROM constellation_members WHERE constellation_id = $1 AND user_id = $2
      `, [groupId, targetUser.id])).rows[0];
      if (existing) throw new DomainError("That person is already a member.", 409);

      const pending = (await client.query(`
        SELECT 1 FROM constellation_invitations
        WHERE constellation_id = $1 AND invited_user_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > NOW()
      `, [groupId, targetUser.id])).rows[0];
      if (pending) throw new DomainError("That person already has a pending invitation.", 409);
    }

    await client.query(`
      INSERT INTO constellation_invitations (id, constellation_id, token_hash, invited_user_id, invited_username, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      invitationId, groupId, tokenHash(token),
      targetUser ? targetUser.id : null,
      targetUser ? targetUser.username : null,
      actorId, expires
    ]);

    await audit(client, actorId, "constellation.invite.created", "constellation", groupId, { target: targetUser?.username || null });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    invitation: {
      id: invitationId,
      groupId,
      username: targetUser?.username || null,
      status: "pending",
      expiresAt: expires.toISOString(),
      token,
      joinPath: `/dashboard/constellations?invite=${token}`,
    },
  };
}

async function acceptInvitation(client: { query: Function }, invitation: Record<string, unknown>, user: User) {
  const groupId = String(invitation.constellation_id);
  const group = (await client.query(`SELECT * FROM constellations WHERE id = $1 FOR UPDATE`, [groupId])).rows[0];
  if (!group) throw new DomainError("Constellation not found.", 404);

  const now = new Date();
  if (invitation.revoked_at || new Date(invitation.expires_at as string | Date) <= now) {
    throw new DomainError("This invitation is no longer valid.", 410);
  }
  if (invitation.invited_user_id && String(invitation.invited_user_id) !== user.id) {
    throw new DomainError("This invitation belongs to another account.", 403);
  }
  if (invitation.accepted_at && String(invitation.accepted_by) !== user.id) {
    throw new DomainError("This invitation has already been used.", 410);
  }

  const existingMember = (await client.query(`
    SELECT * FROM constellation_members WHERE constellation_id = $1 AND user_id = $2
  `, [groupId, user.id])).rows[0];

  if (existingMember) {
    if (!invitation.accepted_at) {
      await client.query(`
        UPDATE constellation_invitations SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1
      `, [invitation.id, user.id]);
    }
    return groupId;
  }

  const memberRows = (await client.query(`
    SELECT slot FROM constellation_members WHERE constellation_id = $1 FOR UPDATE
  `, [groupId])).rows;
  const occupied = new Set(memberRows.map((r: { slot: number }) => Number(r.slot)));

  const capacity = Number(group.capacity);
  let availableSlot: number | null = null;
  for (let s = 1; s <= capacity; s++) {
    if (!occupied.has(s)) {
      availableSlot = s;
      break;
    }
  }

  if (!availableSlot) {
    throw new DomainError("This Constellation is full.", 409);
  }

  const pos = defaultPositions(capacity)[availableSlot - 1];
  const initialProfile = {
    profile: {
      username: user.username,
      displayName: user.display_name || user.username,
      uid: user.id,
      joinedAt: user.created_at || "",
    },
  };

  await client.query(`
    INSERT INTO constellation_members (constellation_id, user_id, role, slot, position_x, position_y, scale, profile_config)
    VALUES ($1, $2, 'member', $3, $4, $5, $6, $7::jsonb)
  `, [groupId, user.id, availableSlot, pos.x, pos.y, defaultScale(capacity), JSON.stringify(initialProfile)]);

  await client.query(`
    UPDATE constellation_invitations SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1
  `, [invitation.id, user.id]);

  await client.query(`
    UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'
  `, [groupId]);

  await audit(client as any, user.id, "constellation.member.joined", "constellation", groupId, { slot: availableSlot });
  return groupId;
}

export async function joinConstellationByToken(token: string, user: User): Promise<ConstellationDetail> {
  if (token.length < 20 || token.length > 128) {
    throw new DomainError("Invalid invitation.", 404);
  }

  const hash = tokenHash(token);
  const db = database();
  const client = await db.connect();
  let groupId: string;
  try {
    await client.query("BEGIN");
    const invitation = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellation_invitations WHERE token_hash = $1 FOR UPDATE
    `, [hash])).rows[0];

    if (!invitation) throw new DomainError("Invalid invitation.", 404);
    groupId = await acceptInvitation(client, invitation, user);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, user.id);
}

export async function respondConstellationInvitation(
  groupId: string,
  invitationId: string,
  user: User,
  accept: boolean
): Promise<{ accepted: boolean; group?: ConstellationDetail }> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const invitation = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellation_invitations WHERE id = $1 AND constellation_id = $2 FOR UPDATE
    `, [invitationId, groupId])).rows[0];

    if (!invitation || String(invitation.invited_user_id || "") !== user.id) {
      throw new DomainError("Invitation not found.", 404);
    }

    if (accept) {
      await acceptInvitation(client, invitation, user);
      await client.query("COMMIT");
      const group = await constellationDetail(groupId, user.id);
      return { accepted: true, group };
    } else {
      const now = new Date();
      if (invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at as string | Date) <= now) {
        throw new DomainError("This invitation is no longer pending.", 409);
      }
      await client.query("UPDATE constellation_invitations SET revoked_at = NOW() WHERE id = $1", [invitationId]);
      await audit(client, user.id, "constellation.invite.declined", "constellation", groupId);
      await client.query("COMMIT");
      return { accepted: false };
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeConstellationInvite(
  groupId: string,
  invitationId: string,
  actorId: string
): Promise<ConstellationDetail> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1
    `, [groupId])).rows[0];

    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const res = await client.query(`
      UPDATE constellation_invitations
      SET revoked_at = NOW()
      WHERE id = $1 AND constellation_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
    `, [invitationId, groupId]);

    if ((res.rowCount ?? 0) === 0) {
      throw new DomainError("Invitation not found.", 404);
    }

    await audit(client, actorId, "constellation.invite.revoked", "constellation", groupId, { invitationId });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function updateConstellationMember(
  groupId: string,
  actorId: string,
  targetId: string,
  patch: Record<string, unknown>
): Promise<ConstellationDetail> {
  const allowed = new Set(["slot", "position", "scale", "frameOverride"]);
  for (const k of Object.keys(patch)) {
    if (!allowed.has(k)) throw new DomainError("Unsupported profile placement setting.", 422);
  }

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);

    const target = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellation_members WHERE constellation_id = $1 AND user_id = $2
    `, [groupId, targetId])).rows[0];
    if (!target) throw new DomainError("Member not found.", 404);

    const isOwner = String(group.owner_id) === actorId;
    const isSelf = actorId === targetId;
    if (!isOwner && !isSelf) {
      throw new DomainError("You cannot modify another member's profile.", 403);
    }

    let slot = Number(target.slot);
    let x = Number(target.position_x);
    let y = Number(target.position_y);
    let scale = Number(target.scale);
    let frame = String(target.frame_override);

    if (patch.slot !== undefined) {
      if (!isOwner && group.assignment_mode !== "self") {
        throw new DomainError("The owner assigns profile slots.", 403);
      }
      slot = Number(patch.slot);
      if (slot < 1 || slot > Number(group.capacity)) {
        throw new DomainError("Choose an available profile slot.", 422);
      }
    }

    if (patch.position !== undefined) {
      if (!isOwner && !group.allow_member_move) {
        throw new DomainError("Members cannot move profiles in this Constellation.", 403);
      }
      const pos = patch.position as { x: number; y: number };
      x = Number(pos.x);
      y = Number(pos.y);
      if (x < 0 || x > 100 || y < 0 || y > 100) {
        throw new DomainError("Profile position must stay inside the canvas.", 422);
      }
    }

    if (patch.scale !== undefined) {
      if (!isOwner && !group.allow_member_resize) {
        throw new DomainError("Members cannot resize profiles in this Constellation.", 403);
      }
      scale = Number(patch.scale);
      if (scale < 0.4 || scale > 1.8) {
        throw new DomainError("Profile scale must be between 40% and 180%.", 422);
      }
    }

    if (patch.frameOverride !== undefined) {
      if (!isOwner && group.frame_mode !== "member") {
        throw new DomainError("The owner controls frames in this Constellation.", 403);
      }
      frame = String(patch.frameOverride);
      if (!["inherit", "framed", "frameless"].includes(frame)) {
        throw new DomainError("Choose framed, frameless, or inherit.", 422);
      }
    }

    try {
      await client.query(`
        UPDATE constellation_members
        SET slot = $3, position_x = $4, position_y = $5, scale = $6, frame_override = $7, updated_at = NOW()
        WHERE constellation_id = $1 AND user_id = $2
      `, [groupId, targetId, slot, x, y, scale, frame]);
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
        throw new DomainError("That profile slot is already occupied.", 409);
      }
      throw err;
    }

    await client.query(`
      UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'
    `, [groupId]);

    await audit(client, actorId, "constellation.member.placement", "constellation", groupId, { userId: targetId, slot });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function updateConstellationMemberProfile(
  groupId: string,
  user: User,
  payload: Record<string, unknown>
): Promise<ConstellationDetail> {
  const profileSection = payload.profile;
  if (!profileSection || typeof profileSection !== "object") {
    throw new DomainError("Invalid Constellation profile payload.", 400);
  }
  if (!user.username) {
    throw new DomainError("Choose a username before saving your Constellation design.", 400);
  }

  const identity = { ...(profileSection as Record<string, unknown>) };
  if (String(identity.username || "").trim().toLowerCase() !== user.username.toLowerCase()) {
    throw new DomainError("Profile username does not match the signed-in member.", 400);
  }
  if (!String(identity.displayName || "").trim()) {
    throw new DomainError("Display name cannot be empty.", 400);
  }

  identity.username = user.username;
  identity.uid = user.id;
  payload.profile = identity;

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query(`SELECT * FROM constellations WHERE id = $1`, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);

    const member = (await client.query(`
      SELECT * FROM constellation_members WHERE constellation_id = $1 AND user_id = $2 FOR UPDATE
    `, [groupId, user.id])).rows[0];
    if (!member) throw new DomainError("Constellation not found.", 404);

    await client.query(`
      UPDATE constellation_members
      SET profile_config = $3::jsonb, updated_at = NOW()
      WHERE constellation_id = $1 AND user_id = $2
    `, [groupId, user.id, JSON.stringify(payload)]);

    await client.query(`
      UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'
    `, [groupId]);

    await audit(client, user.id, "constellation.member.design", "constellation", groupId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, user.id);
}

export async function removeConstellationMember(
  groupId: string,
  actorId: string,
  targetId: string
): Promise<{ left: boolean; group?: ConstellationDetail }> {
  const isSelf = actorId === targetId;
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);

    const isOwner = String(group.owner_id) === actorId;
    if (!isSelf && !isOwner) {
      throw new DomainError("Only the owner can remove another member.", 403);
    }
    if (String(group.owner_id) === targetId) {
      throw new DomainError("Transfer ownership before the owner leaves.", 409);
    }

    const res = await client.query(`
      DELETE FROM constellation_members WHERE constellation_id = $1 AND user_id = $2
    `, [groupId, targetId]);

    if ((res.rowCount ?? 0) === 0) {
      throw new DomainError("Member not found.", 404);
    }

    await client.query(`
      UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'
    `, [groupId]);

    await audit(client, actorId, "constellation.member.removed", "constellation", groupId, { userId: targetId });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (isSelf) return { left: true };
  const detail = await constellationDetail(groupId, actorId);
  return { left: false, group: detail };
}

export async function transferConstellationOwnership(
  groupId: string,
  actorId: string,
  targetId: string
): Promise<ConstellationDetail> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const member = (await client.query(`
      SELECT 1 FROM constellation_members WHERE constellation_id = $1 AND user_id = $2
    `, [groupId, targetId])).rows[0];
    if (!member) throw new DomainError("Choose a current member.", 404);

    await client.query("UPDATE constellation_members SET role = 'member' WHERE constellation_id = $1", [groupId]);
    await client.query("UPDATE constellation_members SET role = 'owner' WHERE constellation_id = $1 AND user_id = $2", [groupId, targetId]);
    await client.query("UPDATE constellations SET owner_id = $2, status = 'draft', updated_at = NOW() WHERE id = $1", [groupId, targetId]);

    await audit(client, actorId, "constellation.owner.transferred", "constellation", groupId, { ownerId: targetId });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function publishConstellation(groupId: string, actorId: string): Promise<ConstellationDetail> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }
    if (group.status === "suspended") {
      throw new DomainError("This Constellation is suspended.", 403);
    }

    const members = (await client.query<Record<string, unknown>>(`
      SELECT m.*, u.suspended_at, u.suspended_until
      FROM constellation_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.constellation_id = $1
    `, [groupId])).rows;

    if (members.length !== Number(group.capacity)) {
      throw new DomainError("Fill every profile slot before publishing.", 409);
    }

    const now = new Date();
    const hasSuspended = members.some((m) =>
      m.suspended_at && (!m.suspended_until || new Date(m.suspended_until as string | Date) > now)
    );
    if (hasSuspended) {
      throw new DomainError("Every member must have an active account.", 409);
    }

    await client.query(`
      UPDATE constellations SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1
    `, [groupId]);

    await audit(client, actorId, "constellation.published", "constellation", groupId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function unpublishConstellation(groupId: string, actorId: string): Promise<ConstellationDetail> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    await client.query(`
      UPDATE constellations SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status <> 'suspended'
    `, [groupId]);

    await audit(client, actorId, "constellation.unpublished", "constellation", groupId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function updateConstellationBackgroundColor(
  groupId: string,
  actorId: string,
  color: string
): Promise<ConstellationDetail> {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new DomainError("Invalid background color.", 422);
  }

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const currentBg = parseJson<Record<string, unknown>>(group.background, { type: "color", color: "#08080d" });
    const newBg = { ...currentBg, color };

    await client.query(`
      UPDATE constellations SET background = $2::jsonb, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW()
      WHERE id = $1
    `, [groupId, JSON.stringify(newBg)]);

    await audit(client, actorId, "constellation.background.updated", "constellation", groupId, { color });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return constellationDetail(groupId, actorId);
}

export async function uploadConstellationBackground(
  groupId: string,
  actorId: string,
  kind: "image" | "video",
  color: string,
  fileBytes: Uint8Array,
  filename: string,
  contentType: string
): Promise<ConstellationDetail> {
  if (!r2Enabled()) {
    throw new DomainError("R2 object storage is not configured.", 503);
  }

  const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#08080d";
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 100) || "background";
  const key = `constellations/${groupId}/background/${randomUUID()}-${safeFilename}`;

  let oldKey: string | null = null;
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const previousBg = parseJson<Record<string, unknown>>(group.background, {});
    oldKey = typeof previousBg.key === "string" ? previousBg.key : null;

    const publicUrl = await uploadToR2(key, fileBytes, contentType);
    const newBg = {
      type: kind,
      color: cleanColor,
      url: publicUrl,
      key,
      name: safeFilename,
      contentType,
    };

    await client.query(`
      UPDATE constellations SET background = $2::jsonb, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW()
      WHERE id = $1
    `, [groupId, JSON.stringify(newBg)]);

    await audit(client, actorId, "constellation.background.updated", "constellation", groupId, { type: kind });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    await deleteFromR2(key).catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (oldKey && oldKey !== key) {
    await deleteFromR2(oldKey).catch(() => {});
  }

  return constellationDetail(groupId, actorId);
}

export async function removeConstellationBackground(
  groupId: string,
  actorId: string
): Promise<ConstellationDetail> {
  const db = database();
  let oldKey: string | null = null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>(`
      SELECT * FROM constellations WHERE id = $1 FOR UPDATE
    `, [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) {
      throw new DomainError("Only the Constellation owner can do that.", 403);
    }

    const currentBg = parseJson<Record<string, unknown>>(group.background, {});
    oldKey = typeof currentBg.key === "string" ? currentBg.key : null;
    const newBg = { type: "color", color: currentBg.color || "#08080d" };

    await client.query(`
      UPDATE constellations SET background = $2::jsonb, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW()
      WHERE id = $1
    `, [groupId, JSON.stringify(newBg)]);

    await audit(client, actorId, "constellation.background.removed", "constellation", groupId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (oldKey) {
    await deleteFromR2(oldKey).catch(() => {});
  }

  return constellationDetail(groupId, actorId);
}

const SHARED_ASSET_KINDS = new Set(["cursor", "audio", "audioCover", "effectVideo"]);
const SHARED_EFFECTS = new Set(["None", "Snowflakes", "Snow", "Sakura", "Rain", "Fireflies"]);

function sharedAssets(value: unknown): Record<string, unknown> {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  const defaults = { cursor: null, audio: null, audioCover: null, effectVideo: null, effect: "None" };
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...defaults, ...parsed } : defaults;
}

async function lockedConstellationMember(client: PoolClient, groupId: string, actorId: string) {
  const group = (await client.query<Record<string, unknown>>("SELECT * FROM constellations WHERE id = $1 FOR UPDATE", [groupId])).rows[0];
  if (!group) throw new DomainError("Constellation not found.", 404);
  const member = (await client.query("SELECT 1 FROM constellation_members WHERE constellation_id = $1 AND user_id = $2", [groupId, actorId])).rows[0];
  if (!member) throw new DomainError("Constellation not found.", 404);
  return group;
}

export async function updateConstellationSharedEffect(groupId: string, actorId: string, effect: string): Promise<ConstellationDetail> {
  if (!SHARED_EFFECTS.has(effect)) throw new DomainError("Unsupported background effect.", 422);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const group = await lockedConstellationMember(client, groupId, actorId);
    const shared = { ...sharedAssets(group.shared_assets), effect };
    await client.query("UPDATE constellations SET shared_assets = $2::jsonb, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW() WHERE id = $1", [groupId, JSON.stringify(shared)]);
    await audit(client, actorId, "constellation.shared_effect.updated", "constellation", groupId, { effect });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return constellationDetail(groupId, actorId);
}

export async function updateConstellationSharedAsset(groupId: string, actorId: string, kind: string, asset: Record<string, unknown> | null): Promise<ConstellationDetail> {
  if (!SHARED_ASSET_KINDS.has(kind)) throw new DomainError("Unsupported shared asset.", 422);
  let oldKey: string | null = null;
  if (asset) {
    const url = String(asset.url || "");
    const key = String(asset.key || "");
    if (!url.startsWith("https://") || !key.startsWith(`constellations/${groupId}/shared/${kind}/`)) throw new DomainError("Invalid shared asset.", 422);
  }
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const group = await lockedConstellationMember(client, groupId, actorId);
    const shared = sharedAssets(group.shared_assets);
    const previous = shared[kind];
    oldKey = previous && typeof previous === "object" && typeof (previous as Record<string, unknown>).key === "string" ? String((previous as Record<string, unknown>).key) : null;
    shared[kind] = asset ? {
      url: String(asset.url), key: String(asset.key), name: String(asset.name || "").slice(0, 100), contentType: String(asset.contentType || "").slice(0, 100),
      ...(kind === "audio" ? { title: String(asset.title || "").slice(0, 120) } : {}),
    } : null;
    await client.query("UPDATE constellations SET shared_assets = $2::jsonb, status = CASE WHEN status = 'suspended' THEN status ELSE 'draft' END, updated_at = NOW() WHERE id = $1", [groupId, JSON.stringify(shared)]);
    await audit(client, actorId, "constellation.shared_asset.updated", "constellation", groupId, { kind, removed: asset === null });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (oldKey && oldKey !== asset?.key) await deleteFromR2(oldKey);
  return constellationDetail(groupId, actorId);
}

export async function uploadConstellationSharedAsset(groupId: string, actorId: string, kind: string, bytes: Uint8Array, filename: string, contentType: string, title = ""): Promise<ConstellationDetail> {
  if (!SHARED_ASSET_KINDS.has(kind)) throw new DomainError("Unsupported shared asset.", 422);
  if (!r2Enabled()) throw new DomainError("R2 object storage is not configured.", 503);
  const clean = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 100) || kind;
  const key = `constellations/${groupId}/shared/${kind}/${randomUUID()}-${clean}`;
  try {
    const url = await uploadToR2(key, bytes, contentType);
    return await updateConstellationSharedAsset(groupId, actorId, kind, { url, key, name: clean, contentType, ...(kind === "audio" ? { title } : {}) });
  } catch (error) {
    await deleteFromR2(key);
    throw error;
  }
}

export async function deleteConstellation(groupId: string, actorId: string): Promise<{ deleted: true }> {
  const client = await database().connect();
  let keys: string[] = [];
  try {
    await client.query("BEGIN");
    const group = (await client.query<Record<string, unknown>>("SELECT * FROM constellations WHERE id = $1 FOR UPDATE", [groupId])).rows[0];
    if (!group) throw new DomainError("Constellation not found.", 404);
    if (String(group.owner_id) !== actorId) throw new DomainError("Only the Constellation owner can do that.", 403);
    const background = parseJson<Record<string, unknown>>(group.background, {});
    const shared = sharedAssets(group.shared_assets);
    keys = [background.key, ...Object.values(shared).map((asset) => asset && typeof asset === "object" ? (asset as Record<string, unknown>).key : null)]
      .filter((key): key is string => typeof key === "string" && key.startsWith(`constellations/${groupId}/`));
    await audit(client, actorId, "constellation.deleted", "constellation", groupId);
    await client.query("DELETE FROM constellations WHERE id = $1", [groupId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await Promise.all(keys.map((key) => deleteFromR2(key)));
  return { deleted: true };
}
export async function publicConstellation(slug: string): Promise<Record<string, unknown>> {
  const normSlug = normalizedSlug(slug);
  const db = database();
  const group = (await db.query<Record<string, unknown>>(`
    SELECT c.*, u.username AS owner_username
    FROM constellations c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.slug = $1 AND c.status = 'published'
  `, [normSlug])).rows[0];

  if (!group) throw new DomainError("Constellation not found.", 404);

  const memberRows = await fetchMemberRows(String(group.id));
  const now = new Date();
  const activeMembers = memberRows.filter((row) =>
    !row.suspended_at || (row.suspended_until && new Date(row.suspended_until as string | Date) <= now)
  );

  if (activeMembers.length !== Number(group.capacity)) {
    throw new DomainError("Constellation not found.", 404);
  }

  const members = activeMembers.map((row) => {
    const profile = parseJson<Record<string, unknown> | undefined>(row.profile_config, undefined);
    return {
      username: String(row.username || ""),
      displayName: String(row.display_name || row.username || "Misa user"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      role: String(row.role || "member"),
      slot: Number(row.slot),
      position: { x: Number(row.position_x), y: Number(row.position_y) },
      scale: Number(row.scale),
      frameOverride: String(row.frame_override || "inherit"),
      joinedAt: iso(row.joined_at),
      profile,
    };
  });

  const detail = serializeConstellation(group, members as any);
  const result: Record<string, unknown> = { ...detail };
  delete result.ownerId;
  delete result.invitations;
  delete result.availableSlots;
  return result;
}
