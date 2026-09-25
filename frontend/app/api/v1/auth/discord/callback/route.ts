import { NextRequest } from "next/server";
import { callbackOAuth } from "@/lib/server/oauth-routes";
export const runtime = "nodejs";
export function GET(request: NextRequest) { return callbackOAuth(request, "discord"); }
