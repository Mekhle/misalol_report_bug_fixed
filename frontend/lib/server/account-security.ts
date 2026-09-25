import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookieSecure } from "./cookies";
import type { NextRequest, NextResponse } from "next/server";

// Match Python account_security, including configuration aliases and defaults.
export function accountSecret() {
  const material = process.env.MISA_ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN_SECRET || "";
  if (!material) {
    throw new Error("Admin security secret is not configured.");
  }
  return createHash("sha256").update(`misa-account:${material}`).digest();
}
const cookieName = () => process.env.MISA_SWITCHER_COOKIE_NAME || "misa_switcher";
function cleanIds(values: unknown[]): string[] {
  return values.flatMap(value => {
    if (typeof value !== "string") return [];
    const compact = value.replace(/^urn:uuid:/, "").replace(/[{}-]/g, "");
    if (!/^[a-f0-9]{32}$/i.test(compact)) return [];
    return [compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase()];
  }).slice(0, 3);
}
export function signSwitcher(ids: string[]) {
  const body = Buffer.from(JSON.stringify({ v: 1, ids: cleanIds(ids) })).toString("base64url");
  return `${body}.${createHmac("sha256", accountSecret()).update(body).digest("base64url")}`;
}
export function decodeSwitcher(raw: string): string[] {
  const [body, signature, extra] = raw.split(".");
  if (!body || !signature || extra !== undefined) return [];
  const expected = createHmac("sha256", accountSecret()).update(body).digest("base64url");
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) return [];
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data && Array.isArray(data.ids) ? cleanIds(data.ids) : [];
  } catch { return []; }
}
export const readSwitcherIds = (request: NextRequest) => decodeSwitcher(request.cookies.get(cookieName())?.value || "");
export const addSwitcherId = (ids: string[], id: string) => [id, ...ids.filter(item => item !== id)].slice(0, 3);
export function attachSwitcher(response: NextResponse, request: NextRequest, ids: string[]) {
  const secure = cookieSecure(request);
  response.cookies.set(cookieName(), signSwitcher(ids), { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: Number(process.env.MISA_SWITCHER_TTL_SECONDS || 7776000) });
}
export function rememberSwitcherUser(response: NextResponse, request: NextRequest, id: string) {
  attachSwitcher(response, request, addSwitcherId(readSwitcherIds(request), id));
}
