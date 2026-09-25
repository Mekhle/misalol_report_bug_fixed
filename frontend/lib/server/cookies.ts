import "server-only";
import type { NextRequest } from "next/server";
export function cookieSecure(request: NextRequest) {
  const host = (request.headers.get("host") || new URL(request.url).host).split(":")[0].toLowerCase();
  if (["localhost", "127.0.0.1"].includes(host)) return false;
  const forwarded = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return (request.headers.get("cf-visitor") || "").includes("https") || (process.env.MISA_ENVIRONMENT || "production").toLowerCase() === "production" || new URL(request.url).protocol === "https:";
}
