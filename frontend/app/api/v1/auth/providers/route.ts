import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

export async function GET() {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  return NextResponse.json({
    email: true,
    google: Boolean(process.env.MISA_GOOGLE_CLIENT_ID && process.env.MISA_GOOGLE_CLIENT_SECRET),
    discord: Boolean(process.env.MISA_DISCORD_CLIENT_ID && process.env.MISA_DISCORD_CLIENT_SECRET),
    telegram: Boolean(process.env.MISA_TELEGRAM_BOT_TOKEN && process.env.MISA_TELEGRAM_BOT_USERNAME),
    apple: Boolean(process.env.MISA_APPLE_CLIENT_ID || process.env.APPLE_CLIENT_ID),
    turnstile_site_key: process.env.MISA_TURNSTILE_SITE_KEY || "",
  }, { headers: { "Cache-Control": "no-store" } });
}
