import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
// Fernet wire format used by app.core.discord_live: version, timestamp, IV, AES-CBC, HMAC.
function key() {
  const material = process.env.DATA_API_KEY || process.env.MISA_DATA_API_KEY || process.env.MISA_DISCORD_CLIENT_SECRET || process.env.MISA_APP_NAME || "misa";
  return createHash("sha256").update(`misa-discord-link:${material}`).digest();
}
export function encryptDiscordSecret(value: string) {
  const secret = key(), iv = randomBytes(16), header = Buffer.alloc(9);
  header[0] = 0x80;
  header.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 1);
  const cipher = createCipheriv("aes-128-cbc", secret.subarray(16), iv);
  const body = Buffer.concat([header, iv, cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([body, createHmac("sha256", secret.subarray(0, 16)).update(body).digest()]).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}
export function decryptDiscordSecret(value: string) {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 73 || bytes[0] !== 0x80) return null;
    const secret = key(), body = bytes.subarray(0, -32), signature = bytes.subarray(-32);
    const expected = createHmac("sha256", secret.subarray(0, 16)).update(body).digest();
    if (!timingSafeEqual(signature, expected)) return null;
    const decipher = createDecipheriv("aes-128-cbc", secret.subarray(16), bytes.subarray(9, 25));
    return Buffer.concat([decipher.update(bytes.subarray(25, -32)), decipher.final()]).toString("utf8");
  } catch { return null; }
}
