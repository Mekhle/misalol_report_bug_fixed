import "server-only";
import { NextRequest,NextResponse } from "next/server";
import { AdminError,type AdminAccount } from "./admin-auth";
import { adminTransaction,adminUuid,audit } from "./admin-operations";
import { database } from "./postgres";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function adminUsersRoute(request:NextRequest,path:string[],admin:AdminAccount&{staffRole:string}){
 const route=path.join('/'),method=request.method;
 if(route==='users'&&method==='GET'){
  const search=request.nextUrl.searchParams.get('search')||'',limit=Number(request.nextUrl.searchParams.get('limit')||50),offset=Number(request.nextUrl.searchParams.get('offset')||0);if(search.length>128||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw new AdminError('Invalid query.',422);
  const result=await database().query(`SELECT id,email,email_verified,username,display_name,avatar_url,google_id,discord_id,telegram_id,telegram_username,apple_id,created_at,updated_at,last_login_at,is_admin,suspended_at,suspension_reason,suspended_until,
   EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=users.id AND r.role='template_creator') AS is_template_creator,
   EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=users.id AND r.role='owner') AS is_owner,
   EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=users.id AND r.role='admin') AS is_staff_admin,
   EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=users.id AND r.role='moderator') AS is_moderator
   FROM users WHERE $1='%' OR id::text ILIKE $1 OR COALESCE(username,'') ILIKE $1 OR COALESCE(email,'') ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,[`%${search.trim()}%`,limit,offset]);
  const allow=(process.env.MISA_ADMIN_USER_IDS||'').split(',').map(value=>value.trim());return json({users:result.rows.map(row=>({...row,staff_role:row.is_admin||row.is_owner||allow.includes(row.id)?'owner':row.is_staff_admin?'admin':row.is_moderator?'moderator':null})),limit,offset});
 }
 if(route==='staff'&&method==='GET')return json({staff:(await database().query("SELECT u.id,u.username,u.email,CASE WHEN r.role='admin' THEN 'admin' ELSE 'moderator' END AS staff_role FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.role IN ('admin','moderator') ORDER BY r.role,COALESCE(u.username,u.email,u.id::text)")).rows});
 const byId=path.length===3&&path[0]==='users'&&path[2]==='roles'&&method==='PATCH';
 const byName=route==='staff'&&method==='POST',remove=path.length===2&&path[0]==='staff'&&method==='DELETE';
 if(!byId&&!byName&&!remove)return null;
 const body=remove?{}:await request.json(),role=remove?request.nextUrl.searchParams.get('role')||'moderator':body.role,granted=remove?false:body.granted??true;
 if(typeof granted!=='boolean'||typeof role!=='string')throw new AdminError('Invalid role request.',422);
 if(!['admin','moderator',...(byId?['template_creator']:[])].includes(role))throw new AdminError('That role cannot be granted here.',400);
 const ref=byId?adminUuid(path[1]):remove?path[1]:body.username;if(typeof ref!=='string'||ref.length<3||ref.length>64)throw new AdminError('Invalid username.',422);
 const targetId=await adminTransaction(async db=>{
  const target=(await db.query<{id:string;is_admin:boolean}>(byId?'SELECT id,is_admin FROM users WHERE id=$1 FOR UPDATE':"SELECT id,is_admin FROM users WHERE lower(username)=$1 OR id::text=$1 OR account_id=$1 FOR UPDATE",[ref.trim().replace(/^@+/,'').toLowerCase()])).rows[0];if(!target)throw new AdminError('User not found.',404);
  const roles=(await db.query<{role:string}>('SELECT role FROM user_roles WHERE user_id=$1',[target.id])).rows.map(row=>row.role);
  const targetRole=target.is_admin||roles.includes('owner')||(process.env.MISA_ADMIN_USER_IDS||'').split(',').map(value=>value.trim()).includes(target.id)?'owner':roles.includes('admin')?'admin':roles.includes('moderator')?'moderator':null;
  if(role!=='template_creator'){
   if(targetRole==='owner')throw new AdminError('Owner roles cannot be changed here.',400);
   if(role==='admin'&&admin.staffRole!=='owner')throw new AdminError('Only owners can assign admin.',403);
   if(role==='moderator'&&!['owner','admin'].includes(admin.staffRole))throw new AdminError('You cannot assign moderator.',403);
   if(admin.staffRole==='admin'&&targetRole==='admin')throw new AdminError('Admins cannot change other admins.',403);
  }
  if(granted){if(role!=='template_creator')await db.query('DELETE FROM user_roles WHERE user_id=$1 AND role=$2',[target.id,role==='admin'?'moderator':'admin']);await db.query('INSERT INTO user_roles (user_id,role,granted_by) VALUES ($1,$2,$3) ON CONFLICT(user_id,role) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=NOW()',[target.id,role,admin.id]);}else await db.query('DELETE FROM user_roles WHERE user_id=$1 AND role=$2',[target.id,role]);
  await audit(db,admin.id,granted?'role.grant':'role.revoke','user',target.id,{role});return target.id;
 });
 return json({ok:true,role,granted,...(role==='template_creator'?{}:{user:targetId})},byName?201:200);
}
