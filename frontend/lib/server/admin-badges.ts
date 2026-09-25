import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { AdminError, type AdminAccount } from "./admin-auth";
import { adminTransaction, adminUuid, audit } from "./admin-operations";
import { database, one } from "./postgres";
import { r2Enabled, r2PublicUrl, uploadToR2 } from "./r2";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PURCHASE_STATES = new Set(["PENDING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED"]);
const REQUIREMENT_TYPES = new Set([
  "profile_views", "account_age", "link_clicks", "profile_completion",
  "music_activity", "manual", "purchase", "rank", "custom"
]);

export function badgeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseRequirements(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : [];
  const clean: Record<string, unknown>[] = [];
  for (const item of items.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const kind = String((item as Record<string, unknown>).type || "").trim().toLowerCase();
    if (!REQUIREMENT_TYPES.has(kind)) throw new AdminError(`Unsupported requirement type: ${kind || "empty"}`, 400);
    const operator = String((item as Record<string, unknown>).operator || "gte").toLowerCase();
    if (!["gte", "lte", "eq"].includes(operator)) throw new AdminError("Unsupported requirement operator.", 400);
    const row: Record<string, unknown> = { type: kind, operator };
    if (kind === "rank") {
      const rank = String((item as Record<string, unknown>).rank || (item as Record<string, unknown>).rankId || "").slice(0, 64);
      if (!rank) throw new AdminError("Rank requirements need a rank ID or slug.", 400);
      row.rank = rank;
    } else if (kind === "manual" || kind === "purchase") {
      // no extra fields
    } else if (kind === "custom") {
      row.key = String((item as Record<string, unknown>).key || "").slice(0, 80);
      row.value = (item as Record<string, unknown>).value;
    } else {
      const num = Number((item as Record<string, unknown>).value || 0);
      if (Number.isNaN(num)) throw new AdminError("Requirement values must be whole numbers.", 400);
      row.value = Math.max(0, Math.floor(num));
    }
    clean.push(row);
  }
  return clean;
}

function extractDefinitionValues(body: Record<string, unknown>) {
  const requirements = parseRequirements(body.requirements);
  const automatic = Boolean(body.automaticAward);
  const limited = Boolean(body.limited);
  const purchasable = Boolean(body.purchasable);
  const maxAwards = body.maxAwards != null ? Number(body.maxAwards) : null;
  const priceMinor = body.priceMinor != null ? Number(body.priceMinor) : null;

  if (automatic && requirements.length === 0) {
    throw new AdminError("Automatic awards need at least one requirement.", 400);
  }
  if (automatic && requirements.some((item) => ["manual", "purchase", "custom"].includes(String(item.type)))) {
    throw new AdminError("Manual, purchase, and custom requirements cannot be automatic.", 400);
  }
  if (limited && maxAwards === null) {
    throw new AdminError("Limited definitions need a maximum award count.", 400);
  }
  if (purchasable && priceMinor === null) {
    throw new AdminError("Purchasable definitions need a price.", 400);
  }

  const availableFrom = body.availableFrom ? new Date(body.availableFrom as string) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt as string) : null;
  if (availableFrom && Number.isNaN(availableFrom.getTime())) throw new AdminError("Invalid availableFrom date.", 422);
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new AdminError("Invalid expiresAt date.", 422);

  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    color: String(body.color || "#9b87f5"),
    requirements: JSON.stringify(requirements),
    automatic,
    manualAssignmentAllowed: body.manualAssignmentAllowed !== false,
    visibility: String(body.visibility || "PUBLIC").toUpperCase() === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    limited,
    maxAwards,
    availableFrom,
    expiresAt,
    purchasable,
    priceMinor,
    currency: String(body.currency || "USD").toUpperCase().slice(0, 3),
    active: body.active !== false,
    displayOrder: Number(body.displayOrder || 0),
  };
}

async function awardBadge(
  conn: PoolClient,
  userId: string,
  badgeId: string,
  source: string,
  actorId: string | null = null,
  reason = "",
  purchaseId: string | null = null,
  featured = false
): Promise<boolean> {
  const awardId = randomUUID();
  const result = await conn.query(`
    INSERT INTO badge_awards (id, badge_id, user_id, source, assigned_by, reason, purchase_id, featured, display_order)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE((SELECT max(display_order)+1 FROM badge_awards WHERE user_id=$3), 0))
    ON CONFLICT (user_id, badge_id) WHERE revoked_at IS NULL DO NOTHING
  `, [awardId, badgeId, userId, source, actorId, reason.slice(0, 500), purchaseId, featured]);

  const inserted = (result.rowCount ?? 0) > 0;
  if (inserted) {
    await conn.query(`
      INSERT INTO user_badges (user_id, badge_id, enabled, granted_by, granted_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, badge_id) DO UPDATE SET enabled=EXCLUDED.enabled, granted_by=EXCLUDED.granted_by, granted_at=NOW()
    `, [userId, badgeId, featured, actorId]);
  }
  return inserted;
}

