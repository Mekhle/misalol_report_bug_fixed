import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { generateBackupCodes, replaceBackupCodes } from "@/lib/server/mfa";
import { withinLimit } from "@/lib/server/rate-limit";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
export const runtime="nodejs";
export async function POST(request:NextRequest){if(!nativeCoreEnabled())return apiError("Not found.",404);try{const user=await currentUser(request);if(!user)return apiError("Not authenticated.",401);const body=await request.json().catch(()=>null)as{password?:unknown}|null,password=typeof body?.password==="string"?body.password:"";if(user.password_hash&&(!password||!await argon2.verify(user.password_hash,password)))return apiError("Current password is wrong.",401);if(!await withinLimit(`rl:mfa-codes:${user.id}`,5,86400))return apiError("Too many attempts. Please try again shortly.",429);const codes=generateBackupCodes();await replaceBackupCodes(user.id,codes);return NextResponse.json({ok:true,codes,mfa_enabled:true,mfa_codes_left:codes.length})}catch{return apiError("Could not save backup codes.",503)}}
