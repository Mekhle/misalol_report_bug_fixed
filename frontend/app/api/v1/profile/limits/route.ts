import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { profileLimits } from "@/lib/server/profiles";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

export async function GET() {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  return NextResponse.json(profileLimits());
}
