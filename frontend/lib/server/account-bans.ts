import "server-only";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { database, one } from "./postgres";
import { publicUser, type User } from "./users";

export function clientIp(request: NextRequest) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}
export function normalizeIp(raw: string) {
  const value = raw.trim();
  if (!isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}
export async function rememberSignupIp(userId: string, request: NextRequest) {
  const ip = normalizeIp(clientIp(request));
  if (!ip) return;
  await database().query("UPDATE users SET signup_ip=$2 WHERE id=$1 AND (signup_ip IS NULL OR signup_ip='')", [userId, ip]);
}
export async function userIsBanned(user: User) {
  if (publicUser(user).is_admin) return false;
  const row = await one<{banned: boolean}>(`SELECT EXISTS(SELECT 1 FROM banned_accounts b WHERE b.user_id=u.id)
    OR EXISTS(SELECT 1 FROM banned_ips i WHERE i.ip=u.signup_ip) AS banned FROM users u WHERE u.id=$1`, [user.id]);
  return row?.banned === true;
}

export async function requestIpIsBanned(request: NextRequest) {
  const ip = normalizeIp(clientIp(request));
  if (!ip) return false;
  return Boolean(await one("SELECT 1 FROM banned_ips WHERE ip=$1", [ip]));
}
