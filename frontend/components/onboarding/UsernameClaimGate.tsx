"use client";

import { ArrowRight, AtSign } from "lucide-react";
import { useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";

export function UsernameClaimGate() {
  const { updateUsername } = useAuth();
  const { dir, locale, t } = useI18n();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const claim = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = username.trim().toLowerCase();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await updateUsername(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.usernameFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main dir={dir} lang={locale} className="grid min-h-screen place-items-center bg-[#07070a] px-5 text-white">
      <section className="surface w-full max-w-[460px] rounded-2xl p-6 sm:p-8">
        <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#c5b8ff] via-[#e11d48] to-[#881337] text-white shadow-[0_0_25px_rgba(155,135,245,.28)]">
          <AtSign size={20} />
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-[#fb7185]">{t("settings.generalTitle")}</p>
        <h1 className="text-2xl font-semibold tracking-[-.04em]">{t("helpArticles.claim-username.title")}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{t("helpArticles.claim-username.summary")}</p>
        <form onSubmit={claim} className="mt-7 space-y-4">
          <div className="relative">
            <AtSign size={15} className="absolute left-3 top-3.5 text-zinc-600" />
            <TextInput
              value={username}
              onChange={(value) => { setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24)); setError(""); }}
              placeholder="yourname"
              autoComplete="username"
              className="pl-9"
              aria-label={t("settings.username")}
            />
          </div>
          <p className="text-xs text-zinc-600">{t("settings.usernameHelp")}</p>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2.5 text-xs leading-5 text-red-200">{error}</p>}
          <Button type="submit" variant="accent" className="h-12 w-full" disabled={busy || username.trim().length < 3}>
            {busy ? t("common.saving") : t("common.claim")}
            <ArrowRight size={16} />
          </Button>
        </form>
      </section>
    </main>
  );
}
