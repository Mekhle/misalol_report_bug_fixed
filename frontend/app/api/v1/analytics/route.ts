import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { analyticsSummary, ingestAnalyticsEvent } from "@/lib/server/analytics";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";

export const runtime = "nodejs";
const key = (request: NextRequest) => (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
export async function POST(request: NextRequest) { if (!nativeCoreEnabled()) return apiError("Not found.",404); try { if (await withinLimit(`rl:analytics:${key(request)}`,40,60)) await ingestAnalyticsEvent(request,await request.json().catch(()=>null)); } catch { /* event collection intentionally stays non-disruptive */ } return new NextResponse(null,{status:204}); }
export async function GET(request: NextRequest) { if (!nativeCoreEnabled()) return apiError("Not found.",404); try { const user=await currentUser(request); if (!user) return apiError("Not authenticated.",401); return NextResponse.json(await analyticsSummary(user.id,request.nextUrl.searchParams.get("range")||"7D"),{headers:{"Cache-Control":"no-store"}}); } catch { return apiError("Analytics are temporarily unavailable.",503); } }
