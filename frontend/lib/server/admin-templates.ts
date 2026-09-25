import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AdminError, type AdminAccount } from "./admin-auth";
import { adminTransaction, adminUuid, audit } from "./admin-operations";
import { database, one } from "./postgres";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

function templateTags(value: unknown): string[] {
  let values: string[] = [];
  if (typeof value === "string") values = value.split(",");
  else if (Array.isArray(value)) values = value.map(String);
  const result: string[] = [];
  for (const item of values) {
    const tag = String(item || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().toLowerCase();
    if (tag && !result.includes(tag)) result.push(tag.slice(0, 24));
  }
  return result.slice(0, 8);
}

export function publicTemplateCard(row: Record<string, unknown>) {
  const preview = row.preview && typeof row.preview === "object" && !Array.isArray(row.preview) ? row.preview : {};
  return {
    id: String(row.id || ""),
    slug: String(row.slug || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    tags: templateTags(row.tags),
    previewImageUrl: row.preview_image_url ? String(row.preview_image_url) : null,
    preview,
    published: Boolean(row.published),
    visibility: String(row.visibility || "public"),
    is_favorite: Boolean(row.is_favorite),
    created_by: row.created_by ? String(row.created_by) : null,
    creator_username: row.creator_username ? String(row.creator_username) : null,
    created_at: row.created_at ? new Date(row.created_at as string | Date).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : null,
    favorite_count: Number(row.favorite_count || 0),
    week_favorite_count: Number(row.week_favorite_count || 0),
    month_favorite_count: Number(row.month_favorite_count || 0),
  };
}

export async function adminTemplatesRoute(request: NextRequest, path: string[], admin: AdminAccount) {
  if (path[0] !== "templates") return null;
  const method = request.method;

  if (path.length === 1 && method === "GET") {
    const rows = (await database().query<Record<string, unknown>>(`
      SELECT t.id, t.slug, t.name, t.description, t.preview, t.preview_image_url, t.published, t.visibility, t.tags, t.created_by,
             t.created_at, t.updated_at, u.username AS creator_username
      FROM profile_templates t
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.updated_at DESC
    `)).rows;
    return json({ templates: rows.map(publicTemplateCard) });
  }

  if (path.length === 2 && method === "PATCH") {
    const templateId = adminUuid(path[1]);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.published !== "boolean") throw new AdminError("Invalid request.", 422);

    const updated = await adminTransaction(async (db) => {
      const row = (await db.query<Record<string, unknown>>(`
        UPDATE profile_templates
        SET published = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, slug, name, description, preview, preview_image_url, published, visibility, tags, created_by, created_at, updated_at
      `, [templateId, body.published])).rows[0];
      if (!row) throw new AdminError("Template not found.", 404);

      const creator = (await db.query<{ username: string }>("SELECT username FROM users WHERE id = $1", [row.created_by])).rows[0];
      row.creator_username = creator?.username || null;

      await audit(db, admin.id, body.published ? "template.publish" : "template.unpublish", "template", templateId, { published: body.published });
      return row;
    });

    return json({ template: publicTemplateCard(updated) });
  }

  if (path.length === 2 && method === "DELETE") {
    const templateId = adminUuid(path[1]);
    await adminTransaction(async (db) => {
      const result = await db.query("DELETE FROM profile_templates WHERE id = $1", [templateId]);
      if (!result.rowCount) throw new AdminError("Template not found.", 404);
      await audit(db, admin.id, "template.delete", "template", templateId);
    });
    return json({ ok: true });
  }

  return null;
}
