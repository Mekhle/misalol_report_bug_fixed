import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { normalizeIp } from "./account-bans";
import { AdminError,type AdminAccount } from "./admin-auth";
import { adminTransaction,audit } from "./admin-operations";
import { database } from "./postgres";
import { revokeOtherSessions } from "./sessions";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
const handle=(value:string)=>value.trim().replace(/^@+/,'').toLowerCase();
function reason(value:unknown){if(value==null)return null;if(typeof value!=='string'||value.length>500)throw new AdminError('Invalid reason.',422);return value.trim().replace(/\s+/g,' ').slice(0,500)||null;}
async function unsuspendIfClear(db:PoolClient,id:string){await db.query(`UPDATE users SET suspended_at=NULL,suspension_reason=NULL,suspended_until=NULL,updated_at=NOW() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM banned_accounts WHERE user_id=$1) AND NOT EXISTS(SELECT 1 FROM banned_ips i WHERE i.ip=users.signup_ip)`,[id]);}
export async function adminBanRoute(request:NextRequest,path:string[],admin:AdminAccount){
 if(path[0]!=='bans')return null;
 const method=request.method;
 if(path.length===1&&method==='GET'){
  const [accounts,ips]=await Promise.all([database().query('SELECT b.user_id,COALESCE(u.username,b.username) AS username,u.signup_ip,b.reason,b.created_by,b.created_at FROM banned_accounts b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC'),database().query("SELECT i.ip,i.reason,i.created_by,i.created_at,COALESCE(array_agg(u.username ORDER BY u.username) FILTER(WHERE u.username IS NOT NULL),'{}') AS usernames FROM banned_ips i LEFT JOIN users u ON u.signup_ip=i.ip GROUP BY i.ip,i.reason,i.created_by,i.created_at ORDER BY i.created_at DESC")]);return json({accounts:accounts.rows,ips:ips.rows});
 }
 if(path[1]==='accounts'&&path.length===2&&method==='POST'){
  const body=await request.json();if(typeof body.username!=='string'||body.username.length<3||body.username.length>32)throw new AdminError('Invalid username.',422);const note=reason(body.reason);
  let ban:{user_id:string;username:string;signup_ip:string|null};
  try{ban=await adminTransaction(async db=>{const user=(await db.query<{id:string;username:string;signup_ip:string|null;is_admin:boolean}>('SELECT id,username,signup_ip,is_admin FROM users WHERE lower(username)=$1 FOR UPDATE',[handle(body.username)])).rows[0];if(!user)throw new AdminError('User not found.',404);
   if(user.is_admin||(process.env.MISA_ADMIN_USER_IDS||'').split(',').map(value=>value.trim()).includes(user.id))throw new AdminError('Administrator accounts cannot be banned.',400);
   await db.query('INSERT INTO banned_accounts (user_id,username,reason,created_by) VALUES ($1,$2,$3,$4)',[user.id,user.username,note,admin.id]);await db.query('UPDATE users SET suspended_at=NOW(),suspension_reason=$2,suspended_until=NULL,updated_at=NOW() WHERE id=$1',[user.id,note||'Account banned']);await audit(db,admin.id,'account.ban','user',user.id,{username:user.username,reason:note});return {user_id:user.id,username:user.username,signup_ip:user.signup_ip};});}catch(error){if((error as {code?:string}).code==='23505')throw new AdminError('That account is already banned.',409);throw error;}
  await revokeOtherSessions(ban.user_id);return json({ok:true,ban},201);
 }
 if(path[1]==='accounts'&&path.length===3&&method==='DELETE'){
  const username=handle(path[2]);await adminTransaction(async db=>{const row=(await db.query<{user_id:string}>("SELECT b.user_id FROM banned_accounts b LEFT JOIN users u ON u.id=b.user_id WHERE lower(COALESCE(u.username,b.username,''))=$1 OR b.user_id::text=$1",[username])).rows[0];if(!row)throw new AdminError('That account is not banned.',404);await db.query('DELETE FROM banned_accounts WHERE user_id=$1',[row.user_id]);await unsuspendIfClear(db,row.user_id);await audit(db,admin.id,'account.unban','user',row.user_id,{username});});return json({ok:true});
 }
 if(path[1]==='ips'&&path.length===2&&method==='POST'){
  const body=await request.json(),ip=typeof body.ip==='string'?normalizeIp(body.ip):null,note=reason(body.reason);if(!ip)throw new AdminError('Enter a valid IP address.',400);
  let affected:{id:string;username:string|null}[];
  try{affected=await adminTransaction(async db=>{await db.query('INSERT INTO banned_ips (ip,reason,created_by) VALUES ($1,$2,$3)',[ip,note,admin.id]);const users=(await db.query<{id:string;username:string|null}>('SELECT id,username FROM users WHERE signup_ip=$1 AND is_admin=FALSE FOR UPDATE',[ip])).rows;for(const user of users)await db.query('UPDATE users SET suspended_at=NOW(),suspension_reason=$2,suspended_until=NULL,updated_at=NOW() WHERE id=$1',[user.id,note||'IP banned']);await audit(db,admin.id,'ip.ban','ip',ip,{reason:note,accounts:users.map(user=>user.username).filter(Boolean)});return users;});}catch(error){if((error as {code?:string}).code==='23505')throw new AdminError('That IP is already banned.',409);throw error;}
  for(const user of affected)await revokeOtherSessions(user.id);return json({ok:true,ban:{ip,usernames:affected.map(user=>user.username).filter(Boolean)}},201);
 }
 if(path[1]==='ips'&&path.length===2&&method==='DELETE'){
  const ip=normalizeIp(request.nextUrl.searchParams.get('ip')||'');if(!ip)throw new AdminError('Enter a valid IP address.',400);
  await adminTransaction(async db=>{if(!(await db.query('DELETE FROM banned_ips WHERE ip=$1',[ip])).rowCount)throw new AdminError('That IP is not banned.',404);const users=(await db.query<{id:string}>('SELECT id FROM users WHERE signup_ip=$1',[ip])).rows;for(const user of users)await unsuspendIfClear(db,user.id);await audit(db,admin.id,'ip.unban','ip',ip,{accounts:users.length});});return json({ok:true});
 }
 return null;
}
