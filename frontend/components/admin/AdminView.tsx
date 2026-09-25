"use client";

import { useEffect, useRef, useState } from "react";

import { Ban, Database, Flag, KeyRound, Orbit, Search, ShieldCheck, ShieldOff, Type, Upload, Users } from "lucide-react";
import { Button, FieldLabel, Modal, PageHeader, SectionTitle, TextInput } from "@/components/ui";
import { AchievementAdmin } from "@/components/admin/AchievementAdmin";
import { useT } from "@/lib/i18n";
import { assetFromFile } from "@/lib/profile-store";
import { FONT_ACCEPT } from "@/lib/typography";

type Tab = "users" | "bans" | "reserved" | "banned" | "badges" | "premium" | "reports" | "flags" | "bakaboost" | "themes" | "templates" | "fonts" | "audit" | "staff" | "roles" | "constellations";
type StaffRole = "owner" | "admin" | "moderator";
type AdminSession = { id: string; email: string; name: string; role: string; permissions: Record<string, boolean>; status: string; suspended: boolean };
const SECTION_TABS: Tab[] = ["users", "constellations", "bans", "reserved", "banned", "badges", "premium", "reports", "flags", "bakaboost", "themes", "templates", "fonts", "audit"];
const tabs: Array<[Tab, string]> = [["users", "Users"], ["constellations", "Constellations"], ["bans", "Bans"], ["reserved", "Reserved names"], ["banned", "Banned words"], ["badges", "Badges"], ["premium", "Premium"], ["reports", "Reports"], ["flags", "Feature flags"], ["bakaboost", "BakaBoost"], ["themes", "Themes"], ["templates", "Templates"], ["fonts", "Default fonts"], ["audit", "Audit logs"], ["staff", "Staff"], ["roles", "Roles"]];

function adminLoginPath(): string {
  const host = window.location.hostname;
  return host === "misa.lol" || host === "www.misa.lol" ? "/login" : "/m/login";
}
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/v1/admin${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({})) as { detail?: string; error?: string };
  if (!response.ok) throw new Error(body.detail || body.error || "Admin request failed.");
  return body as Record<string, any>;
}

