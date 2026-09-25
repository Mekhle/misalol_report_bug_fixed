import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser, listSessions, revokeOtherSessions, revokeSessionById, sessionId, SESSION_COOKIE } from "@/lib/server/sessions";
export const runtime="nodejs";
export async function GET(request:NextRequest){if(!nativeCoreEnabled())return apiError("Not found.",404);try{const user=await currentUser(request);if(!user)return apiError("Not authenticated.",401);const token=request.cookies.get(SESSION_COOKIE)?.value;return NextResponse.json({sessions:await listSessions(user.id,token)},{headers:{"Cache-Control":"no-store"}})}catch{return apiError("Session storage is temporarily unavailable.",503)}}
