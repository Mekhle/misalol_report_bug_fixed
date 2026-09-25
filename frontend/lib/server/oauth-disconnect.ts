import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "./account-bans";
import { apiError } from "./http";
import { database } from "./postgres";
import { withinLimit } from "./rate-limit";
import { nativeCoreEnabled } from "./rollout";
import { currentUser } from "./sessions";
import type { User } from "./users";
export async function disconnectProvider(request: NextRequest, provider: "google" | "telegram") {
  if (!nativeCoreEnabled()) return apiError("Not found.",404);
  try {
    const user=await currentUser(request);if(!user)return apiError("Not authenticated.",401);
    if(!await withinLimit(`rl:${provider}-disconnect:${clientIp(request)}`,8,60))return apiError("Too many attempts. Try again later.",429);
    const db=await database().connect();
    try {
      await db.query("BEGIN");
      const live=(await db.query<User>("SELECT * FROM users WHERE id=$1 FOR UPDATE",[user.id])).rows[0];
      if(!live){await db.query("ROLLBACK");return apiError("Not authenticated.",401);}
      if(!live[`${provider}_id`]){await db.query("ROLLBACK");return apiError(`${provider==='google'?'Google':'Telegram'} is not connected.`);}
      const alternatives=(["google","discord","telegram","apple"] as const).some(other=>other!==provider&&live[`${other}_id`]);
      if(!live.password_hash&&!alternatives){await db.query("ROLLBACK");return apiError("Add a password or another login method before disconnecting this provider.");}
      await db.query(`UPDATE users SET ${provider}_id=NULL,${provider==='telegram'?'telegram_username=NULL,':''}updated_at=NOW() WHERE id=$1`,[user.id]);
      await db.query("COMMIT");
    } catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
    return NextResponse.json({ok:true,connected:false},{headers:{"Cache-Control":"no-store"}});
  }catch{return apiError("Account storage is temporarily unavailable. Please try again.",503);}
}