async function awardRank(
  conn: PoolClient,
  userId: string,
  rankId: string,
  source: string,
  actorId: string | null = null,
  reason = "",
  purchaseId: string | null = null
): Promise<boolean> {
  const awardId = randomUUID();
  const result = await conn.query(`
    INSERT INTO rank_awards (id, rank_id, user_id, source, assigned_by, reason, purchase_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, rank_id) WHERE revoked_at IS NULL DO NOTHING
  `, [awardId, rankId, userId, source, actorId, reason.slice(0, 500), purchaseId]);

  if ((result.rowCount ?? 0) === 0) return false;

  const linked = (await conn.query<{ badge_id: string }>(
    "SELECT badge_id FROM rank_badges WHERE rank_id=$1 AND included=TRUE",
    [rankId]
  )).rows;

  for (const item of linked) {
    await awardBadge(conn, userId, item.badge_id, source, actorId, `Included with rank ${rankId}`, purchaseId);
  }
  return true;
}

export async function assignAchievement(
  actorId: string,
  userId: string,
  itemType: "BADGE" | "RANK",
  itemId: string,
  reason = "",
  source = "MANUAL"
): Promise<boolean> {
  return adminTransaction(async (db) => {
    let changed = false;
    if (itemType === "BADGE") {
      const badge = (await db.query<{ manual_assignment_allowed: boolean }>(
        "SELECT manual_assignment_allowed FROM badges WHERE id=$1",
        [itemId]
      )).rows[0];
      if (!badge) throw new AdminError("Badge not found.", 404);
      if (source === "MANUAL" && !badge.manual_assignment_allowed) {
        throw new AdminError("Manual assignment is disabled for that definition.", 403);
      }
      changed = await awardBadge(db, userId, itemId, source, actorId, reason);
    } else {
      const rank = (await db.query<{ manual_assignment_allowed: boolean }>(
        "SELECT manual_assignment_allowed FROM ranks WHERE id=$1",
        [itemId]
      )).rows[0];
      if (!rank) throw new AdminError("Rank not found.", 404);
      if (source === "MANUAL" && !rank.manual_assignment_allowed) {
        throw new AdminError("Manual assignment is disabled for that definition.", 403);
      }
      changed = await awardRank(db, userId, itemId, source, actorId, reason);
    }
    await audit(db, actorId, `${itemType.toLowerCase()}.assign`, "user", userId, {
      item_id: itemId,
      source,
      reason: reason.slice(0, 500),
      changed,
    });
    return changed;
  });
}

export async function revokeAchievement(
  actorId: string,
  userId: string,
  itemType: "BADGE" | "RANK",
  itemId: string,
  reason = ""
): Promise<boolean> {
  const table = itemType === "BADGE" ? "badge_awards" : "rank_awards";
  const column = itemType === "BADGE" ? "badge_id" : "rank_id";
  return adminTransaction(async (db) => {
    const result = await db.query(
      `UPDATE ${table} SET revoked_at=NOW(), revoked_by=$3, revoke_reason=$4 WHERE user_id=$1 AND ${column}=$2 AND revoked_at IS NULL`,
      [userId, itemId, actorId, reason.slice(0, 500)]
    );
    const changed = (result.rowCount ?? 0) > 0;
    if (itemType === "BADGE" && changed) {
      await db.query("UPDATE user_badges SET enabled=FALSE WHERE user_id=$1 AND badge_id=$2", [userId, itemId]);
    }
    await audit(db, actorId, `${itemType.toLowerCase()}.revoke`, "user", userId, {
      item_id: itemId,
      reason: reason.slice(0, 500),
      changed,
    });
    return changed;
  });
}

