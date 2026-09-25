"use client";

import Link from "next/link";
import { Check, CircleHelp, LockKeyhole, UserRound, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { LanguageSelect } from "@/components/dashboard/LanguageSelect";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile-store";
import { Button, FieldLabel, PageHeader, SectionTitle, TextInput } from "@/components/ui";

export function SettingsView() {
  const { user, updateUsername } = useAuth();
  const { config, updateConfig, saveProfile, saveState } = useProfile();
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [displayName, setDisplayName] = useState(config.profile.displayName);
  const [username, setUsername] = useState(user?.username || "");
  const [usernameMessage, setUsernameMessage] = useState("");
  const [usernameError, setUsernameError] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const [usernameBusy, setUsernameBusy] = useState(false);
  useEffect(() => { if (user?.username) setUsername(user.username); setConfirmChange(false); }, [user?.username]);

  const claimUsername = async () => {
    const next = username.trim().toLowerCase();
    if (user?.username && next !== user.username.toLowerCase() && !confirmChange) {
      setConfirmChange(true); setUsernameError(false); setUsernameMessage(t("settings.confirmRename", { username: next })); return;
    }
    setUsernameBusy(true); setUsernameError(false);
    try {
      await updateUsername(next); setConfirmChange(false); setUsernameMessage(user?.username ? t("settings.usernameUpdated") : t("settings.usernameClaimed"));
    } catch (error) { setUsernameError(true); setUsernameMessage(error instanceof Error ? error.message : t("settings.usernameFail")); }
    finally { setUsernameBusy(false); }
  };
  const save = () => {
    const next = { ...config, profile: { ...config.profile, displayName: displayName.trim() || config.profile.displayName } };
    updateConfig(() => next);
    void saveProfile(next).then(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1800); });
  };

  return <main className="mx-auto min-h-screen max-w-[1050px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
    <PageHeader eyebrow={t("settings.eyebrow")} title={t("settings.title")} description={t("settings.description")} action={<div className="flex flex-wrap gap-2"><Link href="/help?article=change-username"><Button variant="ghost"><CircleHelp size={15} />{t("common.help")}</Button></Link><Button variant="accent" onClick={save} disabled={saveState === "saving"}>{saved ? <><Check size={15} />{t("common.saved")}</> : saveState === "saving" ? t("common.saving") : t("common.save")}</Button></div>} />
    <div className="space-y-8">
      <section className="relative z-20">
        <SectionTitle icon={UserRound} title={t("settings.generalTitle")} description={t("settings.generalDesc")} />
        <div className="surface grid gap-5 rounded-2xl p-5 sm:grid-cols-2 sm:p-6">
          <div><FieldLabel>{t("settings.username")}</FieldLabel><div className="flex gap-2"><TextInput value={username} onChange={(value) => { setUsername(value); setConfirmChange(false); }} placeholder="yourname" /><Button variant={confirmChange ? "accent" : "subtle"} className="shrink-0" disabled={usernameBusy} onClick={() => void claimUsername()}>{usernameBusy ? t("common.saving") : user?.username ? (confirmChange ? t("common.confirm") : t("common.change")) : t("common.claim")}</Button></div><p className="mt-2 text-xs text-zinc-600">{t("settings.usernameHelp")} <Link href="/help?article=change-username" className="text-[#fda4af] hover:text-white">{t("settings.usernameHow")}</Link></p>{usernameMessage && <p className={`mt-2 text-xs ${usernameError ? "text-red-300" : "text-zinc-500"}`}>{usernameMessage}</p>}</div>
          <div><FieldLabel>{t("settings.displayName")}</FieldLabel><TextInput value={displayName} onChange={setDisplayName} /></div>
          <div><FieldLabel>{t("language.label")}</FieldLabel><LanguageSelect /><p className="mt-2 text-xs text-zinc-600">{t("language.hint")}</p></div>
        </div>
      </section>
      <section id="aliases" className="scroll-mt-8">
        <SectionTitle icon={UsersRound} title={t("settings.aliasesTitle", undefined, "Aliases")} description={t("settings.aliasesDesc", undefined, "Manage additional names that redirect to your profile.")} />
        <div className="surface flex items-center gap-4 rounded-2xl p-5 sm:p-6">
          <span className="icon-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400"><UsersRound size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-200">{t("settings.aliasesComingSoon", undefined, "Alias management is coming soon.")}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">{t("settings.aliasesComingSoonHint", undefined, "Your main username remains active; additional aliases are not available yet.")}</p>
          </div>
          <Button variant="subtle" disabled className="shrink-0">{t("common.comingSoon", undefined, "Coming soon")}</Button>
        </div>
      </section>
      <section>
        <SectionTitle icon={LockKeyhole} title={t("settings.securityTitle", undefined, "Security")} description={t("settings.securityDesc", undefined, "Sign-in methods, connected accounts, and account safety.")} />
        <Link href="/security" className="surface surface-hover flex items-center gap-4 rounded-2xl p-5"><span className="icon-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#fda4af]"><LockKeyhole size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-zinc-200">{t("settings.openSecurity", undefined, "Open Security settings")}</span><span className="mt-1 block text-xs text-zinc-600">{t("settings.openSecurityHint", undefined, "Manage email, connected accounts, account tools, and deletion.")}</span></span><span className="text-zinc-600">→</span></Link>
      </section>
    </div>
  </main>;
}
