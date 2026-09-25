import "server-only";
import type { NextRequest } from "next/server";
const apiKey = () => process.env.MISA_EMAIL_API_KEY || process.env.EMAIL_API_KEY || "";
const apiUrl = () => process.env.MISA_EMAIL_API_URL ?? process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";
export const mailerConfigured = () => Boolean(apiKey() && apiUrl());
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export async function sendAccountMail(to: string, kind: "email_change" | "email_notice" | "password_reset", url: string) {
  if (!mailerConfigured()) return false;
  const messages = {
    email_change: ["Confirm your new email", "Use this link to finish changing the email on your Misa.lol account. It expires in 24 hours.", "Confirm email", "Confirm your new Misa.lol email"],
    email_notice: ["Your email is being changed", "Someone requested a new email on this Misa.lol account. If that was not you, change your password and review active sessions.", "Open settings", "Your Misa.lol email is being changed"],
    password_reset: ["Reset your password", "Use this link to choose a new password. It expires in 30 minutes and can be used once.", "Choose a new password", "Reset your Misa.lol password"],
  };
  const [title, body, action, subject] = messages[kind];
  const text = `${title}\n\n${body}\n\n${action}: ${url}\n\nIf you did not ask for this, you can ignore this email.`;
  const html = `<!DOCTYPE html><html><body style="background:#0b0b10;color:#e8e6f0;font-family:Inter,Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:28px 24px;border-radius:16px;background:#12121a"><p>MISA.LOL</p><h1>${title}</h1><p>${body}</p><p><a href="${escapeHtml(url)}">${action}</a></p><p>If you did not ask for this, ignore this email.</p></div></body></html>`;
  try {
    const response = await fetch(apiUrl(), { method: "POST", redirect: "error", signal: AbortSignal.timeout(12000), headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: (process.env.MISA_EMAIL_FROM || process.env.EMAIL_FROM || "Misa.lol <no-reply@misa.lol>").trim().replace(/^"|"$/g, ""), to: [to], subject, html, text }) });
    return response.status < 400;
  } catch { return false; }
}
export function publicOrigin(request: NextRequest) {
  const configured = (process.env.MISA_PUBLIC_BASE_URL || "https://misa.lol").replace(/\/+$/, "");
  const host = ((request.headers.get("x-forwarded-host") || "").split(",")[0].trim() || request.headers.get("host") || new URL(request.url).host).split("@").pop()!.trim();
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "misa.lol" || hostname.endsWith(".misa.lol")) return "https://misa.lol";
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)) {
    const forwarded = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
    const proto = ["http", "https"].includes(forwarded) ? forwarded : (request.headers.get("cf-visitor") || "").includes("https") ? "https" : new URL(request.url).protocol.slice(0, -1);
    return `${proto}://${host}`;
  }
  return configured;
}
export const settingsPath = () => `${(process.env.MISA_DASHBOARD_URL || "/dashboard").replace(/\/+$/, "")}/settings`;
