import "server-only";

import type { NextRequest } from "next/server";

export async function verifyTurnstile(request: NextRequest, token: unknown) {
  const secret = process.env.MISA_TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.MISA_TURNSTILE_SITE_KEY) return false;
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const remoteip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteip) form.set("remoteip", remoteip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}