export async function listBadgesAdmin(search = ""): Promise<Record<string, unknown>[]> {
  const rows = (await database().query<Record<string, unknown>>(`
    SELECT b.*, c.name AS category_name,
           COALESCE((SELECT count(*) FROM badge_awards a WHERE a.badge_id=b.id AND a.revoked_at IS NULL), 0) AS owners,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug))
                     FROM rank_badges rb JOIN ranks r ON r.id=rb.rank_id WHERE rb.badge_id=b.id), '[]'::jsonb) AS ranks
    FROM badges b
    LEFT JOIN badge_categories c ON c.id=b.category_id
    WHERE ($1='' OR b.name ILIKE '%'||$1||'%' OR b.slug ILIKE '%'||$1||'%')
    ORDER BY b.display_order, b.name
  `, [search.trim()])).rows;
  return rows;
}

export async function adminBadgesRoute(request: NextRequest, path: string[], admin: AdminAccount) {
  const method = request.method;

  // 1. Compatibility Badge Routes
  if (path[0] === "badges") {
    if (path.length === 1 && method === "GET") {
      return json({ badges: await listBadgesAdmin() });
    }
    if (path.length === 1 && method === "POST") {
      throw new AdminError("Use the Badge + Rank platform so assets are validated and stored in R2.", 410);
    }
    if (path.length === 2 && method === "DELETE") {
      const badgeId = path[1];
      const action = await adminTransaction(async (db) => {
        const owners = Number((await db.query<{ count: string }>(
          "SELECT count(*) FROM badge_awards WHERE badge_id=$1",
          [badgeId]
        )).rows[0]?.count || 0);

        let act: string;
        if (owners > 0) {
          const res = await db.query("UPDATE badges SET active=FALSE, updated_at=NOW() WHERE id=$1", [badgeId]);
          if (!res.rowCount) throw new AdminError("Badge not found.", 404);
          act = "disabled";
        } else {
          const res = await db.query("DELETE FROM badges WHERE id=$1", [badgeId]);
          if (!res.rowCount) throw new AdminError("Badge not found.", 404);
          act = "deleted";
        }
        await audit(db, admin.id, `badge.${act}`, "badge", badgeId);
        return act;
      });
      return json({ ok: true, action });
    }
    if (path.length === 3 && path[2] === "grants" && method === "PUT") {
      const badgeId = path[1];
      const body = await request.json().catch(() => null);
      const target = String(body?.user || body?.username || "").trim();
      if (target.length < 3) throw new AdminError("Enter a user ID or username.", 400);

      const user = await one<{ id: string }>(
        "SELECT id FROM users WHERE lower(username)=$1 OR id::text=$1 OR account_id=$1",
        [target.replace(/^@+/, "").toLowerCase()]
      );
      if (!user) throw new AdminError("User not found.", 404);

      const granted = body?.granted !== false;
      const changed = granted
        ? await assignAchievement(admin.id, user.id, "BADGE", badgeId, "Assigned through legacy admin route")
        : await revokeAchievement(admin.id, user.id, "BADGE", badgeId, "Removed through legacy admin route");

      return json({ ok: true, user: user.id, granted, changed });
    }
  }

  if (path.length === 4 && path[0] === "users" && path[2] === "badges" && method === "PUT") {
    const userId = adminUuid(path[1]);
    const badgeId = path[3];
    const changed = await assignAchievement(admin.id, userId, "BADGE", badgeId, "Assigned through legacy admin route");
    return json({ ok: true, changed });
  }

  // 2. Badge Platform Routes
  if (path[0] !== "badge-platform") return null;

  // Categories
  if (path[1] === "categories") {
    if (path.length === 2 && method === "GET") {
      const rows = (await database().query<Record<string, unknown>>(`
        SELECT c.*, (SELECT count(*) FROM badges b WHERE b.category_id=c.id) AS badge_count
        FROM badge_categories c
        ORDER BY display_order, name
      `)).rows;
      return json({ categories: rows });
    }
    if (path.length === 2 && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.name) throw new AdminError("Name is required.", 422);
      const catId = randomUUID();
      const slug = badgeSlug(String(body.slug || body.name));
      try {
        const item = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO badge_categories (id, slug, name, description, display_order, active, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
          `, [
            catId,
            slug,
            String(body.name).trim(),
            String(body.description || "").trim(),
            Number(body.displayOrder || 0),
            body.active !== false,
            admin.id,
          ])).rows[0];
          await audit(db, admin.id, "badge_category.save", "badge_category", catId, { slug });
          return row;
        });
        return json({ category: item }, 201);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That category slug already exists.", 409);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "PUT") {
      const catId = adminUuid(path[2]);
      const body = await request.json().catch(() => null);
      if (!body?.name) throw new AdminError("Name is required.", 422);
      const slug = badgeSlug(String(body.slug || body.name));
      try {
        const item = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO badge_categories (id, slug, name, description, display_order, active, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
              slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
              display_order=EXCLUDED.display_order, active=EXCLUDED.active, updated_at=NOW()
            RETURNING *
          `, [
            catId,
            slug,
            String(body.name).trim(),
            String(body.description || "").trim(),
            Number(body.displayOrder || 0),
            body.active !== false,
            admin.id,
          ])).rows[0];
          await audit(db, admin.id, "badge_category.save", "badge_category", catId, { slug });
          return row;
        });
        return json({ category: item });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That category slug already exists.", 409);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "DELETE") {
      const catId = adminUuid(path[2]);
      await adminTransaction(async (db) => {
        await db.query("UPDATE badges SET category_id=NULL WHERE category_id=$1", [catId]);
        const result = await db.query("DELETE FROM badge_categories WHERE id=$1", [catId]);
        if (!result.rowCount) throw new AdminError("Category not found.", 404);
        await audit(db, admin.id, "badge_category.delete", "badge_category", catId);
      });
      return json({ ok: true });
    }
  }

  // Badges
  if (path[1] === "badges") {
    if (path.length === 2 && method === "GET") {
      const search = request.nextUrl.searchParams.get("search") || "";
      return json({ badges: await listBadgesAdmin(search) });
    }
    if (path.length === 2 && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) throw new AdminError("Invalid request.", 422);
      if (!HEX_COLOR.test(String(body.color || "#9b87f5"))) {
        throw new AdminError("Pick a valid badge color.", 400);
      }
      const slug = badgeSlug(String(body.slug || body.name || ""));
      if (!slug) throw new AdminError("Invalid badge slug.", 422);
      const vals = extractDefinitionValues(body);
      const categoryId = body.categoryId ? adminUuid(String(body.categoryId)) : null;
      const rarity = String(body.rarity || "COMMON").toUpperCase().slice(0, 32);

      try {
        const badge = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO badges (
              id, slug, name, description, color, requirements, automatic_award,
              manual_assignment_allowed, visibility, limited, max_awards, available_from,
              expires_at, purchasable, price_minor, currency, active, display_order,
              category_id, rarity
            ) VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20
            ) RETURNING *
          `, [
            slug, slug, vals.name, vals.description, vals.color, vals.requirements,
            vals.automatic, vals.manualAssignmentAllowed, vals.visibility, vals.limited,
            vals.maxAwards, vals.availableFrom, vals.expiresAt, vals.purchasable,
            vals.priceMinor, vals.currency, vals.active, vals.displayOrder, categoryId, rarity
          ])).rows[0];
          await audit(db, admin.id, "badge.save", "badge", slug, { slug });
          return row;
        });
        return json({ badge }, 201);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That badge slug already exists.", 409);
        }
        if ((error as { code?: string }).code === "23503") {
          throw new AdminError("Category not found.", 400);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "PUT") {
      const badgeId = path[2];
      const body = await request.json().catch(() => null);
      if (!body) throw new AdminError("Invalid request.", 422);
      if (!HEX_COLOR.test(String(body.color || "#9b87f5"))) {
        throw new AdminError("Pick a valid badge color.", 400);
      }
      const slug = badgeSlug(String(body.slug || body.name || badgeId));
      const vals = extractDefinitionValues(body);
      const categoryId = body.categoryId ? adminUuid(String(body.categoryId)) : null;
      const rarity = String(body.rarity || "COMMON").toUpperCase().slice(0, 32);

      try {
        const badge = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO badges (
              id, slug, name, description, color, requirements, automatic_award,
              manual_assignment_allowed, visibility, limited, max_awards, available_from,
              expires_at, purchasable, price_minor, currency, active, display_order,
              category_id, rarity
            ) VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20
            ) ON CONFLICT (id) DO UPDATE SET
              slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
              color=EXCLUDED.color, requirements=EXCLUDED.requirements,
              automatic_award=EXCLUDED.automatic_award,
              manual_assignment_allowed=EXCLUDED.manual_assignment_allowed,
              visibility=EXCLUDED.visibility, limited=EXCLUDED.limited,
              max_awards=EXCLUDED.max_awards, available_from=EXCLUDED.available_from,
              expires_at=EXCLUDED.expires_at, purchasable=EXCLUDED.purchasable,
              price_minor=EXCLUDED.price_minor, currency=EXCLUDED.currency,
              active=EXCLUDED.active, display_order=EXCLUDED.display_order,
              category_id=EXCLUDED.category_id, rarity=EXCLUDED.rarity, updated_at=NOW()
            RETURNING *
          `, [
            badgeId, slug, vals.name, vals.description, vals.color, vals.requirements,
            vals.automatic, vals.manualAssignmentAllowed, vals.visibility, vals.limited,
            vals.maxAwards, vals.availableFrom, vals.expiresAt, vals.purchasable,
            vals.priceMinor, vals.currency, vals.active, vals.displayOrder, categoryId, rarity
          ])).rows[0];
          await audit(db, admin.id, "badge.save", "badge", badgeId, { slug });
          return row;
        });
        return json({ badge });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That badge slug already exists.", 409);
        }
        if ((error as { code?: string }).code === "23503") {
          throw new AdminError("Category not found.", 400);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "DELETE") {
      const badgeId = path[2];
      const action = await adminTransaction(async (db) => {
        const owners = Number((await db.query<{ count: string }>(
          "SELECT count(*) FROM badge_awards WHERE badge_id=$1",
          [badgeId]
        )).rows[0]?.count || 0);

        let act: string;
        if (owners > 0) {
          const res = await db.query("UPDATE badges SET active=FALSE, updated_at=NOW() WHERE id=$1", [badgeId]);
          if (!res.rowCount) throw new AdminError("Badge not found.", 404);
          act = "disabled";
        } else {
          const res = await db.query("DELETE FROM badges WHERE id=$1", [badgeId]);
          if (!res.rowCount) throw new AdminError("Badge not found.", 404);
          act = "deleted";
        }
        await audit(db, admin.id, `badge.${act}`, "badge", badgeId);
        return act;
      });
      return json({ ok: true, action });
    }
    if (path.length === 4 && path[3] === "asset" && method === "POST") {
      const badgeId = path[2];
      const badgeExists = await one("SELECT 1 FROM badges WHERE id=$1", [badgeId]);
      if (!badgeExists) throw new AdminError("Badge not found.", 404);

      if (!r2Enabled()) throw new AdminError("R2 object storage is not configured.", 503);

      const formData = await request.formData().catch(() => null);
      const file = formData?.get("file");
      if (!(file instanceof Blob)) throw new AdminError("Upload a PNG, JPG, WebP, or GIF badge.", 400);

      const mime = (file.type || "").toLowerCase();
      const allowedMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
      if (!allowedMimes.has(mime)) {
        throw new AdminError("Upload a PNG, JPG, WebP, or GIF badge.", 400);
      }

      const bodyBuffer = Buffer.from(await file.arrayBuffer());
      if (!bodyBuffer.length || bodyBuffer.length > 2_000_000) {
        throw new AdminError("Badge assets must be smaller than 2 MB.", 413);
      }

      let metadata;
      let previewBuffer: Buffer;
      try {
        const image = sharp(bodyBuffer, { animated: true });
        metadata = await image.metadata();

        const formatMimes: Record<string, string> = {
          png: "image/png",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        };
        const detectedMime = metadata.format ? formatMimes[metadata.format] : null;
        if (!detectedMime || detectedMime !== mime) {
          throw new AdminError("The file content does not match its image type.", 400);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        if (width > 2048 || height > 2048) {
          throw new AdminError("Badge dimensions cannot exceed 2048px.", 400);
        }

        previewBuffer = await sharp(bodyBuffer)
          .resize(512, 512, { fit: "inside" })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (error) {
        if (error instanceof AdminError) throw error;
        throw new AdminError("That badge image is invalid.", 400);
      }

      const animated = Boolean(metadata.pages && metadata.pages > 1);
      const fileName = file instanceof File ? file.name : "badge";
      const rawStem = fileName.replace(/\.[^/.]+$/, "");
      const safeStem = rawStem.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "badge";
      const extMap: Record<string, string> = { png: ".png", jpeg: ".jpg", webp: ".webp", gif: ".gif" };
      const extension = extMap[metadata.format!] || ".png";
      const token = randomUUID().replace(/-/g, "");

      const assetKey = `badges/${badgeId}/${token}-${safeStem}${extension}`;
      const previewKey = `badges/${badgeId}/${token}-preview.png`;

      try {
        await uploadToR2(assetKey, bodyBuffer, mime);
        await uploadToR2(previewKey, previewBuffer, "image/png");
      } catch {
        throw new AdminError("Could not store that badge asset in R2.", 502);
      }

      const assetUrl = r2PublicUrl(assetKey);
      const previewUrl = r2PublicUrl(previewKey);

      const updated = await adminTransaction(async (db) => {
        const row = (await db.query<Record<string, unknown>>(`
          UPDATE badges
          SET asset_url=$2, preview_url=$3, asset_key=$4, preview_key=$5, asset_mime=$6, animated=$7, updated_at=NOW()
          WHERE id=$1 RETURNING *
        `, [badgeId, assetUrl, previewUrl, assetKey, previewKey, mime, animated])).rows[0];
        if (!row) throw new AdminError("Badge not found.", 404);
        await audit(db, admin.id, "badge.asset.upload", "badge", badgeId, { animated, mime });
        return row;
      });

      return json({ badge: updated });
    }
  }

  // Ranks
  if (path[1] === "ranks") {
    if (path.length === 2 && method === "GET") {
      const search = request.nextUrl.searchParams.get("search") || "";
      const rows = (await database().query<Record<string, unknown>>(`
        SELECT r.*,
               COALESCE((SELECT count(*) FROM rank_awards a WHERE a.rank_id=r.id AND a.revoked_at IS NULL), 0) AS owners,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug))
                         FROM rank_badges rb JOIN badges b ON b.id=rb.badge_id WHERE rb.rank_id=r.id AND rb.included=TRUE), '[]'::jsonb) AS badges
        FROM ranks r
        WHERE ($1='' OR r.name ILIKE '%'||$1||'%' OR r.slug ILIKE '%'||$1||'%')
        ORDER BY r.level, r.display_order, r.name
      `, [search.trim()])).rows;
      return json({ ranks: rows });
    }
    if (path.length === 2 && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) throw new AdminError("Invalid request.", 422);
      const rankId = randomUUID();
      const slug = badgeSlug(String(body.slug || body.name || ""));
      if (!slug) throw new AdminError("Invalid rank slug.", 422);
      const vals = extractDefinitionValues(body);
      const level = Math.max(0, Number(body.level || 0));
      const badgeIds = Array.isArray(body.badgeIds) ? Array.from(new Set(body.badgeIds.map(String))) : [];

      try {
        const rank = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO ranks (
              id, slug, name, description, color, requirements, automatic_award,
              manual_assignment_allowed, visibility, limited, max_awards, available_from,
              expires_at, purchasable, price_minor, currency, active, display_order,
              level, created_by
            ) VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20
            ) RETURNING *
          `, [
            rankId, slug, vals.name, vals.description, vals.color, vals.requirements,
            vals.automatic, vals.manualAssignmentAllowed, vals.visibility, vals.limited,
            vals.maxAwards, vals.availableFrom, vals.expiresAt, vals.purchasable,
            vals.priceMinor, vals.currency, vals.active, vals.displayOrder, level, admin.id
          ])).rows[0];

          for (const bid of badgeIds) {
            await db.query("INSERT INTO rank_badges (rank_id, badge_id, included) VALUES ($1, $2, TRUE)", [rankId, bid]);
          }
          await audit(db, admin.id, "rank.save", "rank", rankId, { slug, badges: badgeIds });
          return row;
        });
        return json({ rank }, 201);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That rank slug already exists.", 409);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "PUT") {
      const rankId = adminUuid(path[2]);
      const body = await request.json().catch(() => null);
      if (!body) throw new AdminError("Invalid request.", 422);
      const slug = badgeSlug(String(body.slug || body.name || ""));
      const vals = extractDefinitionValues(body);
      const level = Math.max(0, Number(body.level || 0));
      const badgeIds = Array.isArray(body.badgeIds) ? Array.from(new Set(body.badgeIds.map(String))) : [];

      try {
        const rank = await adminTransaction(async (db) => {
          const row = (await db.query<Record<string, unknown>>(`
            INSERT INTO ranks (
              id, slug, name, description, color, requirements, automatic_award,
              manual_assignment_allowed, visibility, limited, max_awards, available_from,
              expires_at, purchasable, price_minor, currency, active, display_order,
              level, created_by
            ) VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20
            ) ON CONFLICT (id) DO UPDATE SET
              slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
              color=EXCLUDED.color, requirements=EXCLUDED.requirements,
              automatic_award=EXCLUDED.automatic_award,
              manual_assignment_allowed=EXCLUDED.manual_assignment_allowed,
              visibility=EXCLUDED.visibility, limited=EXCLUDED.limited,
              max_awards=EXCLUDED.max_awards, available_from=EXCLUDED.available_from,
              expires_at=EXCLUDED.expires_at, purchasable=EXCLUDED.purchasable,
              price_minor=EXCLUDED.price_minor, currency=EXCLUDED.currency,
              active=EXCLUDED.active, display_order=EXCLUDED.display_order,
              level=EXCLUDED.level, updated_at=NOW()
            RETURNING *
          `, [
            rankId, slug, vals.name, vals.description, vals.color, vals.requirements,
            vals.automatic, vals.manualAssignmentAllowed, vals.visibility, vals.limited,
            vals.maxAwards, vals.availableFrom, vals.expiresAt, vals.purchasable,
            vals.priceMinor, vals.currency, vals.active, vals.displayOrder, level, admin.id
          ])).rows[0];

          await db.query("DELETE FROM rank_badges WHERE rank_id=$1", [rankId]);
          for (const bid of badgeIds) {
            await db.query("INSERT INTO rank_badges (rank_id, badge_id, included) VALUES ($1, $2, TRUE)", [rankId, bid]);
          }
          await audit(db, admin.id, "rank.save", "rank", rankId, { slug, badges: badgeIds });
          return row;
        });
        return json({ rank });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AdminError("That rank slug already exists.", 409);
        }
        throw error;
      }
    }
    if (path.length === 3 && method === "DELETE") {
      const rankId = adminUuid(path[2]);
      const action = await adminTransaction(async (db) => {
        const owners = Number((await db.query<{ count: string }>(
          "SELECT count(*) FROM rank_awards WHERE rank_id=$1",
          [rankId]
        )).rows[0]?.count || 0);

        let act: string;
        if (owners > 0) {
          const res = await db.query("UPDATE ranks SET active=FALSE, updated_at=NOW() WHERE id=$1", [rankId]);
          if (!res.rowCount) throw new AdminError("Rank not found.", 404);
          act = "disabled";
        } else {
          const res = await db.query("DELETE FROM ranks WHERE id=$1", [rankId]);
          if (!res.rowCount) throw new AdminError("Rank not found.", 404);
          act = "deleted";
        }
        await audit(db, admin.id, `rank.${act}`, "rank", rankId);
        return act;
      });
      return json({ ok: true, action });
    }
  }

  // Assignments
  if (path[1] === "assignments") {
    if (path.length === 2 && method === "GET") {
      const search = (request.nextUrl.searchParams.get("search") || "").trim();
      const itemType = (request.nextUrl.searchParams.get("item_type") || "").toUpperCase();
      const activeOnly = request.nextUrl.searchParams.get("active_only") === "true";
      const activeClause = activeOnly ? "AND a.revoked_at IS NULL" : "";

      const rows: Record<string, unknown>[] = [];
      if (!itemType || itemType === "BADGE") {
        const badges = (await database().query<Record<string, unknown>>(`
          SELECT 'BADGE' AS item_type, a.id, a.user_id, u.username, u.email,
                 a.badge_id AS item_id, b.name AS item_name, a.source, a.earned_at,
                 a.assigned_by, a.reason, a.purchase_id, a.revoked_at, a.revoke_reason
          FROM badge_awards a
          JOIN users u ON u.id=a.user_id
          JOIN badges b ON b.id=a.badge_id
          WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%')
          ${activeClause}
          ORDER BY a.earned_at DESC LIMIT 300
        `, [search])).rows;
        rows.push(...badges);
      }
      if (!itemType || itemType === "RANK") {
        const ranks = (await database().query<Record<string, unknown>>(`
          SELECT 'RANK' AS item_type, a.id, a.user_id, u.username, u.email,
                 a.rank_id::text AS item_id, r.name AS item_name, a.source, a.earned_at,
                 a.assigned_by, a.reason, a.purchase_id, a.revoked_at, a.revoke_reason
          FROM rank_awards a
          JOIN users u ON u.id=a.user_id
          JOIN ranks r ON r.id=a.rank_id
          WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%')
          ${activeClause}
          ORDER BY a.earned_at DESC LIMIT 300
        `, [search])).rows;
        rows.push(...ranks);
      }

      rows.sort((a, b) => new Date(b.earned_at as string).getTime() - new Date(a.earned_at as string).getTime());
      return json({ assignments: rows.slice(0, 300) });
    }
    if (path.length === 2 && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !body.user || !body.itemId) throw new AdminError("Invalid assignment request.", 400);

      const itemType = String(body.itemType || "").toUpperCase();
      if (itemType !== "BADGE" && itemType !== "RANK") throw new AdminError("Invalid assignment request.", 400);

      const action = String(body.action || "").toUpperCase();
      if (action !== "ASSIGN" && action !== "REMOVE") throw new AdminError("Invalid assignment request.", 400);

      const user = await one<{ id: string }>(
        "SELECT id FROM users WHERE lower(username)=$1 OR id::text=$1 OR account_id=$1",
        [String(body.user).trim().replace(/^@+/, "").toLowerCase()]
      );
      if (!user) throw new AdminError("User not found.", 404);

      const itemId = itemType === "RANK" ? adminUuid(String(body.itemId)) : String(body.itemId);
      const reason = String(body.reason || "");

      const changed = action === "ASSIGN"
        ? await assignAchievement(admin.id, user.id, itemType, itemId, reason)
        : await revokeAchievement(admin.id, user.id, itemType, itemId, reason);

      return json({ ok: true, changed, userId: user.id });
    }
  }

  // Owners: /admin/badge-platform/{item_type}/{item_id}/owners
  if (path.length === 4 && path[3] === "owners") {
    const itemType = path[1].toUpperCase();
    if (itemType !== "BADGE" && itemType !== "RANK") throw new AdminError("Invalid item type.", 400);
    const itemId = itemType === "RANK" ? adminUuid(path[2]) : path[2];

    if (itemType === "BADGE") {
      const rows = (await database().query<Record<string, unknown>>(`
        SELECT a.*, u.username, u.email
        FROM badge_awards a
        JOIN users u ON u.id=a.user_id
        WHERE a.badge_id=$1
        ORDER BY a.earned_at DESC
      `, [itemId])).rows;
      return json({ owners: rows });
    } else {
      const rows = (await database().query<Record<string, unknown>>(`
        SELECT a.*, u.username, u.email
        FROM rank_awards a
        JOIN users u ON u.id=a.user_id
        WHERE a.rank_id=$1
        ORDER BY a.earned_at DESC
      `, [itemId])).rows;
      return json({ owners: rows });
    }
  }

  // Purchases
  if (path[1] === "purchases") {
    if (path.length === 2 && method === "GET") {
      const search = (request.nextUrl.searchParams.get("search") || "").trim();
      const status = (request.nextUrl.searchParams.get("purchase_status") || "").toUpperCase();
      if (status && !PURCHASE_STATES.has(status)) throw new AdminError("Invalid purchase status.", 400);

      const rows = (await database().query<Record<string, unknown>>(`
        SELECT p.*, u.username, u.email, b.name AS badge_name, r.name AS rank_name
        FROM purchase_records p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN badges b ON b.id=p.badge_id
        LEFT JOIN ranks r ON r.id=p.rank_id
        WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%')
          AND ($2='' OR p.status=$2)
        ORDER BY p.created_at DESC LIMIT 300
      `, [search, status])).rows;
      return json({ purchases: rows });
    }
    if (path.length === 3 && method === "PATCH") {
      const purchaseId = adminUuid(path[2]);
      const body = await request.json().catch(() => null);
      if (!body) throw new AdminError("Invalid request.", 422);

      const targetStatus = String(body.status || "").toUpperCase();
      if (!PURCHASE_STATES.has(targetStatus)) throw new AdminError("Invalid request.", 422);

      if (targetStatus === "COMPLETED") {
        throw new AdminError("Only a verified payment provider callback can complete a purchase.", 403);
      }

      const providerRef = String(body.providerReference || "").slice(0, 255);

      const purchase = await adminTransaction(async (db) => {
        const row = (await db.query<Record<string, unknown>>(
          "SELECT * FROM purchase_records WHERE id=$1 FOR UPDATE",
          [purchaseId]
        )).rows[0];
        if (!row) throw new AdminError("Purchase not found.", 404);

        const currentStatus = String(row.status);
        const allowedTransitions: Record<string, Set<string>> = {
          PENDING: new Set(["COMPLETED", "FAILED", "CANCELLED"]),
          COMPLETED: new Set(["REFUNDED"]),
          FAILED: new Set(),
          REFUNDED: new Set(),
          CANCELLED: new Set(),
        };

        if (targetStatus !== currentStatus && !allowedTransitions[currentStatus]?.has(targetStatus)) {
          throw new AdminError("That purchase status transition is not allowed.", 409);
        }

        const updated = (await db.query<Record<string, unknown>>(`
          UPDATE purchase_records
          SET status=$2,
              provider_reference=CASE WHEN $3='' THEN provider_reference ELSE $3 END,
              updated_at=NOW()
          WHERE id=$1 RETURNING *
        `, [purchaseId, targetStatus, providerRef])).rows[0];

        await audit(db, admin.id, "purchase.transition", "purchase", purchaseId, {
          from: currentStatus,
          to: targetStatus,
        });
        return updated;
      });

      return json({ purchase });
    }
  }

  return null;
}
