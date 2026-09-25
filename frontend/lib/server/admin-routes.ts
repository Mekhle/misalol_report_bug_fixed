import "server-only";
import { adminPremiumRoute } from "./admin-premium";
import { adminBanRoute } from "./admin-bans";
import { adminUsersRoute } from "./admin-users";
import { adminTemplatesRoute } from "./admin-templates";
import { adminVerificationRoute } from "./admin-verification";
import { adminBadgesRoute } from "./admin-badges";
import { adminConstellationsRoute } from "./admin-constellations";
import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { AdminError } from "./admin-auth";
import { adminTransaction,adminUuid,audit,authorizeAdmin,sectionAccess,STAFF_SECTIONS } from "./admin-operations";
import { apiError } from "./http";
import { database,one } from "./postgres";
import { nativeCoreEnabled } from "./rollout";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
function text(value:unknown,min:number,max:number){if(typeof value!=='string'||value.length<min||value.length>max)throw new AdminError('Invalid request.',422);return value;}
function bool(value:unknown,fallback?:boolean){if(value===undefined&&fallback!==undefined)return fallback;if(typeof value!=='boolean')throw new AdminError('Invalid request.',422);return value;}
const listings:Record<string,[string,string]>={
 'reserved-usernames':['reserved','SELECT username,reason,created_by,created_at FROM reserved_usernames ORDER BY username'],
 'banned-words':['words','SELECT word,reason,created_by,created_at FROM banned_username_words ORDER BY word'],
 reports:['reports','SELECT id,reporter_user_id,target_user_id,target_username,reason,details,status,reviewed_by,reviewed_at,created_at FROM reports ORDER BY created_at DESC LIMIT 200'],
 'feature-flags':['flags','SELECT key,enabled,description,updated_by,updated_at FROM feature_flags ORDER BY key'],
 'audit-logs':['logs','SELECT id,actor_user_id,action,target_type,target_id,metadata,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 300'],
 bakaboost:['connections','SELECT user_id,provider,external_id,status,metadata,connected_at,updated_at FROM bakaboost_connections ORDER BY updated_at DESC'],
 themes:['themes','SELECT id,name,config,active,created_by,updated_by,created_at,updated_at FROM theme_presets ORDER BY name'],
};
async function fonts(){return (await database().query<{slot:number;name:string;data_url:string;mime_type:string;updated_at:string}>('SELECT slot,name,data_url,mime_type,updated_at FROM default_profile_fonts ORDER BY slot')).rows.map(row=>({id:`font-${row.slot}`,slot:row.slot,name:row.name,url:row.data_url,mimeType:row.mime_type,updatedAt:row.updated_at}));}
export async function adminRoute(request:NextRequest,path:string[]){
 if(!nativeCoreEnabled())return apiError('Not found.',404);
 try{
  const admin=await authorizeAdmin(request,path),route=path.join('/'),method=request.method;
  const extra=await adminPremiumRoute(request,path,admin)||await adminBanRoute(request,path,admin)||await adminUsersRoute(request,path,admin)||await adminTemplatesRoute(request,path,admin)||await adminVerificationRoute(request,path,admin)||await adminBadgesRoute(request,path,admin)||await adminConstellationsRoute(request,path,admin);if(extra)return extra;
  if(method==='GET'&&listings[route]){const [key,sql]=listings[route];return json({[key]:(await database().query(sql)).rows});}
  if(route==='access'&&method==='GET'){const access=await sectionAccess();return json({role:admin.staffRole,sections:admin.staffRole==='owner'?STAFF_SECTIONS:STAFF_SECTIONS.filter(key=>access[admin.staffRole]?.[key]),...(admin.staffRole==='owner'?{access}:{})});}
  if(route==='access'&&method==='PUT'){
   const body=await request.json();if(!['admin','moderator'].includes(body.role))throw new AdminError('Pick admin or moderator.',400);
   if(!body.sections||typeof body.sections!=='object'||Array.isArray(body.sections))throw new AdminError('Invalid sections.',422);
   const sections=Object.fromEntries(Object.entries(body.sections).filter(([key])=>STAFF_SECTIONS.includes(key)).map(([key,value])=>[key,bool(value)]));
   await adminTransaction(async db=>{for(const [section,enabled]of Object.entries(sections))await db.query('INSERT INTO staff_section_access (role,section,enabled) VALUES ($1,$2,$3) ON CONFLICT(role,section) DO UPDATE SET enabled=EXCLUDED.enabled',[body.role,section,enabled]);await audit(db,admin.id,'staff_access.update','role',body.role,{sections});});return json({ok:true,role:body.role,sections:(await sectionAccess())[body.role]});
  }
  if(['reserved-usernames','banned-words'].includes(route)&&method==='POST'){
   const body=await request.json(),reserved=route==='reserved-usernames';const value=text(reserved?body.username:body.word,reserved?3:2,reserved?32:24).trim().toLowerCase(),reason=body.reason==null?null:text(body.reason,0,500);
   if(!reserved&&!/^[a-z0-9_]{2,24}$/.test(value))throw new AdminError('Use 2-24 letters, numbers, or underscores.',400);
   try{await adminTransaction(async db=>{await db.query(`INSERT INTO ${reserved?'reserved_usernames':'banned_username_words'} (${reserved?'username':'word'},reason,created_by) VALUES ($1,$2,$3)`,[value,reason,admin.id]);await audit(db,admin.id,reserved?'reserved_username.create':'banned_word.create',reserved?'reserved_username':'banned_word',value,{reason});});}catch(error){if((error as {code?:string}).code==='23505')throw new AdminError(reserved?'That username is already reserved.':'That word is already banned.',409);throw error;}return json({ok:true},201);
  }
  if(path.length===2&&['reserved-usernames','banned-words'].includes(path[0])&&method==='DELETE'){
   const reserved=path[0]==='reserved-usernames',value=path[1].trim().toLowerCase();if(!reserved&&!/^[a-z0-9_]{2,24}$/.test(value))throw new AdminError('Banned word not found.',404);
   if(reserved&&await one('SELECT 1 FROM username_history WHERE lower(old_username)=$1 LIMIT 1',[value]))throw new AdminError('Former usernames stay reserved so old links keep working.',409);
   await adminTransaction(async db=>{const result=await db.query(`DELETE FROM ${reserved?'reserved_usernames':'banned_username_words'} WHERE ${reserved?'username':'word'}=$1`,[value]);if(!result.rowCount)throw new AdminError(reserved?'Reserved username not found.':'Banned word not found.',404);await audit(db,admin.id,reserved?'reserved_username.delete':'banned_word.delete',reserved?'reserved_username':'banned_word',value);});return json({ok:true});
  }
  if(path.length===2&&path[0]==='feature-flags'&&method==='PUT'){
   const body=await request.json(),enabled=bool(body.enabled),description=text(body.description??'',0,500);
   await adminTransaction(async db=>{await db.query('INSERT INTO feature_flags (key,enabled,description,updated_by,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT(key) DO UPDATE SET enabled=EXCLUDED.enabled,description=EXCLUDED.description,updated_by=EXCLUDED.updated_by,updated_at=NOW()',[path[1],enabled,description,admin.id]);await audit(db,admin.id,'feature_flag.update','feature_flag',path[1],{enabled});});return json({ok:true});
  }
  if(path.length===2&&path[0]==='reports'&&method==='PATCH'){
   const body=await request.json(),id=adminUuid(path[1]);if(!['open','reviewed','resolved','dismissed'].includes(body.status))throw new AdminError('Invalid status.',422);
   await adminTransaction(async db=>{if(!(await db.query('UPDATE reports SET status=$2,reviewed_by=$3,reviewed_at=NOW() WHERE id=$1',[id,body.status,admin.id])).rowCount)throw new AdminError('Report not found.',404);await audit(db,admin.id,'report.update','report',id,{status:body.status});});return json({ok:true});
  }
  if(route==='themes'&&method==='POST'){
   const body=await request.json(),name=text(body.name,1,128),active=bool(body.active,true),config=body.config??{},id=randomUUID();if(!config||typeof config!=='object'||Array.isArray(config))throw new AdminError('Invalid configuration.',422);
   await adminTransaction(async db=>{await db.query('INSERT INTO theme_presets (id,name,config,active,created_by,updated_by) VALUES ($1,$2,$3::jsonb,$4,$5,$5) ON CONFLICT(name) DO UPDATE SET config=EXCLUDED.config,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=NOW()',[id,name,JSON.stringify(config),active,admin.id]);await audit(db,admin.id,'theme_preset.save','theme_preset',name,{active});});return json({id},201);
  }
  if(route==='fonts'&&method==='GET')return json({fonts:await fonts()});
  if(path.length===2&&path[0]==='fonts'&&['PUT','DELETE'].includes(method)){
   const slot=Number(path[1]);if(!Number.isInteger(slot)||slot<2||slot>11)throw new AdminError('Font slot must be between 2 and 11.',400);
   if(method==='DELETE'){await adminTransaction(async db=>{if(!(await db.query('DELETE FROM default_profile_fonts WHERE slot=$1',[slot])).rowCount)throw new AdminError('Font slot is already empty.',404);await audit(db,admin.id,'default_font.delete','default_font',`font-${slot}`);});return json({ok:true});}
   const body=await request.json(),name=text(body.name,1,80).trim(),url=text(body.data_url,32,2800000);text(body.mime_type,3,80);
   const match=url.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);const allowed=['font/woff2','font/woff','font/ttf','font/otf','font/opentype','application/font-woff2','application/font-woff','application/x-font-ttf','application/x-font-otf','application/vnd.ms-opentype'];if(!match||!allowed.includes(match[1].toLowerCase()))throw new AdminError('Upload a WOFF2, WOFF, TTF, or OTF font.',400);const encoded=match[2].replace(/\s/g,'');const decoded=Buffer.from(encoded,'base64');if(!decoded.length||decoded.toString('base64')!==encoded)throw new AdminError('Upload a WOFF2, WOFF, TTF, or OTF font.',400);if(decoded.length>2000000)throw new AdminError('Font must be smaller than 2 MB.',413);
   await adminTransaction(async db=>{await db.query('INSERT INTO default_profile_fonts (slot,name,data_url,mime_type,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT(slot) DO UPDATE SET name=EXCLUDED.name,data_url=EXCLUDED.data_url,mime_type=EXCLUDED.mime_type,updated_by=EXCLUDED.updated_by,updated_at=NOW()',[slot,name,url,match[1].toLowerCase(),admin.id]);await audit(db,admin.id,'default_font.save','default_font',`font-${slot}`,{name});});return json({ok:true,fonts:await fonts()});
  }
  if(path.length===3&&path[0]==='users'&&path[2]==='suspension'&&method==='PATCH'){
   const id=adminUuid(path[1]),body=await request.json(),suspended=bool(body.suspended),reason=body.reason==null?null:text(body.reason,0,500),until=body.until==null?null:new Date(body.until);if(until&&Number.isNaN(until.getTime()))throw new AdminError('Invalid date.',422);
   await adminTransaction(async db=>{if(!(await db.query('UPDATE users SET suspended_at=CASE WHEN $2 THEN NOW() ELSE NULL END,suspension_reason=CASE WHEN $2 THEN $3 ELSE NULL END,suspended_until=CASE WHEN $2 THEN $4 ELSE NULL END,updated_at=NOW() WHERE id=$1',[id,suspended,reason,until])).rowCount)throw new AdminError('User not found.',404);await audit(db,admin.id,suspended?'user.suspend':'user.unsuspend','user',id,{reason,until:until?.toISOString()||null});});return json({ok:true});
  }
  return apiError('Not found.',404);
 }catch(error){return error instanceof AdminError?apiError(error.message,error.status):error instanceof SyntaxError?apiError('Invalid request.',422):apiError('Admin storage is temporarily unavailable.',503);}
}
