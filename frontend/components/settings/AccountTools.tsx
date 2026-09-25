"use client";

import Link from "next/link";
import { KeyRound, MonitorSmartphone, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import {
  changePassword,
  disableMfa,
  fetchSessions,
  peekSessions,
  forgetSwitcherAccount,
  formatWhen,
  rotateBackupCodes,
  revokeSessions,
  sessionLabel,
  switchAccount,
  type AccountSession,
} from "@/lib/account-security";
import { useAuth } from "@/lib/auth-store";
import { useT } from "@/lib/i18n";
import { Button, FieldLabel, SectionTitle, TextInput } from "@/components/ui";

function FieldNote({ error, children }: { error?: boolean; children: string }) {
  if (!children) return null;
  return <p className={`mt-2 text-xs ${error ? "text-red-300" : "text-zinc-500"}`}>{children}</p>;
}

export function AccountTools() {
  const t = useT();
  const { user, refresh } = useAuth();
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaCodes, setMfaCodes] = useState<string[]>([]);
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaError, setMfaError] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaConfirm, setMfaConfirm] = useState(false);

  const [sessions, setSessions] = useState<AccountSession[]>(() => peekSessions() || []);
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionError, setSessionError] = useState(false);
  const [revokeOthers, setRevokeOthers] = useState(false);

  const [switchMessage, setSwitchMessage] = useState("");
  const [switchError, setSwitchError] = useState(false);

  useEffect(() => {
    void fetchSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const savePassword = async () => {
    setPasswordBusy(true);
    setPasswordError(false);
    try {
      await changePassword(passwordCurrent, passwordNext, passwordConfirm);
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      setPasswordMessage(user?.hasPassword ? t("account.passwordUpdated") : t("account.passwordSaved"));
      await refresh();
      setSessions(await fetchSessions(true));
    } catch (error) {
      setPasswordError(true);
      setPasswordMessage(error instanceof Error ? error.message : t("account.passwordFail"));
    } finally {
      setPasswordBusy(false);
    }
  };

  const generateCodes = async () => {
    if (user?.mfaEnabled && !mfaConfirm) {
      setMfaConfirm(true);
      setMfaError(false);
      setMfaMessage(t("account.backupConfirm"));
      return;
    }
    setMfaBusy(true);
    setMfaError(false);
    try {
      const result = await rotateBackupCodes(mfaPassword);
      setMfaCodes(result.codes);
      setMfaPassword("");
      setMfaConfirm(false);
      setMfaMessage(t("account.backupSaved"));
      await refresh();
    } catch (error) {
      setMfaError(true);
      setMfaMessage(error instanceof Error ? error.message : t("account.backupFail"));
    } finally {
      setMfaBusy(false);
    }
  };

  const turnOffMfa = async () => {
    setMfaBusy(true);
    setMfaError(false);
    try {
      await disableMfa(mfaPassword);
      setMfaCodes([]);
      setMfaPassword("");
      setMfaConfirm(false);
      setMfaMessage(t("account.backupDisabled"));
      await refresh();
    } catch (error) {
      setMfaError(true);
      setMfaMessage(error instanceof Error ? error.message : t("account.backupDisableFail"));
    } finally {
      setMfaBusy(false);
    }
  };

  const signOutOthers = async () => {
    if (!revokeOthers) {
      setRevokeOthers(true);
      setSessionError(false);
      setSessionMessage(t("account.signOutConfirm"));
      return;
    }
    try {
      setSessions(await revokeSessions({ others: true }));
      setRevokeOthers(false);
      setSessionMessage(t("account.signedOutOthers"));
    } catch (error) {
      setSessionError(true);
      setSessionMessage(error instanceof Error ? error.message : t("account.signOutFail"));
    }
  };

  return (
    <>
      <section>
        <SectionTitle icon={KeyRound} title={t("account.password")} description={user?.hasPassword ? t("account.passwordHas") : t("account.passwordAdd")} />
        <div className="surface grid gap-5 rounded-2xl p-5 sm:grid-cols-2 sm:p-6">
          {user?.hasPassword && (
            <div>
              <FieldLabel>{t("settings.currentPassword")}</FieldLabel>
              <TextInput type="password" value={passwordCurrent} onChange={setPasswordCurrent} autoComplete="current-password" />
            </div>
          )}
          <div>
            <FieldLabel>{t("account.newPassword")}</FieldLabel>
            <TextInput type="password" value={passwordNext} onChange={setPasswordNext} autoComplete="new-password" />
          </div>
          <div>
            <FieldLabel>{t("account.confirmPassword")}</FieldLabel>
            <TextInput type="password" value={passwordConfirm} onChange={setPasswordConfirm} autoComplete="new-password" />
          </div>
          <div className="flex items-end">
            <Button variant="subtle" disabled={passwordBusy} onClick={() => void savePassword()}>{passwordBusy ? t("common.saving") : user?.hasPassword ? t("account.updatePassword") : t("account.setPassword")}</Button>
          </div>
        </div>
        <FieldNote error={passwordError}>{passwordMessage}</FieldNote>
      </section>

      <section>
        <SectionTitle icon={ShieldCheck} title={t("account.backup")} description={t("account.backupDesc")} action={<Link href="/help?article=backup-codes" className="text-xs text-[#b6aaff] hover:text-white">{t("common.help")}</Link>} />
        <div className="surface space-y-4 rounded-2xl p-5 sm:p-6">
          <p className="text-sm text-zinc-400">
            {user?.mfaEnabled
              ? t(user.mfaCodesLeft === 1 ? "account.backupOn" : "account.backupOnPlural", { count: user.mfaCodesLeft })
              : t("account.backupOff")}
          </p>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            {user?.hasPassword && (
              <div>
                <FieldLabel>{t("settings.currentPassword")}</FieldLabel>
                <TextInput type="password" value={mfaPassword} onChange={(value) => { setMfaPassword(value); setMfaConfirm(false); }} autoComplete="current-password" />
              </div>
            )}
            <Button variant={mfaConfirm ? "accent" : "subtle"} disabled={mfaBusy} onClick={() => void generateCodes()}>{mfaBusy ? t("common.saving") : user?.mfaEnabled ? (mfaConfirm ? t("common.confirm") : t("account.generateNew")) : t("account.generateCodes")}</Button>
            {user?.mfaEnabled && <Button variant="ghost" disabled={mfaBusy} onClick={() => void turnOffMfa()}>{t("account.turnOff")}</Button>}
          </div>
          {mfaCodes.length > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3 font-mono text-sm text-zinc-200">
              {mfaCodes.map((code) => <span key={code}>{code}</span>)}
            </div>
          )}
          <FieldNote error={mfaError}>{mfaMessage}</FieldNote>
        </div>
      </section>

      <section>
        <SectionTitle icon={MonitorSmartphone} title={t("account.sessions")} description={t("account.sessionsDesc")} />
        <div className="surface divide-y divide-white/[.06] rounded-2xl">
          {sessions.length === 0 && <p className="p-4 text-sm text-zinc-500">{t("account.noSessions")}</p>}
          {sessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200">{sessionLabel(session)}{session.current ? ` · ${t("account.thisBrowser")}` : ""}</p>
                <p className="mt-1 text-xs text-zinc-600">{session.ip || t("account.ipHidden")} · {t("account.lastSeen", { when: formatWhen(session.last_seen_at) })}</p>
              </div>
              {!session.current && (
                <Button variant="subtle" className="h-8 min-h-0 px-3 text-xs" onClick={() => void revokeSessions({ sessionId: session.id }).then(setSessions).catch((error) => {
                  setSessionError(true);
                  setSessionMessage(error instanceof Error ? error.message : t("account.sessionFail"));
                })}>{t("account.signOut")}</Button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-xs text-zinc-500">{t("account.signOutOthersHint")}</p>
            <Button variant={revokeOthers ? "accent" : "subtle"} className="h-8 min-h-0 px-3 text-xs" onClick={() => void signOutOthers()}>{revokeOthers ? t("common.confirm") : t("account.signOutOthers")}</Button>
          </div>
        </div>
        <FieldNote error={sessionError}>{sessionMessage}</FieldNote>
      </section>

      <section>
        <SectionTitle icon={Users} title={t("account.savedAccounts")} description={t("account.savedAccountsDesc")} action={<Link href="/help?article=sessions-switcher" className="text-xs text-[#b6aaff] hover:text-white">{t("common.help")}</Link>} />
        <div className="surface divide-y divide-white/[.06] rounded-2xl">
          {(user?.accounts || []).map((account) => (
            <div key={account.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200">{account.display_name || account.username || t("account.account")}{account.current ? ` · ${t("account.current")}` : ""}</p>
                <p className="mt-1 text-xs text-zinc-600">{account.username ? `@${account.username}` : account.id}</p>
              </div>
              {!account.current && (
                <div className="flex gap-2">
                  <Button variant="subtle" className="h-8 min-h-0 px-3 text-xs" onClick={() => void switchAccount(account.id).catch((error) => {
                    setSwitchError(true);
                    setSwitchMessage(error instanceof Error ? error.message : t("account.switchFail"));
                  })}>{t("account.switch")}</Button>
                  <Button variant="ghost" className="h-8 min-h-0 px-3 text-xs" onClick={() => void forgetSwitcherAccount(account.id).then(() => refresh()).then(() => {
                    setSwitchError(false);
                    setSwitchMessage(t("account.forgot"));
                  }).catch((error) => {
                    setSwitchError(true);
                    setSwitchMessage(error instanceof Error ? error.message : t("account.forgetFail"));
                  })}>{t("account.forget")}</Button>
                </div>
              )}
            </div>
          ))}
          {(user?.accounts || []).length < 2 && <p className="p-4 text-xs text-zinc-500">{t("account.addAccount")}</p>}
        </div>
        <FieldNote error={switchError}>{switchMessage}</FieldNote>
      </section>
    </>
  );
}
