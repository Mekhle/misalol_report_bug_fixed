import { dashboardRequest, peekDashboardCache, setDashboardCache } from "./dashboard-cache";

export interface AccountSession {
  id: string;
  created_at?: string | null;
  last_seen_at?: string | null;
  user_agent?: string;
  ip?: string;
  current?: boolean;
}

export interface SwitcherAccount {
  id: string;
  username: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  current?: boolean;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as { detail?: unknown; error?: string };
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : String(data.error || "Request failed."));
  }
  return data as Record<string, unknown>;
}

export async function requestEmailChange(email: string, password: string) {
  return readJson(await fetch("/api/v1/me/email", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
}

export async function changePassword(currentPassword: string, password: string, confirmPassword: string) {
  return readJson(await fetch("/api/v1/me/password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, password, confirm_password: confirmPassword }),
  }));
}

const SESSIONS_CACHE_KEY = "security:sessions";

export function peekSessions() {
  return peekDashboardCache<AccountSession[]>(SESSIONS_CACHE_KEY);
}

export function fetchSessions(force = false) {
  return dashboardRequest(SESSIONS_CACHE_KEY, async () => {
    const data = await readJson(await fetch("/api/v1/me/sessions", { credentials: "include", cache: "no-store" }));
    return (Array.isArray(data.sessions) ? data.sessions : []) as AccountSession[];
  }, { maxAge: 60_000, force });
}

export async function revokeSessions(input: { sessionId?: string; others?: boolean }) {
  const data = await readJson(await fetch("/api/v1/me/sessions/revoke", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: input.sessionId || "", others: Boolean(input.others) }),
  }));
  const sessions = (Array.isArray(data.sessions) ? data.sessions : []) as AccountSession[];
  return setDashboardCache(SESSIONS_CACHE_KEY, sessions);
}

export async function rotateBackupCodes(password: string) {
  const data = await readJson(await fetch("/api/v1/me/mfa/backup-codes", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }));
  return {
    codes: Array.isArray(data.codes) ? data.codes.map(String) : [],
    left: Number(data.mfa_codes_left || 0),
  };
}

export async function disableMfa(password: string) {
  return readJson(await fetch("/api/v1/me/mfa/disable", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }));
}

export async function switchAccount(userId: string) {
  const data = await readJson(await fetch("/api/v1/auth/switch", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  }));
  window.location.assign(String(data.redirect || "/dashboard"));
}

export async function forgetSwitcherAccount(userId: string) {
  return readJson(await fetch("/api/v1/auth/switcher/forget", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  }));
}

export function sessionLabel(session: AccountSession) {
  const agent = session.user_agent || "";
  if (/iPhone|iPad|iPod/i.test(agent)) return "iOS";
  if (/Android/i.test(agent)) return "Android";
  if (/Macintosh|Mac OS/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Linux/i.test(agent)) return "Linux";
  return agent.slice(0, 48) || "Unknown device";
}

export function formatWhen(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}
