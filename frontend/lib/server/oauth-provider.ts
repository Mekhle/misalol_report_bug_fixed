import "server-only";
import { createPublicKey, createPrivateKey, sign, verify, type JsonWebKey } from "node:crypto";
import type { OAuthProvider } from "./oauth-state";
const origin = () => (process.env.MISA_PUBLIC_BASE_URL || "https://misa.lol").replace(/\/+$/, "");
export const callbackUrl = (provider: OAuthProvider) => `${origin()}/api/v1/auth/${provider}/callback`;
export function providerSetting(provider: OAuthProvider, name: string) {
  const key = `${provider.toUpperCase()}_${name.toUpperCase()}`;
  return process.env[`MISA_${key}`] || (provider === "apple" ? process.env[key] : "") || "";
}
export function providerEnabled(provider: OAuthProvider) {
  if (provider === "telegram") return Boolean(providerSetting(provider,"bot_token") && providerSetting(provider,"bot_username"));
  if (provider === "apple") return Boolean(providerSetting(provider,"client_id"));
  return Boolean(providerSetting(provider,"client_id") && providerSetting(provider,"client_secret"));
}
export function authorizeUrl(provider: OAuthProvider, state: string, nonce: string) {
  if (provider === "telegram") return `https://oauth.telegram.org/auth?${new URLSearchParams({ bot_id: providerSetting(provider,"bot_token").split(":")[0], origin: origin(), request_access: "write", return_to: `${callbackUrl(provider)}?${new URLSearchParams({state})}` })}`;
  const params = new URLSearchParams({ client_id: providerSetting(provider,"client_id"), redirect_uri: callbackUrl(provider), response_type: provider === "apple" ? "code id_token" : "code", scope: provider === "google" ? "openid email profile" : provider === "discord" ? "identify email" : "name email", state });
  if (provider !== "discord") params.set("nonce", nonce);
  if (provider === "google") { params.set("access_type","online"); params.set("prompt","select_account"); }
  if (provider === "discord") params.set("prompt","consent");
  if (provider === "apple") params.set("response_mode","form_post");
  return `${provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : provider === "discord" ? "https://discord.com/api/oauth2/authorize" : "https://appleid.apple.com/auth/authorize"}?${params}`;
}
async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Provider request failed");
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid provider response");
  return data;
}
export function appleClientSecret() {
  const configured = providerSetting("apple","client_secret"); if (configured) return configured;
  const now = Math.floor(Date.now()/1000);
  const header = Buffer.from(JSON.stringify({kid:providerSetting("apple","key_id"),alg:"ES256",typ:"JWT"})).toString("base64url");
  const payload = Buffer.from(JSON.stringify({iss:providerSetting("apple","team_id"),iat:now,exp:now+2592000,aud:"https://appleid.apple.com",sub:providerSetting("apple","client_id")})).toString("base64url");
  const body = `${header}.${payload}`;
  const signature = sign("sha256",Buffer.from(body),{key:createPrivateKey(providerSetting("apple","private_key").replace(/\\n/g,"\n")),dsaEncoding:"ieee-p1363"});
  return `${body}.${signature.toString("base64url")}`;
}
export async function exchangeCode(provider: "google" | "discord" | "apple", code: string) {
  const url = provider === "google" ? "https://oauth2.googleapis.com/token" : provider === "discord" ? "https://discord.com/api/oauth2/token" : "https://appleid.apple.com/auth/token";
  return fetchJson(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"misa.lol (https://misa.lol)"},body:new URLSearchParams({code,client_id:providerSetting(provider,"client_id"),client_secret:provider === "apple" ? appleClientSecret() : providerSetting(provider,"client_secret"),redirect_uri:callbackUrl(provider),grant_type:"authorization_code"})});
}
const jwksCache = new Map<string,{expires:number;keys:(JsonWebKey & {kid?:string;use?:string;alg?:string})[]}>();
export async function verifyIdToken(provider: "google" | "apple", token: string, nonce: string) {
  const parts = token.split("."); if (parts.length !== 3) throw new Error("Invalid token");
  const header = JSON.parse(Buffer.from(parts[0],"base64url").toString());
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid algorithm");
  const url = provider === "google" ? "https://www.googleapis.com/oauth2/v3/certs" : "https://appleid.apple.com/auth/keys";
  let entry = jwksCache.get(provider);
  if (!entry || entry.expires < Date.now() || !entry.keys.some(key=>key.kid===header.kid)) {
    const data = await fetchJson(url);
    if (!Array.isArray(data.keys)) throw new Error("Invalid keys");
    entry = { expires: Date.now()+300000, keys: data.keys }; jwksCache.set(provider,entry);
  }
  const key = entry.keys.find(key=>key.kid===header.kid && key.kty==="RSA" && (!key.use || key.use==="sig") && (!key.alg || key.alg==="RS256"));
  if (!key || !verify("RSA-SHA256",Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key,format:"jwk"}),Buffer.from(parts[2],"base64url"))) throw new Error("Invalid signature");
  const claims = JSON.parse(Buffer.from(parts[1],"base64url").toString()) as Record<string,unknown>;
  const now = Date.now()/1000, audience = providerSetting(provider,"client_id");
  const issuers = provider === "google" ? ["accounts.google.com","https://accounts.google.com"] : ["https://appleid.apple.com"];
  if (!issuers.includes(String(claims.iss)) || !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud===audience) || typeof claims.exp!=="number" || claims.exp<=now || (claims.nbf!==undefined && (typeof claims.nbf!=="number" || claims.nbf>now)) || (claims.iat!==undefined && (typeof claims.iat!=="number" || claims.iat>now)) || typeof claims.sub!=="string" || !claims.sub || (nonce && claims.nonce!==nonce)) throw new Error("Invalid claims");
  return claims;
}
export async function discordProfile(accessToken: string) {
  return fetchJson("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${accessToken}`,"User-Agent":"misa.lol (https://misa.lol)"}});
}
