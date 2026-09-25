import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { currentUser } from "@/lib/server/sessions";
import { hasPremium, persistProfile, sanitizeProfilePayload, savedProfile } from "@/lib/server/profile-persistence";
import { protectWrite } from "@/lib/server/premium";

export const runtime = "nodejs";
export async function GET(request: NextRequest) { if (!nativeCoreEnabled()) return apiError("Not found.",404); try { const user=await currentUser(request); if (!user) return apiError("Not authenticated.",401); return NextResponse.json({ profile: await savedProfile(user.id) },{headers:{"Cache-Control":"no-store"}}); } catch { return apiError("Profile storage is temporarily unavailable.",503); } }
export async function PUT(request: NextRequest) { if (!nativeCoreEnabled()) return apiError("Not found.",404); try { const user=await currentUser(request); if (!user) return apiError("Not authenticated.",401); const payload=await request.json(); const existing=await savedProfile(user.id); const config=sanitizeProfilePayload(payload,user,existing); if (!config.profile.displayName) return apiError("Display name cannot be empty."); const entitled=await hasPremium(user.id); const protectedConfig=protectWrite(config as any,existing as any,entitled) as any; return NextResponse.json({profile:await persistProfile(user.id,protectedConfig)},{headers:{"Cache-Control":"no-store"}}); } catch { return apiError("Profile storage is temporarily unavailable.",503); } }
