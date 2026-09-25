import "server-only";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";
export type OAuthProvider = "google" | "discord" | "telegram" | "apple";
export type OAuthState = { provider: OAuthProvider; next: string; nonce: string; mode: "login" | "link" };
export function safeNextPath(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "/dashboard";
  const raw = value.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (/[:\\\r\n\t\0-\x1f\x7f]/.test(raw)) return "/dashboard";
  try {
    const unquoted = decodeURIComponent(raw);
    if (unquoted.startsWith("//") || unquoted.startsWith("/\\") || /[:\\\r\n\t\0-\x1f\x7f]/.test(unquoted)) {
      return "/dashboard";
    }
  } catch {
    return "/dashboard";
  }
  return raw;
}
export function oauthDestination(signedIn: boolean, next: string) {
  const dashboard = (process.env.MISA_DASHBOARD_URL || "/dashboard").replace(/\/+$/, "");
  if (["/dashboard", "/dashboard/", ""].includes(next)) return dashboard;
  if (next.startsWith("/dashboard/")) return dashboard.startsWith("http") ? dashboard + next.slice(10) : next;
  if (signedIn && ["/security", "/settings"].includes(next)) return dashboard.startsWith("http") ? dashboard + next : "/dashboard" + next;
  return signedIn ? dashboard : next;
}
export async function saveOAuthState(provider: OAuthProvider, next: string, nonce = "", mode: "login" | "link" = "login") {
  const state = randomBytes(32).toString("base64url"), client = redis();
  if (client.status === "wait") await client.connect();
  await client.set(`oauth:${state}`, JSON.stringify({ provider, next, nonce, mode }), "EX", 600);
  return state;
}
export async function popOAuthState(state: string, provider: OAuthProvider): Promise<OAuthState | null> {
  if (!state) return null;
  const client = redis(); if (client.status === "wait") await client.connect();
  const raw = await client.getdel(`oauth:${state}`);
  try { const data = raw ? JSON.parse(raw) : null; return data?.provider === provider ? data : null; } catch { return null; }
}
export function verifyTelegramAuth(payload: Record<string, string>, token: string, now = Math.floor(Date.now() / 1000)) {
  const fields = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];
  const text = fields.filter(key => payload[key] !== undefined && payload[key] !== "").sort().map(key => `${key}=${payload[key]}`).join("\n");
  const expected = createHmac("sha256", createHash("sha256").update(token).digest()).update(text).digest("hex");
  const signature = Buffer.from(payload.hash || "");
  if (signature.length !== expected.length || !timingSafeEqual(signature, Buffer.from(expected))) return false;
  const date = Number(payload.auth_date);
  return Number.isInteger(date) && date > 0 && now - date <= 86400 && date <= now;
}
export const trustedEmailClaim = (value: unknown) => value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
