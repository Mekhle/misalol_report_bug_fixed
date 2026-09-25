import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AdminError, type AdminAccount } from "./admin-auth";
import { adminTransaction, adminUuid, audit } from "./admin-operations";
import { database } from "./postgres";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function adminVerificationRoute(request: NextRequest, path: string[], admin: AdminAccount) {
  if (path[0] !== "verification") return null;
  const method = request.method;

  if (path.length === 1 && method === "GET") {
    const rawStatus = request.nextUrl.searchParams.get("status") || "";
    const status = ["pending", "approved", "rejected"].includes(rawStatus) ? rawStatus : null;
    let query = `
      SELECT v.id, v.user_id, v.reason, v.proof_url, v.status, v.review_note, v.created_at, v.reviewed_at,
             u.username, u.display_name
      FROM verification_requests v
      JOIN users u ON u.id = v.user_id
    `;
    const params: unknown[] = [];
    if (status) {
      query += " WHERE v.status = $1";
      params.push(status);
    }
    query += " ORDER BY v.created_at DESC LIMIT 100";

    try {
      const rows = (await database().query<Record<string, unknown>>(query, params)).rows;
      return json({ requests: rows });
    } catch (error) {
      if ((error as { code?: string }).code === "42P01") {
        return json({ requests: [] });
      }
      throw error;
    }
  }

  if (path.length === 2 && method === "PATCH") {
    const requestId = adminUuid(path[1]);
    const body = await request.json().catch(() => null);
    if (!body || !["approved", "rejected"].includes(body.status)) {
      throw new AdminError("Invalid request.", 422);
    }
    const note = typeof body.note === "string" ? body.note.trim().replace(/\s+/g, " ").slice(0, 400) : "";

    const updated = await adminTransaction(async (db) => {
      const row = (await db.query<Record<string, unknown>>(`
        UPDATE verification_requests
        SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
      `, [requestId, body.status, note, admin.id])).rows[0];
      if (!row) throw new AdminError("That request is not pending.", 404);

      await audit(db, admin.id, `verification.${body.status}`, "user", String(row.user_id), { request_id: requestId });
      return row;
    });

    return json({ ok: true, request: updated });
  }

  return null;
}
