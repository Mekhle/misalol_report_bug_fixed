import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import { database, one } from "./postgres";

export type User = {
  id: string;
  account_id: string | null;
  email: string | null;
  email_verified: boolean;
  password_hash: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  google_id: string | null;
  discord_id: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  apple_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
  is_admin: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  suspended_until: string | null;
};

const columns = "id, account_id, email, email_verified, password_hash, username, display_name, avatar_url, google_id, discord_id, telegram_id, telegram_username, apple_id, created_at, updated_at, last_login_at, is_admin, suspended_at, suspension_reason, suspended_until";

export async function userById(id: string) {
  return one<User>(`SELECT ${columns} FROM users WHERE id = $1`, [id]);
}

export async function userByEmail(email: string) {
  return one<User>(`SELECT ${columns} FROM users WHERE lower(email) = lower($1)`, [email]);
}

export async function userByUsername(username: string) {
  return one<User>(`SELECT ${columns} FROM users WHERE lower(username) = lower($1)`, [username]);
}

export async function createEmailUser(email: string, passwordHash: string, displayName: string) {
  const id = randomUUID();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const accountId = String(randomInt(100_000_000_000, 1_000_000_000_000));
    try {
      const result = await one<User>(`INSERT INTO users (id, account_id, email, email_verified, password_hash, display_name) VALUES ($1, $2, $3, FALSE, $4, $5) RETURNING ${columns}`, [id, accountId, email, passwordHash, displayName]);
      if (result) return result;
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 7) throw error;
    }
  }
  throw new Error("Could not allocate an account ID.");
}

export async function touchLogin(id: string) {
  await database().query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
}

export function isSuspended(user: User) {
  if (!user.suspended_at) return false;
  if (!user.suspended_until) return true;
  const expires = Date.parse(user.suspended_until);
  return Number.isNaN(expires) || expires > Date.now();
}

export function publicUser(user: User) {
  return {
    id: user.id,
    account_id: user.account_id,
    email: user.email,
    email_verified: user.email_verified,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    telegram_username: user.telegram_username,
    providers: {
      email: Boolean(user.password_hash),
      google: Boolean(user.google_id),
      discord: Boolean(user.discord_id),
      telegram: Boolean(user.telegram_id),
      apple: Boolean(user.apple_id),
    },
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    is_admin: user.is_admin || new Set((process.env.MISA_ADMIN_USER_IDS || "").split(",").map((id) => id.trim())).has(user.id),
    suspended_at: user.suspended_at,
    suspension_reason: user.suspension_reason,
    suspended_until: user.suspended_until,
  };
}
