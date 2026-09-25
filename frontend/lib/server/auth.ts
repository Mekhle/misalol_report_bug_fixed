import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDatabase, toDatabaseUser, type DatabaseUser } from "./database";

export const SESSION_COOKIE = "misa_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

export function makePasswordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

export function passwordMatches(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(username: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  getDatabase().prepare("INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)").run(hashToken(token), username, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token: string) {
  getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getUserForSession(token: string | undefined): DatabaseUser | null {
  if (!token) return null;
  const db = getDatabase();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  const row = db.prepare(`SELECT users.username, users.display_name, users.email, users.uid FROM sessions JOIN users ON users.username = sessions.username WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(hashToken(token), Date.now()) as Record<string, unknown> | undefined;
  return row ? toDatabaseUser(row) : null;
}

export function getUserByUsername(username: string) {
  const row = getDatabase().prepare("SELECT username, display_name, email, uid FROM users WHERE username = ?").get(username) as Record<string, unknown> | undefined;
  return row ? toDatabaseUser(row) : null;
}

export function findUserForLogin(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return getDatabase().prepare("SELECT username, display_name, email, uid, password_hash, password_salt FROM users WHERE username = ? OR email = ?").get(normalized, normalized) as Record<string, unknown> | undefined;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