export function AdminView() {
  const t = useT();

  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [adminReady, setAdminReady] = useState(false);
  const [tab, setTab] = useState<Tab>("users");
  const [role, setRole] = useState<StaffRole | null>(null);
  const [sections, setSections] = useState<Tab[]>(SECTION_TABS);
  const [accessReady, setAccessReady] = useState(false);
  const tabLabel: Record<Tab, string> = { users: t("admin.users"), constellations: "Constellations", bans: t("admin.bans"), reserved: t("admin.reserved"), banned: t("admin.banned"), badges: t("admin.badges"), premium: t("admin.premium"), reports: t("admin.reports"), flags: t("admin.flags"), bakaboost: t("admin.bakaboost"), themes: t("admin.themes"), templates: t("admin.templates"), fonts: "Default fonts", audit: t("admin.audit"), staff: t("admin.staff"), roles: t("admin.roles") };
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/admin-auth/session", { credentials: "include", cache: "no-store", headers: { "Cache-Control": "no-store" } })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json() as { admin?: AdminSession };
        return body.admin || null;
      })
      .then((currentAdmin) => {
        if (cancelled) return;
        if (!currentAdmin) {
          window.location.replace(adminLoginPath());
          return;
        }
        setAdmin(currentAdmin);
        setAdminReady(true);
      })
      .catch(() => { if (!cancelled) window.location.replace(adminLoginPath()); })
      .finally(() => { if (!cancelled) setAdminReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!adminReady || !admin) return;
    void api("/access").then((r) => {
      const nextRole = r.role === "owner" || r.role === "admin" || r.role === "moderator" ? r.role : null;
      const nextSections = Array.isArray(r.sections) ? r.sections.filter((item: string): item is Tab => SECTION_TABS.includes(item as Tab)) : SECTION_TABS;
      setRole(nextRole);
      setSections(nextRole === "owner" ? SECTION_TABS : nextSections);
      setAccessReady(true);
    }).catch(() => setAccessReady(true));
  }, [admin, adminReady]);
  const visible = tabs.filter(([id]) => {
    if (id === "roles") return role === "owner";
    if (id === "staff") return role === "owner" || role === "admin";
    return role === "owner" || sections.includes(id);
  });
  useEffect(() => {
    if (!accessReady || !visible.length) return;
    if (!visible.some(([id]) => id === tab)) setTab(visible[0][0]);
  }, [accessReady, tab, visible]);
  if (!adminReady || !admin) return <main className="mx-auto max-w-[1200px] px-5 py-12 text-zinc-500">{t("admin.loading")}</main>;
  return <main className="mx-auto min-h-screen max-w-[1400px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12"><PageHeader eyebrow={t("admin.eyebrow")} title={t("admin.title")} description={t("admin.description")} /><div className="mb-8 flex flex-wrap gap-2">{visible.map(([id]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-xl border px-3 py-2 text-xs ${tab === id ? "border-[#e11d48]/50 bg-[#e11d48]/15 text-white" : "border-white/[.08] text-zinc-500 hover:text-white"}`}>{tabLabel[id]}</button>)}</div>{tab === "users" && <UsersPanel staffRole={role} />}{tab === "constellations" && <ConstellationsPanel staffRole={role} />}{tab === "bans" && <BansPanel />}{tab === "reserved" && <ReservedPanel />}{tab === "banned" && <BannedPanel />}{tab === "badges" && <AchievementAdmin />}{tab === "premium" && <PremiumPanel />}{tab === "reports" && <ReportsPanel />}{tab === "flags" && <FlagsPanel />}{tab === "bakaboost" && <BakaBoostPanel />}{tab === "themes" && <ThemesPanel />}{tab === "templates" && <TemplatesPanel />}{tab === "fonts" && <DefaultFontsPanel />}{tab === "audit" && <AuditPanel />}{tab === "staff" && (role === "owner" || role === "admin") && <StaffPanel staffRole={role} />}{tab === "roles" && role === "owner" && <RolesPanel />}</main>;
}

function UsersPanel({ staffRole }: { staffRole: StaffRole | null }) {
  const t = useT();
  const [search, setSearch] = useState(""); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => void api(`/users?search=${encodeURIComponent(search)}`).then((r) => setItems(r.users || [])).catch((e) => setError(e.message)); useEffect(load, []);
  const suspend = async (item: any) => { const suspended = !item.suspended_at; if (!window.confirm(`${suspended ? "Suspend" : "Unsuspend"} this user?`)) return; try { await api(`/users/${item.id}/suspension`, { method: "PATCH", body: JSON.stringify({ suspended, reason: suspended ? "Administrative action" : null }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); } };
  const toggleCreator = async (item: any) => { try { await api(`/users/${item.id}/roles`, { method: "PATCH", body: JSON.stringify({ role: "template_creator", granted: !item.is_template_creator }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update creator role."); } };
  const setStaff = async (item: any, role: "admin" | "moderator", granted: boolean) => { try { await api(`/users/${item.id}/roles`, { method: "PATCH", body: JSON.stringify({ role, granted }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update role."); } };
  const roleText = (item: any) => item.staff_role === "owner" ? t("admin.owner") : item.staff_role === "admin" ? t("admin.adminRole") : item.staff_role === "moderator" ? t("admin.moderatorRole") : item.is_template_creator || item.is_admin ? (item.is_admin ? "Admin" : "Creator") : "No";
  return <section><SectionTitle icon={Users} title={t("admin.users")} description={t("admin.usersDesc")} /><div className="mb-4 flex gap-2"><div className="relative max-w-lg flex-1"><Search size={15} className="absolute left-3 top-3.5 text-zinc-600" /><TextInput value={search} onChange={setSearch} placeholder={t("admin.searchUsers")} className="pl-9" /></div><Button variant="accent" onClick={load}>{t("common.search")}</Button></div>{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface overflow-x-auto rounded-2xl"><table className="w-full min-w-[900px] text-left text-xs"><thead className="border-b border-white/[.06] text-zinc-600"><tr><th className="p-4">User</th><th className="p-4">Email</th><th className="p-4">Providers</th><th className="p-4">State</th><th className="p-4">Creator</th><th className="p-4">Action</th></tr></thead><tbody className="divide-y divide-white/[.06]">{items.map((item) => <tr key={item.id}><td className="p-4"><p className="text-zinc-200">@{item.username || "unclaimed"}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{item.id}</p></td><td className="p-4 text-zinc-400">{item.email || "—"}</td><td className="p-4 text-zinc-500">{Object.entries(item.providers || {}).filter(([, value]) => value).map(([key]) => key).join(", ") || "email"}</td><td className="p-4">{item.suspended_at ? <span className="text-red-300">Suspended</span> : <span className="text-emerald-400">Active</span>}</td><td className="p-4">{item.staff_role || item.is_template_creator || item.is_admin ? <span className="text-[#b6aaff]">{roleText(item)}</span> : <span className="text-zinc-600">No</span>}</td><td className="p-4"><div className="flex flex-wrap gap-2"><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void suspend(item)}>{item.suspended_at ? "Unsuspend" : "Suspend"}</Button><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void toggleCreator(item)}>{item.is_template_creator ? "Revoke creator" : "Grant creator"}</Button>{staffRole === "owner" && item.staff_role !== "owner" && <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void setStaff(item, "admin", item.staff_role !== "admin")}>{item.staff_role === "admin" ? t("admin.revokeAdmin") : t("admin.grantAdmin")}</Button>}{(staffRole === "owner" || staffRole === "admin") && item.staff_role !== "owner" && item.staff_role !== "admin" && <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void setStaff(item, "moderator", item.staff_role !== "moderator")}>{item.staff_role === "moderator" ? t("admin.revokeMod") : t("admin.grantMod")}</Button>}</div></td></tr>)}</tbody></table>{!items.length && <p className="p-8 text-center text-xs text-zinc-600">No users found.</p>}</div></section>;
}

function StaffPanel({ staffRole }: { staffRole: StaffRole }) {
  const t = useT();
  const canAdmin = staffRole === "owner";
  const [items, setItems] = useState<any[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">(canAdmin ? "admin" : "moderator");
  const [error, setError] = useState("");
  const load = () => void api("/staff").then((r) => setItems(r.staff || [])).catch((e) => setError(e.message));
  useEffect(load, []);
  const assign = async () => {
    try {
      await api("/staff", { method: "POST", body: JSON.stringify({ username, role, granted: true }) });
      setUsername("");
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign that role.");
    }
  };
  const remove = async (item: any) => {
    if (!window.confirm(`Remove ${item.staff_role} from @${item.username || item.id}?`)) return;
    try {
      await api(`/staff/${encodeURIComponent(item.username || item.id)}?role=${encodeURIComponent(item.staff_role)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that role.");
    }
  };
  return (
    <section>
      <SectionTitle icon={ShieldCheck} title={t("admin.staffTitle")} description={t("admin.staffDesc")} />
      <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_auto_auto]">
        <TextInput value={username} onChange={setUsername} placeholder={t("admin.staffUsername")} />
        <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "moderator")} className="h-11 rounded-xl border border-white/[.08] bg-white/[.04] px-3 text-sm text-zinc-200 outline-none">
          {canAdmin && <option value="admin">{t("admin.adminRole")}</option>}
          <option value="moderator">{t("admin.moderatorRole")}</option>
        </select>
        <Button variant="accent" onClick={() => void assign()}>{t("admin.staffAssign")}</Button>
      </div>
      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
      <div className="surface divide-y divide-white/[.06] rounded-2xl">
        {(staffRole === "admin" ? items.filter((item) => item.staff_role === "moderator") : items).map((item) => (
          <div key={`${item.id}-${item.staff_role}`} className="flex items-center gap-3 p-4">
            <span className="flex-1 text-sm text-zinc-200">
              @{item.username || "unclaimed"}
              <span className="ms-3 text-xs text-[#b6aaff]">{item.staff_role === "admin" ? t("admin.adminRole") : t("admin.moderatorRole")}</span>
            </span>
            <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void remove(item)}>{t("common.remove")}</Button>
          </div>
        ))}
        {!(staffRole === "admin" ? items.filter((item) => item.staff_role === "moderator") : items).length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.staffEmpty")}</p>}
      </div>
    </section>
  );
}

