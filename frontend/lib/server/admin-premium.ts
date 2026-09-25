import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { AdminError,type AdminAccount } from "./admin-auth";
import { adminTransaction,adminUuid,audit } from "./admin-operations";
import { database,one } from "./postgres";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export const rankSlug=(name:string)=>name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,64);
export async function adminPremiumRoute(request:NextRequest,path:string[],admin:AdminAccount){
 if(path[0]!=='entitlements')return null;
 const method=request.method;
 if(path.length===1&&method==='GET'){
  const [ranks,entitlements]=await Promise.all([database().query("SELECT r.id,r.name,r.slug,r.created_at,(SELECT count(*) FROM premium_entitlements e WHERE lower(e.plan)=r.slug AND e.active=TRUE) AS holders FROM premium_ranks r ORDER BY r.name"),database().query('SELECT id,user_id,plan,active,expires_at,granted_by,created_at FROM premium_entitlements ORDER BY created_at DESC')]);return json({ranks:ranks.rows.map(row=>({...row,holders:Number(row.holders)})),entitlements:entitlements.rows});
 }
 if(path.length===1&&method==='POST'){
  const body=await request.json(),user=adminUuid(body.user_id),id=randomUUID();if(typeof body.plan!=='string'||body.plan.length<1||body.plan.length>64||body.active!==undefined&&typeof body.active!=='boolean')throw new AdminError('Invalid entitlement.',422);
  const expires=body.expires_at==null?null:new Date(body.expires_at);if(expires&&Number.isNaN(expires.getTime()))throw new AdminError('Invalid expiration.',422);
  try{await adminTransaction(async db=>{await db.query('INSERT INTO premium_entitlements (id,user_id,plan,active,expires_at,granted_by) VALUES ($1,$2,$3,$4,$5,$6)',[id,user,body.plan,body.active??true,expires,admin.id]);await audit(db,admin.id,'premium.grant','user',user,{plan:body.plan,expires_at:expires?.toISOString()||null});});}catch(error){if((error as {code?:string}).code==='23503')throw new AdminError('User not found.',404);throw error;}return json({id},201);
 }
 if(path.length===2&&path[1]==='ranks'&&method==='POST'){
  const body=await request.json();if(typeof body.name!=='string'||body.name.length<2||body.name.length>64)throw new AdminError('Invalid rank name.',422);const name=body.name.trim().replace(/\s+/g,' '),slug=rankSlug(name),id=randomUUID();if(name.length<2||!slug)throw new AdminError('Enter a rank name.',400);
  try{await adminTransaction(async db=>{await db.query('INSERT INTO premium_ranks (id,name,slug,created_by) VALUES ($1,$2,$3,$4)',[id,name,slug,admin.id]);await audit(db,admin.id,'premium.rank.create','premium_rank',id,{name,slug});});}catch(error){if((error as {code?:string}).code==='23505')throw new AdminError('That rank already exists.',409);throw error;}return json({ok:true,rank:{id,name,slug}},201);
 }
 if(path[1]!=='ranks'||path.length<3)return null;
 const rankId=adminUuid(path[2]);
 if(path.length===3&&method==='GET'){
  const rank=await one<{id:string;name:string;slug:string;created_at:string}>('SELECT id,name,slug,created_at FROM premium_ranks WHERE id=$1',[rankId]);if(!rank)throw new AdminError('Rank not found.',404);
  const holders=await database().query('SELECT e.id,e.user_id,u.username,e.created_at FROM premium_entitlements e LEFT JOIN users u ON u.id=e.user_id WHERE lower(e.plan)=$1 AND e.active=TRUE ORDER BY COALESCE(u.username,e.user_id::text)',[rank.slug]);return json({rank:{...rank,holders:holders.rows}});
 }
 const grant=path.length===4&&path[3]==='grants'&&method==='POST',revoke=path.length===5&&path[3]==='grants'&&method==='DELETE';if(!grant&&!revoke)return null;
 const ref=grant?(await request.json()).username:path[4];if(typeof ref!=='string'||ref.length<3||ref.length>64)throw new AdminError('Invalid username.',422);
 const user=await one<{id:string}>("SELECT id FROM users WHERE lower(username)=$1 OR id::text=$1 OR account_id=$1",[ref.trim().replace(/^@+/,'').toLowerCase()]);if(!user)throw new AdminError('User not found.',404);
 const id=randomUUID();await adminTransaction(async db=>{
  const rank=(await db.query<{slug:string}>('SELECT slug FROM premium_ranks WHERE id=$1 FOR UPDATE',[rankId])).rows[0];if(!rank)throw new AdminError('Rank not found.',404);
  if(grant){if((await db.query('SELECT id FROM premium_entitlements WHERE user_id=$1 AND lower(plan)=$2 AND active=TRUE',[user.id,rank.slug])).rowCount)throw new AdminError('That user already has this rank.',409);await db.query('INSERT INTO premium_entitlements (id,user_id,plan,active,expires_at,granted_by) VALUES ($1,$2,$3,TRUE,NULL,$4)',[id,user.id,rank.slug,admin.id]);await audit(db,admin.id,'premium.grant','user',user.id,{plan:rank.slug,expires_at:null});}
  else{if(!(await db.query('UPDATE premium_entitlements SET active=FALSE WHERE user_id=$1 AND lower(plan)=$2 AND active=TRUE',[user.id,rank.slug])).rowCount)throw new AdminError('That user does not have this rank.',404);await audit(db,admin.id,'premium.revoke','user',user.id,{plan:rank.slug});}
 });return grant?json({ok:true,id},201):json({ok:true});
}
