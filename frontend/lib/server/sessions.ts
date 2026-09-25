import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { userIsBanned } from "./account-bans";
import { cookieSecure } from "./cookies";
import { redis } from "./redis";
import { isSuspended, userById, type User } from "./users";

export const SESSION_COOKIE = process.env.MISA_SESSION_COOKIE_NAME || "misa_session";
const normalTtl = Number(process.env.MISA_SESSION_TTL_SECONDS || 604800);
const rememberedTtl = Number(process.env.MISA_SESSION_REMEMBER_TTL_SECONDS || 2592000);
const touchEveryMs = 5 * 60 * 1000;

type StoredSession = { user_id: string; remember?: boolean; created_at?: string; last_seen_at?: string; user_agent?: string; ip?: string };

const sessionKey = (token: string) => `session:${token}`;
const userSessionsKey = (userId: string) => `user_sessions:${userId}`;
const ttlFor = (remember: boolean) => remember ? rememberedTtl : normalTtl;

async function ready() {
  const client = redis();
  if (client.status === "wait") await client.connect();
  return client;
}

export async function createSession(userId: string, request: NextRequest, remember = false) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const payload: StoredSession = {
    user_id: userId,
    remember,
    created_at: now,
    last_seen_at: now,
    user_agent: (request.headers.get("user-agent") || "").slice(0, 240),
    ip: (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim(),
  };
  const client = await ready();
  await client.set(sessionKey(token), JSON.stringify(payload), "EX", ttlFor(remember));
  await client.sadd(userSessionsKey(userId), token);
  await client.expire(userSessionsKey(userId), Math.max(ttlFor(remember), 60 * 60 * 24 * 90));
  return { token, ttl: ttlFor(remember) };
}

export function attachSession(response: NextResponse, request: NextRequest, token: string, ttl: number) {
  response.cookies.set(SESSION_COOKIE, token, {
    maxAge: ttl,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(request),
  });
}

export function clearSession(response: NextResponse, request?: NextRequest) {
  response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/", secure: request ? cookieSecure(request) : true, httpOnly: true, sameSite: "lax" });
}

async function sessionFor(token?: string | null) {
  if (!token) return null;
  const value = await (await ready()).get(sessionKey(token));
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredSession;
    return parsed.user_id ? parsed : null;
  } catch { return null; }
}

export async function currentUser(request: NextRequest): Promise<User | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await sessionFor(token);
  if (!session || !token) return null;
  const user = await userById(session.user_id);
  if (!user || isSuspended(user) || await userIsBanned(user)) {
    await destroySession(token, session.user_id);
    return null;
  }
  const lastSeen = Date.parse(session.last_seen_at || "");
  const client = await ready();
  if (Number.isNaN(lastSeen) || Date.now() - lastSeen >= touchEveryMs) {
    session.last_seen_at = new Date().toISOString();
    await client.set(sessionKey(token), JSON.stringify(session), "EX", ttlFor(Boolean(session.remember)));
  } else {
    await client.expire(sessionKey(token), ttlFor(Boolean(session.remember)));
  }
  await client.sadd(userSessionsKey(user.id), token);
  await client.expire(userSessionsKey(user.id), 7776000);
  return user;
}

export async function destroySession(token?: string | null, knownUserId?: string) {
  if (!token) return;
  const session = knownUserId ? null : await sessionFor(token);
  const userId = knownUserId || session?.user_id;
  const client = await ready();
  await client.del(sessionKey(token));
  if (userId) await client.srem(userSessionsKey(userId), token);
}

export function sessionId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function listSessions(userId: string, currentToken?: string | null) {
  const client = await ready(); const tokens = await client.smembers(userSessionsKey(userId)); const sessions: Array<{ id: string; created_at?: string; last_seen_at?: string; user_agent: string; ip: string; current: boolean }> = [];
  for (const token of tokens) { const session = await sessionFor(token); if (!session) { await client.srem(userSessionsKey(userId), token); continue; } sessions.push({ id: sessionId(token), created_at: session.created_at, last_seen_at: session.last_seen_at || session.created_at, user_agent: session.user_agent || "", ip: session.ip || "", current: Boolean(currentToken && sameToken(token, currentToken)) }); }
  return sessions.sort((a,b) => Number(b.current) - Number(a.current) || String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));
}

export async function revokeSessionById(userId: string, wanted: string) {
  const client = await ready(); const tokens = await client.smembers(userSessionsKey(userId));
  for (const token of tokens) if (sameToken(sessionId(token), wanted)) { await destroySession(token, userId); return true; }
  return false;
}

export async function revokeOtherSessions(userId: string, keep?: string | null) {
  const client = await ready(); const tokens = await client.smembers(userSessionsKey(userId)); let removed = 0;
  for (const token of tokens) { if (keep && sameToken(token, keep)) continue; await destroySession(token, userId); removed += 1; }
  return removed;
}