function RolesPanel() {
  const t = useT();
  const labels: Record<string, string> = { users: t("admin.users"), constellations: "Constellations", bans: t("admin.bans"), reserved: t("admin.reserved"), banned: t("admin.banned"), badges: t("admin.badges"), premium: t("admin.premium"), reports: t("admin.reports"), flags: t("admin.flags"), bakaboost: t("admin.bakaboost"), themes: t("admin.themes"), templates: t("admin.templates"), audit: t("admin.audit") };
  const empty = { admin: Object.fromEntries(SECTION_TABS.map((id) => [id, true])), moderator: Object.fromEntries(SECTION_TABS.map((id) => [id, true])) };
  const [access, setAccess] = useState<Record<string, Record<string, boolean>>>(empty);
  const [error, setError] = useState("");
  const load = () => void api("/access").then((r) => { if (r.access) setAccess({ admin: { ...empty.admin, ...(r.access.admin || {}) }, moderator: { ...empty.moderator, ...(r.access.moderator || {}) } }); }).catch((e) => setError(e.message));
  useEffect(load, []);
  const toggle = async (role: "admin" | "moderator", section: string) => {
    const next = { ...access[role], [section]: !access[role][section] };
    setAccess((current) => ({ ...current, [role]: next }));
    try {
      await api("/access", { method: "PUT", body: JSON.stringify({ role, sections: next }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update access.");
      load();
    }
  };
  return (
    <section>
      <SectionTitle icon={ShieldCheck} title={t("admin.rolesTitle")} description={t("admin.rolesDesc")} />
      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {(["admin", "moderator"] as const).map((role) => (
          <div key={role} className="surface rounded-2xl p-5">
            <h3 className="mb-4 text-sm font-medium text-white">{role === "admin" ? t("admin.rolesAdmin") : t("admin.rolesModerator")}</h3>
            <div className="divide-y divide-white/[.06]">
              {SECTION_TABS.map((section) => (
                <div key={section} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm text-zinc-300">{labels[section]}</span>
                  <button type="button" onClick={() => void toggle(role, section)} className={`relative h-6 w-11 rounded-full transition ${access[role][section] ? "bg-[#e11d48]" : "bg-white/10"}`} aria-pressed={access[role][section]}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${access[role][section] ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReservedPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [username, setUsername] = useState(""); const [reason, setReason] = useState(""); const [error, setError] = useState(""); const load = () => void api("/reserved-usernames").then((r) => setItems(r.reserved || [])).catch((e) => setError(e.message)); useEffect(load, []); const add = async () => { try { await api("/reserved-usernames", { method: "POST", body: JSON.stringify({ username, reason }) }); setUsername(""); setReason(""); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not reserve username."); } }; const remove = async (value: string) => { if (!window.confirm(`Remove ${value}?`)) return; try { await api(`/reserved-usernames/${encodeURIComponent(value)}`, { method: "DELETE" }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove username."); } }; return <section><SectionTitle icon={KeyRound} title={t("admin.reservedTitle")} description={t("admin.reservedDesc")} /><div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_1fr_auto]"><TextInput value={username} onChange={setUsername} placeholder="username" /><TextInput value={reason} onChange={setReason} placeholder="Reason" /><Button variant="accent" onClick={() => void add()}>Reserve</Button></div>{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.username} className="flex items-center gap-3 p-4"><span className="flex-1 text-sm text-zinc-200">@{item.username}<span className="ml-3 text-xs text-zinc-600">{item.reason || "No reason"}</span></span><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void remove(item.username)}>Remove</Button></div>)}</div></section>; }

function BansPanel() {
  const t = useT();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [ips, setIps] = useState<any[]>([]);
  const [username, setUsername] = useState("");
  const [accountReason, setAccountReason] = useState("");
  const [ip, setIp] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [error, setError] = useState("");
  const load = () => void api("/bans").then((r) => { setAccounts(r.accounts || []); setIps(r.ips || []); }).catch((e) => setError(e.message));
  useEffect(load, []);
  const banAccount = async () => {
    try {
      await api("/bans/accounts", { method: "POST", body: JSON.stringify({ username, reason: accountReason }) });
      setUsername("");
      setAccountReason("");
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ban that account.");
    }
  };
  const unbanAccount = async (value: string) => {
    if (!window.confirm(`Unban ${value}?`)) return;
    try {
      await api(`/bans/accounts/${encodeURIComponent(value)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unban that account.");
    }
  };
  const banIp = async () => {
    try {
      await api("/bans/ips", { method: "POST", body: JSON.stringify({ ip, reason: ipReason }) });
      setIp("");
      setIpReason("");
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ban that IP.");
    }
  };
  const unbanIp = async (value: string) => {
    if (!window.confirm(`Unban ${value}?`)) return;
    try {
      await api(`/bans/ips?ip=${encodeURIComponent(value)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unban that IP.");
    }
  };
  return (
    <section className="space-y-10">
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div>
        <SectionTitle icon={ShieldOff} title={t("admin.bansAccountsTitle")} description={t("admin.bansAccountsDesc")} />
        <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_1fr_auto]">
          <TextInput value={username} onChange={setUsername} placeholder={t("admin.bansUsername")} />
          <TextInput value={accountReason} onChange={setAccountReason} placeholder={t("admin.bansReason")} />
          <Button variant="accent" onClick={() => void banAccount()}>{t("admin.bansAccountAdd")}</Button>
        </div>
        <div className="surface divide-y divide-white/[.06] rounded-2xl">
          {accounts.map((item) => (
            <div key={item.user_id} className="flex items-center gap-3 p-4">
              <span className="flex-1 text-sm text-zinc-200">
                @{item.username || "unclaimed"}
                <span className="ms-3 text-xs text-zinc-600">{item.reason || t("admin.bansNoReason")}</span>
                <span className="ms-3 font-mono text-[11px] text-zinc-500">{item.signup_ip || t("admin.bansNoIp")}</span>
              </span>
              <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void unbanAccount(item.username || item.user_id)}>{t("common.remove")}</Button>
            </div>
          ))}
          {!accounts.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.bansAccountsEmpty")}</p>}
        </div>
      </div>
      <div>
        <SectionTitle icon={ShieldOff} title={t("admin.bansIpsTitle")} description={t("admin.bansIpsDesc")} />
        <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_1fr_auto]">
          <TextInput value={ip} onChange={setIp} placeholder={t("admin.bansIp")} />
          <TextInput value={ipReason} onChange={setIpReason} placeholder={t("admin.bansReason")} />
          <Button variant="accent" onClick={() => void banIp()}>{t("admin.bansIpAdd")}</Button>
        </div>
        <div className="surface divide-y divide-white/[.06] rounded-2xl">
          {ips.map((item) => (
            <div key={item.ip} className="flex items-center gap-3 p-4">
              <span className="flex-1 text-sm text-zinc-200">
                <span className="font-mono">{item.ip}</span>
                <span className="ms-3 text-xs text-zinc-600">{item.reason || t("admin.bansNoReason")}</span>
                <span className="ms-3 text-xs text-zinc-500">{item.usernames?.length ? item.usernames.map((name: string) => `@${name}`).join(", ") : t("admin.bansNoAccounts")}</span>
              </span>
              <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void unbanIp(item.ip)}>{t("common.remove")}</Button>
            </div>
          ))}
          {!ips.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.bansIpsEmpty")}</p>}
        </div>
      </div>
    </section>
  );
}

function BannedPanel() {
  const t = useT();
  const [items, setItems] = useState<any[]>([]);
  const [word, setWord] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const load = () => void api("/banned-words").then((r) => setItems(r.words || [])).catch((e) => setError(e.message));
  useEffect(load, []);
  const add = async () => {
    try {
      await api("/banned-words", { method: "POST", body: JSON.stringify({ word, reason }) });
      setWord("");
      setReason("");
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ban that word.");
    }
  };
  const remove = async (value: string) => {
    if (!window.confirm(`Remove ${value}?`)) return;
    try {
      await api(`/banned-words/${encodeURIComponent(value)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that word.");
    }
  };
  return (
    <section>
      <SectionTitle icon={Ban} title={t("admin.bannedTitle")} description={t("admin.bannedDesc")} />
      <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_1fr_auto]">
        <TextInput value={word} onChange={setWord} placeholder={t("admin.bannedWord")} />
        <TextInput value={reason} onChange={setReason} placeholder={t("admin.bannedReason")} />
        <Button variant="accent" onClick={() => void add()}>{t("admin.bannedAdd")}</Button>
      </div>
      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
      <div className="surface divide-y divide-white/[.06] rounded-2xl">
        {items.map((item) => (
          <div key={item.word} className="flex items-center gap-3 p-4">
            <span className="flex-1 text-sm text-zinc-200">{item.word}<span className="ms-3 text-xs text-zinc-600">{item.reason || t("admin.bannedNoReason")}</span></span>
            <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void remove(item.word)}>{t("common.remove")}</Button>
          </div>
        ))}
        {!items.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.bannedEmpty")}</p>}
      </div>
    </section>
  );
}

function PremiumPanel() {
  const t = useT();
  const [ranks, setRanks] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<any | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const load = () => void api("/entitlements").then((r) => setRanks(r.ranks || [])).catch((e) => setError(e.message));
  const loadRank = (id: string) => void api(`/entitlements/ranks/${id}`).then((r) => setOpen(r.rank)).catch((e) => setError(e.message));
  useEffect(load, []);
  const create = async () => {
    try {
      await api("/entitlements/ranks", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that rank.");
    }
  };
  const grant = async () => {
    if (!open) return;
    try {
      await api(`/entitlements/ranks/${open.id}/grants`, { method: "POST", body: JSON.stringify({ username }) });
      setUsername("");
      setError("");
      loadRank(open.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not grant that rank.");
    }
  };
  const revoke = async (handle: string) => {
    if (!open || !window.confirm(`Revoke ${open.name} from @${handle}?`)) return;
    try {
      await api(`/entitlements/ranks/${open.id}/grants/${encodeURIComponent(handle)}`, { method: "DELETE" });
      loadRank(open.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that rank.");
    }
  };
  return (
    <section>
      <SectionTitle icon={ShieldCheck} title={t("admin.premiumTitle")} description={t("admin.premiumDesc")} />
      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
      {open ? (
        <div>
          <button type="button" onClick={() => { setOpen(null); setError(""); }} className="mb-4 text-xs text-[#b6aaff] hover:text-white">{t("admin.premiumBack")}</button>
          <h3 className="mb-4 text-lg font-medium text-white">{open.name}</h3>
          <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_auto]">
            <TextInput value={username} onChange={setUsername} placeholder={t("admin.premiumUsername")} />
            <Button variant="accent" onClick={() => void grant()}>{t("admin.premiumGrant")}</Button>
          </div>
          <div className="surface divide-y divide-white/[.06] rounded-2xl">
            {(open.holders || []).map((item: any) => (
              <div key={item.id} className="flex items-center gap-3 p-4">
                <span className="flex-1 text-sm text-zinc-200">@{item.username || "unclaimed"}</span>
                <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void revoke(item.username || item.user_id)}>{t("admin.premiumRevoke")}</Button>
              </div>
            ))}
            {!(open.holders || []).length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.premiumNoHolders")}</p>}
          </div>
        </div>
      ) : (
        <div>
          <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_auto]">
            <TextInput value={name} onChange={setName} placeholder={t("admin.premiumRank")} />
            <Button variant="accent" onClick={() => void create()}>{t("admin.premiumCreate")}</Button>
          </div>
          <div className="surface divide-y divide-white/[.06] rounded-2xl">
            {ranks.map((item) => (
              <button key={item.id} type="button" onClick={() => { setError(""); loadRank(item.id); }} className="flex w-full items-center gap-3 p-4 text-start hover:bg-white/[.03]">
                <span className="flex-1 text-sm text-zinc-200">{item.name}</span>
                <span className="text-xs text-zinc-500">{item.holders || 0}</span>
              </button>
            ))}
            {!ranks.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.premiumEmpty")}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function ReportsPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); const load = () => void api("/reports").then((r) => setItems(r.reports || [])).catch((e) => setError(e.message)); useEffect(load, []); const update = async (id: string, status: string) => { try { await api(`/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update report."); } }; return <section><SectionTitle icon={Flag} title={t("admin.reportsTitle")} description={t("admin.reportsDesc")} />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.id} className="p-4"><div className="flex gap-3"><div className="flex-1"><p className="text-sm text-zinc-200">{item.reason} <span className="ml-2 text-xs text-zinc-600">{item.target_username || item.target_user_id || "unknown target"}</span></p><p className="mt-1 text-xs text-zinc-500">{item.details || "No details"}</p></div><span className="text-xs text-zinc-500">{item.status}</span></div><div className="mt-3 flex gap-2"><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void update(item.id, "reviewed")}>Review</Button><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void update(item.id, "resolved")}>Resolve</Button><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void update(item.id, "dismissed")}>Dismiss</Button></div></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">No reports.</p>}</div></section>; }

function FlagsPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); const load = () => void api("/feature-flags").then((r) => setItems(r.flags || [])).catch((e) => setError(e.message)); useEffect(load, []); const toggle = async (item: any) => { try { await api(`/feature-flags/${encodeURIComponent(item.key)}`, { method: "PUT", body: JSON.stringify({ enabled: !item.enabled, description: item.description }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update flag."); } }; return <section><SectionTitle icon={Flag} title={t("admin.flagsTitle")} description={t("admin.flagsDesc")} />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.key} className="flex items-center gap-3 p-4"><div className="flex-1"><p className="font-mono text-sm text-zinc-200">{item.key}</p><p className="mt-1 text-xs text-zinc-600">{item.description}</p></div><Button variant={item.enabled ? "accent" : "ghost"} className="h-8 min-h-0 px-3 text-xs" onClick={() => void toggle(item)}>{item.enabled ? "Enabled" : "Disabled"}</Button></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">No feature flags yet.</p>}</div></section>; }

function AuditPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); useEffect(() => { void api("/audit-logs").then((r) => setItems(r.logs || [])).catch((e) => setError(e.message)); }, []); return <section><SectionTitle icon={Database} title={t("admin.auditTitle")} description={t("admin.auditDesc")} />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.id} className="grid gap-1 p-4 text-xs sm:grid-cols-[180px_1fr_1fr]"><span className="text-zinc-600">{new Date(item.created_at).toLocaleString()}</span><span className="font-mono text-[#fda4af]">{item.action}</span><span className="text-zinc-500">{item.target_type || "—"}: {item.target_id || "—"}</span></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.noAudit")}</p>}</div></section>; }

function BakaBoostPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); useEffect(() => { void api("/bakaboost").then((r) => setItems(r.connections || [])).catch((e) => setError(e.message)); }, []); return <section><SectionTitle icon={Database} title={t("admin.bakaTitle")} description={t("admin.bakaDesc")} />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.user_id} className="flex items-center gap-3 p-4 text-xs"><span className="flex-1 font-mono text-zinc-400">{item.user_id}</span><span className="text-zinc-500">{item.provider}</span><span className={item.status === "connected" ? "text-emerald-400" : "text-amber-300"}>{item.status}</span></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">{t("admin.noBaka")}</p>}</div></section>; }

function ThemesPanel() { const t = useT(); const [items, setItems] = useState<any[]>([]); const [name, setName] = useState(""); const [error, setError] = useState(""); const load = () => void api("/themes").then((r) => setItems(r.themes || [])).catch((e) => setError(e.message)); useEffect(load, []); const add = async () => { try { await api("/themes", { method: "POST", body: JSON.stringify({ name, config: {}, active: true }) }); setName(""); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save theme."); } }; return <section><SectionTitle icon={Database} title={t("admin.themesTitle")} description={t("admin.themesDesc")} /><div className="surface mb-5 flex gap-2 rounded-2xl p-4"><TextInput value={name} onChange={setName} placeholder="Preset name" /><Button variant="accent" onClick={() => void add()}>Save preset</Button></div>{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.id} className="flex items-center gap-3 p-4 text-sm"><span className="flex-1 text-zinc-300">{item.name}</span><span className={item.active ? "text-emerald-400" : "text-zinc-600"}>{item.active ? "Active" : "Inactive"}</span></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">No presets yet.</p>}</div></section>; }

function DefaultFontsPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  const load = async () => { try { const response = await api("/fonts"); setItems(response.fonts || []); } catch (e) { setError(e instanceof Error ? e.message : "Could not load default fonts."); } };
  useEffect(() => { void load(); }, []);
  const upload = async (slot: number, file: File) => {
    if (file.size > 2_000_000) { setError("Font must be smaller than 2 MB."); return; }
    try {
      setBusy(slot);
      const asset = await assetFromFile(file);
      if (!asset.url) throw new Error("Could not read that font.");
      await api(`/fonts/${slot}`, { method: "PUT", body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ""), data_url: asset.url, mime_type: asset.type || "font/woff2" }) });
      setError("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload that font."); }
    finally { setBusy(0); }
  };
  const remove = async (slot: number) => { try { setBusy(slot); await api(`/fonts/${slot}`, { method: "DELETE" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove that font."); } finally { setBusy(0); } };
  return <section><SectionTitle icon={Type} title="Default fonts" description="Manage ten uploaded fonts plus Inter in the profile font selector." />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl"><div className="flex items-center gap-3 p-4"><div className="flex-1"><p className="text-sm text-zinc-200">Inter</p><p className="text-xs text-zinc-600">Built-in default font</p></div><span className="text-xs text-emerald-400">Default</span></div>{[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((slot) => { const item = items.find((entry) => entry.slot === slot); return <div key={slot} className="flex items-center gap-3 p-4"><div className="flex-1"><p className="text-sm text-zinc-200">Font {slot - 1}</p><p className="text-xs text-zinc-600">{item?.name || "Empty slot"}</p></div><input ref={(node) => { inputs.current[slot] = node; }} className="hidden" type="file" accept={FONT_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(slot, file); event.target.value = ""; }} /><Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" disabled={busy === slot} onClick={() => inputs.current[slot]?.click()}><Upload size={13} />{item ? "Replace" : "Upload"}</Button>{item ? <Button variant="ghost" className="h-9 min-h-0 px-3 text-xs" disabled={busy === slot} onClick={() => void remove(slot)}>Remove</Button> : null}</div>; })}</div></section>;
}

function TemplatesPanel() {
  const t = useT();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = () => void api("/templates").then((r) => setItems(r.templates || [])).catch((e) => setError(e.message));
  useEffect(load, []);
  const toggle = async (item: any) => { try { await api(`/templates/${item.id}`, { method: "PATCH", body: JSON.stringify({ published: !item.published }) }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update template."); } };
  const remove = async (item: any) => { if (!window.confirm(`Delete ${item.name}?`)) return; try { await api(`/templates/${item.id}`, { method: "DELETE" }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete template."); } };
  return <section><SectionTitle icon={Database} title={t("admin.templatesTitle")} description={t("admin.templatesDesc")} />{error && <p className="mb-3 text-xs text-red-300">{error}</p>}<div className="surface divide-y divide-white/[.06] rounded-2xl">{items.map((item) => <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="flex-1"><p className="text-sm text-zinc-200">{item.name}</p><p className="mt-1 text-xs text-zinc-500">{item.slug} · {item.creator_username ? `@${item.creator_username}` : "system"} · {item.published ? "Published" : "Unpublished"}</p></div><div className="flex gap-2"><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void toggle(item)}>{item.published ? "Unpublish" : "Publish"}</Button><Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" onClick={() => void remove(item)}>Delete</Button></div></div>)}{!items.length && <p className="p-8 text-center text-xs text-zinc-600">No templates yet.</p>}</div></section>;
}


function ConstellationsPanel({ staffRole }: { staffRole: StaffRole | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const canDestroy = staffRole === "owner" || staffRole === "admin";
  const load = () => void api(`/constellations?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`).then((result) => setItems(result.constellations || [])).catch((reason) => setError(reason.message));
  useEffect(load, []);
  const inspect = async (id: string) => {
    try { const result = await api(`/constellations/${encodeURIComponent(id)}`); setSelected(result.constellation || null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Constellation."); }
  };
  const moderate = async (item: any) => {
    try {
      await api(`/constellations/${encodeURIComponent(item.id)}/status`, { method: "PATCH", body: JSON.stringify({ suspended: item.status !== "suspended" }) });
      await inspect(item.id); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Moderation failed."); }
  };
  const removeMember = async (member: any) => {
    if (!selected || !window.confirm(`Remove @${member.username} from this Constellation?`)) return;
    try { const result = await api(`/constellations/${selected.id}/members/${member.userId}`, { method: "DELETE" }); setSelected(result.constellation); load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove member."); }
  };
  const revokeInvite = async (invite: any) => {
    if (!selected) return;
    try { const result = await api(`/constellations/${selected.id}/invitations/${invite.id}`, { method: "DELETE" }); setSelected(result.constellation); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke invite."); }
  };
  const removeConstellation = async () => {
    if (!selected || !window.confirm(`Permanently delete “${selected.name}”?`)) return;
    try { await api(`/constellations/${selected.id}`, { method: "DELETE" }); setSelected(null); load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete Constellation."); }
  };
  return <section><SectionTitle icon={Orbit} title="Constellations" description="Inspect shared pages, members, assignments, media, status, and audit-backed moderation." /><div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]"><TextInput value={search} onChange={setSearch} placeholder="ID, name, owner, or slug" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-white/[.08] bg-[#0d0d12] px-3 text-xs text-zinc-300"><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="suspended">Suspended</option></select><Button variant="accent" onClick={load}><Search size={14} />Search</Button></div>{error ? <p className="mb-3 text-xs text-red-300">{error}</p> : null}<div className="surface overflow-x-auto rounded-2xl"><table className="w-full min-w-[780px] text-left text-xs"><thead className="border-b border-white/[.06] text-zinc-600"><tr><th className="p-4">Constellation</th><th className="p-4">Owner</th><th className="p-4">Members</th><th className="p-4">Status</th><th className="p-4">Updated</th></tr></thead><tbody className="divide-y divide-white/[.06]">{items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-white/[.025]" onClick={() => void inspect(item.id)}><td className="p-4"><p className="text-zinc-200">{item.name}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{item.id}</p></td><td className="p-4 text-zinc-400">@{item.ownerUsername || "unknown"}</td><td className="p-4 text-zinc-400">{item.memberCount}/{item.capacity}</td><td className="p-4 text-zinc-400">{item.status}</td><td className="p-4 text-zinc-600">{new Date(item.updatedAt).toLocaleString()}</td></tr>)}</tbody></table>{!items.length ? <p className="p-8 text-center text-xs text-zinc-600">No Constellations found.</p> : null}</div>{selected ? <div className="surface mt-5 rounded-2xl p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg text-white">{selected.name}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{selected.id} · /c/{selected.slug}</p></div><div className="flex gap-2"><Button variant="ghost" onClick={() => void moderate(selected)}>{selected.status === "suspended" ? "Restore to draft" : "Suspend"}</Button>{canDestroy ? <Button variant="ghost" className="text-red-300" onClick={() => void removeConstellation()}>Delete</Button> : null}</div></div><div className="mt-5 grid gap-3 text-xs text-zinc-400 sm:grid-cols-3"><p>Owner<br /><span className="text-zinc-200">@{selected.ownerUsername}</span></p><p>Assignment<br /><span className="text-zinc-200">{selected.assignmentMode}</span></p><p>Background<br /><span className="text-zinc-200">{selected.background?.type || "color"}{selected.background?.key ? ` · ${selected.background.key}` : ""}</span></p><p>Global font<br /><span className="text-zinc-200">{selected.globalFont}</span></p><p>Member movement<br /><span className="text-zinc-200">{selected.allowMemberMove ? "Allowed" : "Owner only"}</span></p><p>Frame mode<br /><span className="text-zinc-200">{selected.frameMode}</span></p></div><h3 className="mt-6 text-sm text-zinc-200">Members and assignments</h3><div className="mt-2 divide-y divide-white/[.06]">{(selected.members || []).map((member: any) => <div key={member.userId} className="flex items-center gap-3 py-3 text-xs"><span className="flex-1 text-zinc-300">@{member.username} · {member.role}</span><span className="text-zinc-600">slot {member.slot} · {Math.round(member.scale * 100)}% · {member.position.x.toFixed(1)}, {member.position.y.toFixed(1)}</span>{canDestroy && member.role !== "owner" ? <Button variant="ghost" className="h-8 min-h-0 px-2 text-[10px]" onClick={() => void removeMember(member)}>Remove</Button> : null}</div>)}</div>{(selected.invitations || []).some((invite: any) => invite.status === "pending") ? <><h3 className="mt-6 text-sm text-zinc-200">Pending invites</h3>{selected.invitations.filter((invite: any) => invite.status === "pending").map((invite: any) => <div key={invite.id} className="mt-2 flex items-center gap-3 text-xs"><span className="flex-1 text-zinc-500">{invite.username ? `@${invite.username}` : "Share link"} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span><Button variant="ghost" className="h-8 min-h-0 px-2 text-[10px]" onClick={() => void revokeInvite(invite)}>Revoke</Button></div>)}</> : null}</div> : null}</section>;
}
