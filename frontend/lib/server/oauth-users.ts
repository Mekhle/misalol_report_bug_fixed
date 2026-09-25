import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { database } from "./postgres";
import type { User } from "./users";
import type { OAuthProvider } from "./oauth-state";
export type ProviderIdentity = { provider: OAuthProvider; providerId: string; email: string | null; emailVerified: boolean; displayName: string | null; avatarUrl: string | null; telegramUsername?: string | null };
export class OAuthConflict extends Error {}
const columns = { google: "google_id", discord: "discord_id", telegram: "telegram_id", apple: "apple_id" } as const;
export async function upsertOAuthUser(identity: ProviderIdentity, currentId: string | null) {
  const column = columns[identity.provider];
  if (!column || !identity.providerId) throw new OAuthConflict("unknown_provider");
  const db = await database().connect();
  try {
    await db.query("BEGIN");
    // Serialize provider/email claims; unique indexes remain the final race protection.
    const locks = [`provider:${identity.provider}:${identity.providerId}`, ...(identity.email ? [`email:${identity.email.toLowerCase()}`] : [])].sort();
    for (const lock of locks) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
    const existing = (await db.query<User>(`SELECT * FROM users WHERE ${column}=$1 FOR UPDATE`, [identity.providerId])).rows[0];
    const emailOwner = identity.email ? (await db.query<User>("SELECT * FROM users WHERE lower(email)=lower($1)", [identity.email])).rows[0] : null;
    let id: string;
    if (currentId) {
      if (existing && existing.id !== currentId) throw new OAuthConflict("already_linked");
      if (emailOwner && emailOwner.id !== currentId) throw new OAuthConflict("email_taken");
      id = currentId;
      await db.query(`UPDATE users SET ${column}=$2, telegram_username=CASE WHEN $3='telegram' THEN COALESCE($4,telegram_username) ELSE telegram_username END,
        email=COALESCE(email,$5), email_verified=CASE WHEN email IS NULL THEN $6 WHEN email=$5 AND $6 THEN TRUE ELSE email_verified END,
        display_name=COALESCE(display_name,$7),avatar_url=COALESCE(avatar_url,$8),updated_at=NOW() WHERE id=$1`,
        [id, identity.providerId, identity.provider, identity.telegramUsername || null, identity.email, Boolean(identity.email && identity.emailVerified), identity.displayName, identity.avatarUrl]);
    } else if (existing) {
      id = existing.id;
      await db.query(`UPDATE users SET display_name=COALESCE(display_name,$2),avatar_url=COALESCE(avatar_url,$3),
        telegram_username=CASE WHEN $4='telegram' THEN COALESCE($5,telegram_username) ELSE telegram_username END,
        email_verified=CASE WHEN email=$6 AND $7 THEN TRUE ELSE email_verified END,updated_at=NOW() WHERE id=$1`,
        [id, identity.displayName, identity.avatarUrl, identity.provider, identity.telegramUsername || null, identity.email, identity.emailVerified]);
    } else {
      if (emailOwner) throw new OAuthConflict("account_exists");
      id = randomUUID();
      await db.query(`INSERT INTO users (id,account_id,email,email_verified,display_name,avatar_url,${column},telegram_username) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, String(randomInt(100000000000,1000000000000)), identity.email, Boolean(identity.email && identity.emailVerified), identity.displayName, identity.avatarUrl, identity.providerId, identity.provider === "telegram" ? identity.telegramUsername || null : null]);
    }
    const user = (await db.query<User>("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    if (!user) throw new OAuthConflict("not_authenticated");
    await db.query("COMMIT");
    return user;
  } catch (error) {
    await db.query("ROLLBACK");
    if ((error as {code?: string}).code === "23505") throw new OAuthConflict("already_linked");
    throw error;
  } finally { db.release(); }
}
