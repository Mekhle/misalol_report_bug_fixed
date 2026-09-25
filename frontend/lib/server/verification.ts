import "server-only";
import { randomUUID } from "node:crypto";
import { database, one } from "./postgres";
import { withinLimit } from "./rate-limit";
import type { User } from "./users";

export type VerificationStatusResponse = {
  status: "verified" | "pending" | "approved" | "rejected" | "none";
  reason?: string;
  proofUrl?: string;
  reviewNote?: string;
  createdAt?: string | null;
};

export function cleanReason(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

export function validateProofUrl(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > 500) return null;
  try {
    const parsed = new URL(text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function userHasVerifiedBadge(userId: string): Promise<boolean> {
  try {
    const row = await one<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = 'verified' AND enabled = TRUE
        UNION
        SELECT 1 FROM badge_awards WHERE user_id = $1 AND badge_id = 'verified' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
      ) AS exists
    `, [userId]);
    return Boolean(row?.exists);
  } catch {
    return false;
  }
}

export async function getLatestVerificationRequest(userId: string) {
  try {
    return await one<{
      id: string;
      user_id: string;
      reason: string;
      proof_url: string;
      status: string;
      review_note: string;
      created_at: Date | string | null;
      reviewed_at: Date | string | null;
    }>(`
      SELECT id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
      FROM verification_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);
  } catch {
    return null;
  }
}

export function formatVerificationResponse(
  row: { status?: string; reason?: string; proof_url?: string; review_note?: string; created_at?: Date | string | null } | null,
  verified: boolean
): VerificationStatusResponse {
  if (verified) {
    return { status: "verified" };
  }
  if (!row) {
    return { status: "none" };
  }
  const createdAt = row.created_at
    ? row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString()
    : null;

  return {
    status: (row.status || "none") as VerificationStatusResponse["status"],
    reason: String(row.reason || ""),
    proofUrl: String(row.proof_url || ""),
    reviewNote: String(row.review_note || ""),
    createdAt,
  };
}

export async function myVerification(user: User): Promise<VerificationStatusResponse> {
  const verified = await userHasVerifiedBadge(user.id);
  const row = await getLatestVerificationRequest(user.id);
  return formatVerificationResponse(row, verified);
}

export async function applyVerification(
  user: User,
  rawReason: unknown,
  rawProofUrl: unknown
): Promise<VerificationStatusResponse> {
  const ok = await withinLimit(`rl:verify:${user.id}`, 3, 86400);
  if (!ok) {
    throw new Error("RATE_LIMIT");
  }

  if (await userHasVerifiedBadge(user.id)) {
    throw new Error("ALREADY_VERIFIED");
  }

  const existing = await getLatestVerificationRequest(user.id);
  if (existing && existing.status === "pending") {
    throw new Error("ALREADY_PENDING");
  }

  const reason = cleanReason(rawReason);
  if (reason.length < 12) {
    throw new Error("REASON_TOO_SHORT");
  }

  const proofUrl = validateProofUrl(rawProofUrl);
  if (proofUrl === null) {
    throw new Error("INVALID_PROOF_URL");
  }

  try {
    const inserted = (await database().query<{
      id: string;
      user_id: string;
      reason: string;
      proof_url: string;
      status: string;
      review_note: string;
      created_at: Date | string | null;
      reviewed_at: Date | string | null;
    }>(`
      INSERT INTO verification_requests (id, user_id, reason, proof_url, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
    `, [randomUUID(), user.id, reason, proofUrl])).rows[0];

    return formatVerificationResponse(inserted, false);
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      throw new Error("ALREADY_PENDING");
    }
    throw err;
  }
}
