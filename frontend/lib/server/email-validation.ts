import "server-only";
import { domainToASCII,domainToUnicode } from "node:url";
// Pydantic EmailStr-style normalization, followed by the application's lowercase policy.
// Never perform DNS checks on login or account forms.
export function normalizeAccountEmail(input:unknown):string|null {
 if(typeof input!=="string"||[...input].length>2048)return null;
 let value=input;
 const pretty=value.match(/^\s*(?:(?:[\p{L}\p{N}_!#$%&'*+\-/=?^`{|}~]+\s+)*[\p{L}\p{N}_!#$%&'*+\-/=?^`{|}~]+|"[^"]+")?\s*<(.+)>\s*$/u);
 if(pretty)value=pretty[1];value=value.trim();
 const parts=value.split('@');if(parts.length!==2)return null;
 const [rawLocal,rawDomain]=parts;
 const local=rawLocal.normalize('NFC');
 if(!local||local.startsWith('.')||local.endsWith('.')||local.includes('..')||/^[\p{M}]/u.test(local)||/[\p{C}\p{Z}]/u.test(local))return null;
 for(const char of local)if(char.codePointAt(0)!<128&&!/[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]/.test(char))return null;
 if(!rawDomain||/^[\p{M}]/u.test(rawDomain)||/[\p{C}\p{Z}]/u.test(rawDomain)||/[\x00-\x7f]/.test(rawDomain.replace(/[A-Za-z0-9.-]/g,'')))return null;
 const ascii=domainToASCII(rawDomain);if(!ascii||ascii.length>253||!ascii.includes('.')||!/[A-Za-z]$/.test(ascii))return null;
 const labels=ascii.split('.');if(labels.some(label=>!label||label.length>63||!(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))||(/^(?!xn)..--/i.test(label))))return null;
 if(['arpa','invalid','localhost','local','onion','test'].some(name=>ascii===name||ascii.endsWith('.'+name)))return null;
 const domain=domainToUnicode(ascii).normalize('NFC');
 // IDNA2008 does not permit symbol/emoji domain labels even if WHATWG can encode them.
 if(!domain||!/^[\p{L}\p{M}\p{N}.\-\u00b7\u0375\u05f3\u05f4\u30fb]+$/u.test(domain))return null;
 if(Buffer.byteLength(value,'utf8')>254||Buffer.byteLength(`${local}@${domain}`,'utf8')>254||Buffer.byteLength(`${local}@${ascii}`,'utf8')>254)return null;
 return `${local}@${domain}`.toLowerCase();
}
