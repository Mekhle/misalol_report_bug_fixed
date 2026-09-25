import { NextRequest } from "next/server";
import { startOAuth } from "@/lib/server/oauth-routes";
export const runtime = "nodejs";
export function GET(request: NextRequest) { return startOAuth(request, "telegram"); }
