import "server-only";
import { createHash,randomBytes,randomInt,randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { clientIp } from "./account-bans";
import { ADMIN_COOKIE,AdminError,adminByEmail,adminCan,adminDigest,createAdminOtp,logAdminEvent,permissions,requireAdminSession,requireSuperAdmin,sendAdminMail,verifyAdminOtp,type AdminAccount } from "./admin-auth";
import { apiError } from "./http";
import { database,one } from "./postgres";
import { withinLimit } from "./rate-limit";
import { nativeCoreEnabled } from "./rollout";
import { verifyTurnstile } from "./turnstile";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const trace=(request:NextRequest)=>process.env.MISA_LOCAL_OTP_TRACE==="true"?request.headers.get("x-misa-local-trace")||"":"";
const traceDigest=(id:string,value:string)=>{if(id)console.info(JSON.stringify({local_otp_trace:id,stage:"digest",fingerprint:hash(value).slice(0,16)}));};
const secure=()=> (process.env.MISA_ENVIRONMENT||"production").toLowerCase()==="production";
async function limit(key:string,max:number,seconds:number){if(!await withinLimit(key,max,seconds))throw new AdminError("Too many attempts. Try again later.",429);}
function email(value:unknown){if(typeof value!=="string"||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw new AdminError("Enter a valid email address.",422);return value.trim().toLowerCase();}
function uuid(value:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw new AdminError("Invalid identifier.",422);return value;}
async function captcha(request:NextRequest,token:unknown){if(!process.env.MISA_TURNSTILE_SITE_KEY||!process.env.MISA_TURNSTILE_SECRET_KEY)throw new AdminError("Human verification is not configured.",503);if(!await verifyTurnstile(request,token))throw new AdminError("Human verification failed. Try again.",400);}
export async function adminAuthRoute(request:NextRequest,path:string[]){
 if(!nativeCoreEnabled())return apiError("Not found.",404);
 try{
  const route=path.join("/"),method=request.method;
  if(route==="request-otp"&&method==="POST"){
   const body=await request.json();const address=email(body.email);await limit(`rl:admin-otp-ip:${clientIp(request)}`,5,900);await captcha(request,body.turnstile_token);
   await limit(`rl:admin-otp-email:${hash(address)}`,5,900);const fingerprint=request.headers.get("x-device-fingerprint");if(fingerprint)await limit(`rl:admin-otp-device:${hash(fingerprint)}`,5,900);
   const account=await adminByEmail(address);
   if(account?.status==="active"&&!account.suspended){const code=String(randomInt(1000000)).padStart(6,"0");await createAdminOtp(account.id,adminDigest(code));const ip=clientIp(request),agent=request.headers.get("user-agent")||"unknown";
    try{await sendAdminMail(address,"Your misa.lol admin verification code",`Your misa.lol admin verification code is ${code}. It expires in 5 minutes. IP: ${ip}. Browser: ${agent}`);await logAdminEvent(account.id,"admin.otp.sent",{ip,user_agent:agent});}
    catch{await logAdminEvent(account.id,"admin.otp.send_failed",{ip});throw new AdminError("The verification email could not be sent.",503);}}
   return json({ok:true,message:"If that address is authorized, a verification code has been sent."});
  }
  if(route==="verify-otp"&&method==="POST"){
   const body=await request.json(),address=email(body.email);if(typeof body.code!=="string"||!/^\d{6}$/.test(body.code))throw new AdminError("Invalid verification code.",422);
   await limit(`rl:admin-otp-verify-ip:${clientIp(request)}`,20,900);await captcha(request,body.turnstile_token);
   const account=await adminByEmail(address);if(!account||account.status!=="active"||account.suspended)throw new AdminError("Invalid or expired verification code.",401);
   const result=await verifyAdminOtp(account.id,adminDigest(body.code));if(result!=="ok"){await logAdminEvent(account.id,"admin.otp.failed",{ip:clientIp(request),result});throw new AdminError("Invalid or expired verification code.",401);}
   const raw=randomBytes(48).toString("base64url");await database().query("INSERT INTO admin_sessions (id,admin_id,token_hash,ip_address,user_agent,device_fingerprint,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '8 hours')",[randomUUID(),account.id,adminDigest(raw),clientIp(request),request.headers.get("user-agent")||"unknown",request.headers.get("x-device-fingerprint")||""]);
   await logAdminEvent(account.id,"admin.otp.verified",{ip:clientIp(request),user_agent:request.headers.get("user-agent")||"unknown"});
   const response=json({ok:true,admin:account});response.cookies.set(ADMIN_COOKIE,raw,{maxAge:28800,path:"/",httpOnly:true,secure:secure(),sameSite:"strict"});return response;
  }
  if(route==="logout"&&method==="POST"){
   const raw=request.cookies.get(ADMIN_COOKIE)?.value;if(raw)await database().query("UPDATE admin_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL",[adminDigest(raw)]);
   const response=json({ok:true});response.cookies.set(ADMIN_COOKIE,"",{maxAge:0,path:"/",httpOnly:true,secure:secure(),sameSite:"strict"});return response;
  }
  if(route==="invites/accept"&&method==="POST"){
   const body=await request.json();if(typeof body.token!=="string"||body.token.length<32||body.token.length>256)throw new AdminError("Invalid invitation token.",422);
   const digest=adminDigest(body.token),db=await database().connect();let account:AdminAccount|undefined;
   try{await db.query("BEGIN");const invite=(await db.query<{id:string;email:string;name:string;role:string;permissions:unknown}>("SELECT * FROM admin_invites WHERE token_hash=$1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>NOW() FOR UPDATE",[digest])).rows[0];
    if(!invite){await db.query("ROLLBACK");throw new AdminError("This invitation is invalid or expired.",400);}
    await db.query("INSERT INTO admin_accounts (id,email,name,role,permissions) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,permissions=EXCLUDED.permissions,status='active',suspended=FALSE,updated_at=NOW()",[randomUUID(),invite.email,invite.name,invite.role,JSON.stringify(permissions(invite.permissions))]);
    await db.query("UPDATE admin_invites SET accepted_at=NOW() WHERE id=$1",[invite.id]);account=(await db.query<AdminAccount>("SELECT id,email,name,role,permissions,status,suspended FROM admin_accounts WHERE lower(email)=lower($1)",[invite.email])).rows[0];await db.query("COMMIT");
   }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
   if(!account)throw new AdminError("This invitation is invalid or expired.",400);await logAdminEvent(account.id,"admin.invite.accepted",{email:account.email});return json({ok:true,email:account.email});
  }
  const admin=await requireAdminSession(request);
  if(route==="session"&&method==="GET")return json({admin});
  if((route==="staff"||route==="staff/invites")&&method==="GET"){
   if(!adminCan(admin,"staff"))throw new AdminError("Staff permission is required.",403);
   return route==="staff"?json({staff:(await database().query("SELECT id,email,name,role,status,suspended FROM admin_accounts ORDER BY lower(email)")).rows}):json({invites:(await database().query("SELECT id,email,name,role,permissions,expires_at,accepted_at,revoked_at,created_at FROM admin_invites ORDER BY created_at DESC")).rows});
  }
  requireSuperAdmin(admin);
  if(route==="staff/invites"&&method==="POST"){
   const body=await request.json(),address=email(body.email);
   if(typeof body.name!=="string"||body.name.length<1||body.name.length>128||(body.role!==undefined&&body.role!=="admin"))throw new AdminError("Invalid invitation.",422);
   const root=(process.env.MISA_ADMIN_ROOT_EMAIL||process.env.SUPER_ADMIN_EMAIL||process.env.ADMIN_ROOT_EMAIL||"").toLowerCase();if(address===root)throw new AdminError("The root administrator cannot be invited.",409);if(await adminByEmail(address))throw new AdminError("That address is already staff.",409);
   const grants=body.permissions??{admin:true,users:true,badges:true,reports:true};if(!grants||typeof grants!=="object"||Array.isArray(grants)||Object.values(grants).some(value=>typeof value!=="boolean"))throw new AdminError("Invalid permissions.",422);
   const raw=randomBytes(48).toString("base64url"),inviteId=randomUUID(),expires=new Date(Date.now()+86400000);
   await database().query("INSERT INTO admin_invites (id,email,name,token_hash,role,permissions,expires_at,created_by) VALUES ($1,$2,$3,$4,'admin',$5::jsonb,$6,$7)",[inviteId,address,body.name,adminDigest(raw),JSON.stringify(grants),expires,admin.id]);
   try{await sendAdminMail(address,"You are invited to misa.lol admin",`You have been invited to misa.lol administration. Accept within 24 hours: ${(process.env.MISA_ADMIN_PUBLIC_URL||"https://ukvhq.dev/m").replace(/\/+$/,"")}/invite?token=${raw}`);}catch{await logAdminEvent(admin.id,"admin.invite.send_failed",{email:address});throw new AdminError("The invitation email could not be sent.",503);}
   await logAdminEvent(admin.id,"admin.invite.sent",{email:address,expires_at:expires.toISOString()},inviteId);return json({ok:true},201);
  }
  if(route==="staff/sessions"&&method==="GET")return json({sessions:(await database().query("SELECT s.id,s.admin_id,a.email,s.ip_address,s.user_agent,s.created_at,s.last_seen_at,s.expires_at,s.revoked_at FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id ORDER BY s.created_at DESC")).rows});
  if(path.length===3&&path[0]==="staff"&&["invites","sessions"].includes(path[1])&&method==="DELETE"){
   const table=path[1]==="invites"?"admin_invites":"admin_sessions";const result=await database().query(`UPDATE ${table} SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL`,[uuid(path[2])]);if(!result.rowCount)throw new AdminError(path[1]==="invites"?"Invite not found.":"Session not found.",404);return json({ok:true});
  }
  if(path.length===3&&path[0]==="staff"&&path[2]==="revoke-sessions"&&method==="POST"){
   const target=uuid(path[1]);if(!await one("SELECT id FROM admin_accounts WHERE id=$1",[target]))throw new AdminError("Administrator not found.",404);
   return json({revoked:(await database().query("UPDATE admin_sessions SET revoked_at=NOW() WHERE admin_id=$1 AND revoked_at IS NULL",[target])).rowCount||0});
  }
  return apiError("Not found.",404);
 }catch(error){return error instanceof AdminError?apiError(error.message,error.status):error instanceof SyntaxError?apiError("Invalid request.",422):apiError("Admin storage is temporarily unavailable.",503);}
}
