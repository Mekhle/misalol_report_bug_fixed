import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { database, one } from "./postgres";
import { currentUser } from "./sessions";
import { publicUser } from "./users";
export const ADMIN_COOKIE="misa_admin_session";
export type AdminAccount={id:string;email:string;name:string;role:string;permissions:Record<string,unknown>;status:string;suspended:boolean};
export class AdminError extends Error { status:number;constructor(detail:string,status:number){super(detail);this.status=status;} }
export function adminDigest(value:string){const secret=process.env.MISA_ADMIN_TOKEN_SECRET||process.env.ADMIN_TOKEN_SECRET;if(!secret)throw new AdminError("Admin security secret is not configured.",503);return createHmac("sha256",secret).update(value).digest("hex");}
export function permissions(value:unknown):Record<string,unknown>{if(typeof value==="string"){try{value=JSON.parse(value);}catch{return {};}}return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export const adminCan=(admin:AdminAccount,permission:string)=>admin.role==="super_admin"||Boolean(admin.permissions["*"]||admin.permissions[permission]);
export async function requireAdminSession(request:NextRequest):Promise<AdminAccount>{
 const raw=request.cookies.get(ADMIN_COOKIE)?.value;
 if(raw){const digest=adminDigest(raw);const account=await one<AdminAccount>(`SELECT a.id,a.email,a.name,a.role,a.permissions,a.status,a.suspended FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW()`,[digest]);
  if(account&&account.status==="active"&&!account.suspended){await database().query("UPDATE admin_sessions SET last_seen_at=NOW() WHERE token_hash=$1",[digest]);return {...account,permissions:permissions(account.permissions)};}}
 const user=await currentUser(request);
 if(user){const owner=publicUser(user).is_admin;const role=owner?"owner":(await one<{role:string}>("SELECT role FROM user_roles WHERE user_id=$1 AND role IN ('owner','admin','moderator') ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1",[user.id]))?.role;
  if(role==="owner"||role==="admin")return {id:user.id,email:user.email||"",name:user.display_name||user.username||user.email||"Administrator",role:role==="owner"?"super_admin":"admin",permissions:{"*":role==="owner",admin:true,users:true,badges:true,reports:true},status:"active",suspended:false};}
 throw new AdminError("Admin authentication required.",401);
}
export function requireSuperAdmin(admin:AdminAccount){if(admin.role!=="super_admin")throw new AdminError("Super Administrator access is required.",403);}
export async function adminByEmail(email:string){return one<AdminAccount>("SELECT id,email,name,role,permissions,status,suspended FROM admin_accounts WHERE lower(email)=$1",[email]);}
export async function logAdminEvent(id:string,action:string,metadata:Record<string,unknown>={},target:string|null=null){await database().query("INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,metadata) VALUES ((SELECT id FROM users WHERE id=$1),$2,'admin',$3,$4::jsonb)",[id,action,target,JSON.stringify(metadata)]);}
export async function createAdminOtp(id:string,digest:string){const db=await database().connect();try{await db.query("BEGIN");await db.query("SELECT id FROM admin_accounts WHERE id=$1 FOR UPDATE",[id]);await db.query("UPDATE admin_otps SET consumed_at=NOW() WHERE admin_id=$1 AND consumed_at IS NULL",[id]);await db.query("INSERT INTO admin_otps (id,admin_id,code_hash,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')",[randomUUID(),id,digest]);await db.query("COMMIT");}catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}}
export async function verifyAdminOtp(id:string,digest:string){
 const db=await database().connect();try{
  await db.query("BEGIN");
  const row=(await db.query<{id:string;code_hash:string;expires_at:Date;attempts:number;consumed_at:Date|null}>("SELECT id,code_hash,expires_at,attempts,consumed_at FROM admin_otps WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[id])).rows[0];
  let result="ok";
  if(!row||row.consumed_at)result="missing";else if(new Date(row.expires_at).getTime()<=Date.now())result="expired";else if(row.attempts>=5)result="attempts";else{
   const actual=Buffer.from(digest),expected=Buffer.from(row.code_hash);
   if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){await db.query("UPDATE admin_otps SET attempts=attempts+1 WHERE id=$1",[row.id]);result="invalid";}
   else await db.query("UPDATE admin_otps SET consumed_at=NOW() WHERE id=$1",[row.id]);
  }
  await db.query("COMMIT");return result;
 }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
}
export async function sendAdminMail(to:string,subject:string,text:string){
 const key=process.env.MISA_EMAIL_API_KEY||process.env.EMAIL_API_KEY,url=process.env.MISA_EMAIL_API_URL??process.env.EMAIL_API_URL??"https://api.resend.com/emails";
 if(!key||!url)throw new Error("Transactional email provider is not configured.");
 const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.MISA_EMAIL_FROM||process.env.EMAIL_FROM||"Misa.lol <no-reply@misa.lol>",to:[to],subject,text})});
 if(!response.ok)throw new Error("Transactional email failed.");
}
