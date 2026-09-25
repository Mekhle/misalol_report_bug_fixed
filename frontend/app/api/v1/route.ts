import "server-only";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

export async function GET() {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);

  return NextResponse.json({
    service: process.env.APP_NAME || "misa",
    version: process.env.APP_VERSION || "0.1.0",
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
