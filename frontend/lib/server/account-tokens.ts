import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { redis } from "./redis";
export type AccountToken = { user_id: string; email?: string };
export type TokenKind = "email_change" | "password_reset";
const key = (kind: TokenKind, token: string) => `${kind}:${createHash("sha256").update(token).digest("hex")}`;
async function client() { const db = redis(); if (db.status === "wait") await db.connect(); return db; }
export async function putAccountToken(kind: TokenKind, payload: AccountToken) {
  const token = randomBytes(32).toString("base64url");
  const db = await client();
  await db.set(key(kind, token), JSON.stringify(payload), "EX", kind === "email_change" ? 86400 : 1800);
  if (kind === "email_change" && payload.email) await db.set(`email_pending:${payload.user_id}`, payload.email, "EX", 86400);
  return token;
}
function parse(raw: string | null): AccountToken | null {
  try { const data = raw ? JSON.parse(raw) : null; return data && typeof data.user_id === "string" ? data : null; } catch { return null; }
}
export async function peekAccountToken(kind: TokenKind, token: string) { return parse(await (await client()).get(key(kind, token))); }
export async function popAccountToken(kind: TokenKind, token: string) {
  const db = await client();
  const data = parse(await db.getdel(key(kind, token)));
  if (kind === "email_change" && data) await db.del(`email_pending:${data.user_id}`);
  return data;
}
