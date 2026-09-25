import "server-only";
import type { NextRequest } from "next/server";
import { backupCodesLeft, mfaEnabled } from "./mfa";
import { one } from "./postgres";
import { currentUser } from "./sessions";
import { publicUser, userById } from "./users";
import { savedProfile } from "./profile-persistence";
import { readSwitcherIds, addSwitcherId } from "./account-security";
import { redis } from "./redis";

export function unwrapAccountProfile(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const nested = value.config;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && ["profile", "settings", "socials"].some(key => key in nested)) return nested;
  return ["profile", "settings", "socials"].some(key => key in value) ? value : null;
}

export async function accountPayload(request: NextRequest, includeProfile = true) {
  const user = await currentUser(request);
  if (!user) return null;
  const client = redis();
  if (client.status === "wait") await client.connect();
  const ids = readSwitcherIds(request);
  const accountIds = ids.includes(user.id) ? ids : addSwitcherId(ids, user.id);
  const [premium, mfa, codes, role, creator, profile, pendingEmail, people] = await Promise.all([
    one<{active: boolean}>("SELECT EXISTS(SELECT 1 FROM premium_entitlements WHERE user_id=$1 AND active=TRUE AND (expires_at IS NULL OR expires_at>NOW())) AS active", [user.id]).then(x => x?.active === true),
    mfaEnabled(user.id), backupCodesLeft(user.id),
    one<{role: string}>("SELECT role FROM user_roles WHERE user_id=$1 AND role IN ('owner','admin','moderator') ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1", [user.id]),
    one<{present: boolean}>("SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role='template_creator') AS present", [user.id]).then(x => x?.present === true),
    // Profile hydration is optional: storage trouble must not hide authenticated identity.
    includeProfile ? savedProfile(user.id).then(unwrapAccountProfile).catch(() => undefined) : Promise.resolve(undefined),
    client.get(`email_pending:${user.id}`),
    Promise.all(accountIds.map(id => id === user.id ? user : userById(id))),
  ]);
  const base = publicUser(user);
  const staffRole = base.is_admin ? "owner" : role?.role || null;
  return {
    ...base, premium, has_password: Boolean(user.password_hash), mfa_enabled: mfa,
    mfa_codes_left: mfa ? codes : 0, staff_role: staffRole, is_staff: Boolean(staffRole),
    is_template_creator: base.is_admin || creator, pending_email: pendingEmail || null,
    accounts: people.flatMap(person => person ? [{ id: person.id, username: person.username, display_name: person.display_name || person.username || person.email, avatar_url: person.avatar_url, current: person.id === user.id }] : []),
    ...(profile === undefined ? {} : { profile }),
  };
}
