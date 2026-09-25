import "server-only";
import { database } from "./postgres";
const reserved = new Set("about account admin analytics api auth badges css customize dashboard discord explore forgot-password google help host icons images index js links login logout me misa plus premium pricing privacy reset-password root settings signup static status support telegram templates terms www".split(" "));
export class UsernameError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function validateUsername(raw: string) {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(value)) throw new UsernameError("Username must be 3-24 characters, start with a letter, and use only letters, numbers, or underscores.", 400);
  if (reserved.has(value)) throw new UsernameError("That username is reserved.", 400);
  return value;
}
export function hitsBannedWord(username: string, words: string[]) {
  return words.some(raw => { const word = raw.trim().toLowerCase(); return Boolean(word && (username === word || (word.length >= 4 && username.includes(word)))); });
}
export async function changeUsername(userId: string, username: string) {
  const db = await database().connect();
  try {
    await db.query("BEGIN");
    const current = (await db.query<{username: string | null}>("SELECT username FROM users WHERE id=$1 FOR UPDATE", [userId])).rows[0];
    if (!current) throw new UsernameError("Not authenticated.", 401);
    const old = current.username?.trim().toLowerCase() || null;
    if (old === username) { await db.query("COMMIT"); return false; }
    if ((await db.query("SELECT 1 FROM users WHERE lower(username)=$1 AND id<>$2", [username, userId])).rowCount) throw new UsernameError("That username is taken.", 409);
    const words = await db.query<{word: string}>("SELECT word FROM banned_username_words");
    if (hitsBannedWord(username, words.rows.map(row => row.word))) throw new UsernameError("That username is not allowed.", 409);
    const blocked = (await db.query("SELECT 1 FROM reserved_usernames WHERE username=$1", [username])).rowCount;
    const former = (await db.query<{user_id: string}>("SELECT user_id FROM username_history WHERE lower(old_username)=$1 ORDER BY created_at DESC LIMIT 1", [username])).rows[0];
    if ((blocked || former) && former?.user_id !== userId) throw new UsernameError("That username is reserved.", 409);
    await db.query("UPDATE users SET username=$2,updated_at=NOW() WHERE id=$1", [userId, username]);
    if (old) {
      await db.query("INSERT INTO username_history (user_id,old_username,new_username,changed_by,reason) VALUES ($1,$2,$3,$1,'User rename')", [userId, old, username]);
      await db.query("INSERT INTO reserved_usernames (username,reason,created_by) VALUES ($1,'Former username',$2) ON CONFLICT(username) DO UPDATE SET reason='Former username',created_by=EXCLUDED.created_by", [old, userId]);
    }
    if (former?.user_id === userId) await db.query("DELETE FROM reserved_usernames WHERE username=$1 AND reason='Former username'", [username]);
    await db.query(`UPDATE profiles SET config=CASE
      WHEN config ? 'profile' THEN jsonb_set(config,ARRAY['profile','username']::text[],to_jsonb($2::text),true)
      WHEN config #> '{config,profile}' IS NOT NULL THEN jsonb_set(config,ARRAY['config','profile','username']::text[],to_jsonb($2::text),true)
      ELSE config END,updated_at=NOW() WHERE user_id=$1`, [userId, username]);
    await db.query("INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,metadata) VALUES ($1,'user.rename','user',$2,$3::jsonb)", [userId, userId, JSON.stringify({ from: old, to: username })]);
    await db.query("COMMIT");
    return Boolean(old);
  } catch (error) {
    await db.query("ROLLBACK");
    if ((error as {code?: string}).code === "23505") throw new UsernameError("That username is taken.", 409);
    throw error;
  } finally { db.release(); }
}

export async function currentHandleFor(username: string): Promise<string | null> {
  const handle = (username || "").trim().toLowerCase();
  if (!handle) return null;
  try {
    const res = await database().query<{ username: string }>(`
      SELECT lower(u.username) AS username
      FROM username_history h
      JOIN users u ON u.id = h.user_id
      WHERE lower(h.old_username) = $1 AND lower(u.username) IS DISTINCT FROM $1
      ORDER BY h.created_at DESC
      LIMIT 1
    `, [handle]);
    const value = (res.rows[0]?.username || "").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function usernameRedirect(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=120",
    },
  });
}

