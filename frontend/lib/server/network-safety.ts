import "server-only";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd00:")) return true;
  if (lower.startsWith("::ffff:")) {
    return isPrivateIp(lower.slice(7));
  }
  return false;
}

export function hostIsPublic(host: string): boolean {
  const normalized = (host || "").trim().replace(/\.+$/, "").toLowerCase();
  if (!normalized || BLOCKED_HOSTS.has(normalized)) return false;
  for (const suffix of BLOCKED_SUFFIXES) {
    if (normalized.endsWith(suffix)) return false;
  }
  if (isIP(normalized)) {
    return !isPrivateIp(normalized);
  }
  if (/^[0-9.]+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) return false;
  return normalized.includes(".");
}

export function safePublicUrl(
  value: unknown,
  options: { allowedHosts?: Iterable<string>; httpsOnly?: boolean } = {}
): string | null {
  const text = String(value || "").trim();
  if (!text || text.length > 2000) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  const httpsOnly = options.httpsOnly !== false;
  if (httpsOnly && parsed.protocol !== "https:") return null;
  if (!httpsOnly && parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  if (!hostIsPublic(host)) return null;

  const expectedPort = parsed.protocol === "https:" ? "443" : "80";
  if (parsed.port && parsed.port !== expectedPort) return null;

  if (options.allowedHosts) {
    const allowed = new Set(Array.from(options.allowedHosts).map((h) => h.toLowerCase()));
    if (!allowed.has(host)) return null;
  }
  return text;
}
