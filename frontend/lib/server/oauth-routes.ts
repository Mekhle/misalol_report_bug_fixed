import "server-only";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rememberSignupIp, requestIpIsBanned, userIsBanned } from "./account-bans";
import { publicOrigin } from "./account-mail";
import { rememberSwitcherUser } from "./account-security";
import { storeDiscordTokens } from "./discord-tokens";
import { apiError } from "./http";
import { createMfaTicket, mfaEnabled } from "./mfa";
import { authorizeUrl, discordProfile, exchangeCode, providerEnabled, providerSetting, verifyIdToken } from "./oauth-provider";
import { oauthDestination, popOAuthState, safeNextPath, saveOAuthState, trustedEmailClaim, verifyTelegramAuth, type OAuthProvider } from "./oauth-state";
import { OAuthConflict, upsertOAuthUser, type ProviderIdentity } from "./oauth-users";
import { withinLimit } from "./rate-limit";
import { nativeCoreEnabled } from "./rollout";
import { attachSession, createSession, currentUser, destroySession, SESSION_COOKIE } from "./sessions";
import { isSuspended, touchLogin } from "./users";
const redirect = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path,publicOrigin(request)),{status:302,headers:{"Cache-Control":"no-store"}});
function oauthError(request: NextRequest, path: string, error: string) {
  const url=new URL(path,publicOrigin(request));url.searchParams.set("error",error);return redirect(request,url.href);
}
export async function startOAuth(request: NextRequest, provider: OAuthProvider) {
  if(!nativeCoreEnabled())return apiError("Not found.",404);
  try {
    if(!await withinLimit(`rl:oauth:${clientIp(request)}`,20,60))return apiError("Too many attempts. Try again later.",429);
    const next=safeNextPath(request.nextUrl.searchParams.get("next")), link=request.nextUrl.searchParams.get("mode")==="link";
    const target=link?oauthDestination(true,next):"/login";
    if(!providerEnabled(provider))return oauthError(request,target,`${provider}_not_configured`);
    if(link&&!await currentUser(request))return oauthError(request,"/login","not_authenticated");
    const nonce=provider==="google"||provider==="apple"?randomBytes(24).toString("base64url"):"";
    const state=await saveOAuthState(provider,next,nonce,link?"link":"login");
    return redirect(request,authorizeUrl(provider,state,nonce));
  } catch { return oauthError(request,"/login","oauth_failed"); }
}
async function finishOAuth(request: NextRequest, identity: ProviderIdentity, next: string, link: boolean) {
  const current=await currentUser(request);
  if(link&&!current)return {response:oauthError(request,"/login","not_authenticated"),user:null};
  const destination=oauthDestination(Boolean(current),next);
  if(!current&&await requestIpIsBanned(request))return {response:oauthError(request,"/signup","account_banned"),user:null};
  let user;
  try { user=await upsertOAuthUser(identity,current?.id||null); }
  catch(error) { if(error instanceof OAuthConflict)return {response:oauthError(request,current?destination:"/login",error.message),user:null};throw error; }
  await rememberSignupIp(user.id,request);
  if(await userIsBanned(user))return {response:oauthError(request,"/login","account_banned"),user:null};
  if(isSuspended(user))return {response:oauthError(request,"/login","account_suspended"),user:null};
  if(current)return {response:redirect(request,destination),user};
  if(await mfaEnabled(user.id))return {response:redirect(request,`/login?mfa_ticket=${await createMfaTicket(user.id,true)}`),user};
  await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
  await touchLogin(user.id);
  const session=await createSession(user.id,request,true),response=redirect(request,destination);
  attachSession(response,request,session.token,session.ttl);rememberSwitcherUser(response,request,user.id);
  return {response,user};
}
const string = (value: unknown) => typeof value==="string"?value:null;
const telegramBridge = `<!DOCTYPE html><title>Signing in</title><script>(()=>{try{if(!location.hash.startsWith('#tgAuthResult='))throw 0;const raw=location.hash.slice(14);const data=JSON.parse(atob(raw+'='.repeat((4-raw.length%4)%4)));const query=new URLSearchParams();for(const [key,value] of Object.entries(data)){if(value!==null&&value!==undefined&&value!=='')query.set(key,String(value));}const state=new URLSearchParams(location.search).get('state');if(state)query.set('state',state);if(!query.get('id')||!query.get('hash'))throw 0;location.replace(location.pathname+'?'+query.toString());}catch{location.replace('/login?error=oauth_failed');}})();</script>`;
export async function callbackOAuth(request: NextRequest, provider: OAuthProvider) {
  if(!nativeCoreEnabled())return apiError("Not found.",404);
  try {
    let params=new URLSearchParams(request.nextUrl.searchParams);
    if(request.method==="POST") {
      const form=await request.formData();params=new URLSearchParams();for(const [key,value] of form)if(typeof value==="string")params.set(key,value);
    }
    if(provider==="telegram") {
      if(!providerEnabled(provider))return oauthError(request,"/login","telegram_not_configured");
      if(!params.get("hash"))return new NextResponse(telegramBridge,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
      if(!verifyTelegramAuth(Object.fromEntries(params),providerSetting(provider,"bot_token")))return oauthError(request,"/login","oauth_failed");
    }
    const saved=await popOAuthState(params.get("state")||"",provider);
    if(!saved)return oauthError(request,"/login","oauth_failed");
    const next=safeNextPath(saved.next),link=saved.mode==="link",target=link?oauthDestination(true,next):"/login";
    if(params.get("error")||(provider!=="telegram"&&!params.get("code")&&!(provider==="apple"&&params.get("id_token"))))return oauthError(request,target,"oauth_denied");
    let identity:ProviderIdentity,tokens:Record<string,unknown>={};
    try {
      if(provider==="telegram") {
        const id=params.get("id");if(!id)throw new Error("Missing ID");
        identity={provider,providerId:id,email:null,emailVerified:false,displayName:`${params.get("first_name")||""} ${params.get("last_name")||""}`.trim()||params.get("username"),avatarUrl:params.get("photo_url"),telegramUsername:params.get("username")};
      } else if(provider==="discord") {
        tokens=await exchangeCode(provider,params.get("code")||"");if(typeof tokens.access_token!=="string")throw new Error("Missing token");
        const profile=await discordProfile(tokens.access_token),id=string(profile.id);if(!id)throw new Error("Missing ID");
        identity={provider,providerId:id,email:string(profile.email)?.trim().toLowerCase()||null,emailVerified:trustedEmailClaim(profile.verified),displayName:string(profile.global_name)||string(profile.username),avatarUrl:profile.avatar?`https://cdn.discordapp.com/avatars/${id}/${profile.avatar}.png`:null};
      } else {
        let claims:Record<string,unknown>|null=null;
        if(provider==="apple"&&params.get("id_token")){try{claims=await verifyIdToken(provider,params.get("id_token")!,saved.nonce);}catch{}}
        if(!claims){tokens=await exchangeCode(provider,params.get("code")||"");if(typeof tokens.id_token!=="string")throw new Error("Missing token");claims=await verifyIdToken(provider,tokens.id_token,saved.nonce);}
        const email=string(claims.email)?.trim().toLowerCase()||null;
        let name=string(claims.name);
        if(provider==="apple") {
          try { const data=JSON.parse(params.get("user")||"{}");name=`${typeof data.name?.firstName==="string"?data.name.firstName:""} ${typeof data.name?.lastName==="string"?data.name.lastName:""}`.trim()||null; }catch{}
          name=name||email?.split("@")[0]||null;
        }
        identity={provider,providerId:String(claims.sub),email,emailVerified:trustedEmailClaim(claims.email_verified),displayName:name,avatarUrl:provider==="google"?string(claims.picture):null};
      }
    } catch { return oauthError(request,target,"oauth_failed"); }
    const {response,user}=await finishOAuth(request,identity,next,link);
    if(provider==="discord"&&user)await storeDiscordTokens(user.id,identity.providerId,tokens).catch(()=>undefined);
    return response;
  } catch { return oauthError(request,"/login","oauth_failed"); }
}
