"use client";

import { AtSign, BadgeCheck, Check, ChevronRight, CircleUserRound, Cloud, Copy, Eye, Globe2, Pencil, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { useDiscordLive } from "@/lib/discord-live";
import { useFeatureFlags } from "@/lib/feature-flags";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile-store";
import { useEffect, useState } from "react";
import { ShareCard } from "@/components/sharing/ShareCard";
import { Button, MiniBar, PageHeader, SectionTitle, StatusDot } from "@/components/ui";

function oauthErrorMessage(code: string | null) {
  if (!code) return "";
  if (code === "google_not_configured") return "Google connection is not configured on the server.";
  if (code === "discord_not_configured") return "Discord connection is not configured on the server.";
  if (code === "already_linked") return "That provider account is already linked to another Misa account.";
  if (code === "email_taken" || code === "account_exists") return "That provider email belongs to another Misa account.";
  if (code === "not_authenticated") return "Your session expired. Sign in again before connecting an account.";
  if (code === "oauth_denied") return "The provider connection was cancelled.";
  return "The provider connection failed. Verify the provider credentials and callback URL.";
}

function ProviderIcon({ provider }: { provider: "google" | "discord" }) {
  // Reuse the provider artwork served by the backend for the Security page.

  return <img src={`/icons/${provider}.webp`} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl object-cover" />;
}

export function Overview() {
  const { config } = useProfile();
  const { user } = useAuth();
  const { t } = useI18n();
  const { profile, assets, socials } = config;
  const [copiedAccountId, setCopiedAccountId] = useState(false);
  const tasks = [
    [t("overview.taskAvatar"), "/customize", Boolean(assets.avatar.url)],
    [t("overview.taskDescription"), "/customize", Boolean(profile.description.trim())],
    [t("overview.taskSocials"), "/links", socials.some((social) => social.enabled)],
    [t("overview.taskBackground"), "/customize", Boolean(assets.background.url || assets.backgroundVideo.url)],
    [t("overview.taskMusic"), "/customize", Boolean(assets.audio.url)],
  ] as const;
  const completedTasks = tasks.filter(([, , done]) => done).length;
  const completionPercent = Math.round((completedTasks / tasks.length) * 100);
  const stats = [
    { label: t("overview.username"), value: profile.username, icon: AtSign, color: "#e11d48", hint: t("overview.usernameHint") },
    { label: t("overview.aliases"), value: t("overview.aliasesValue"), icon: UsersRound, color: "#65c7b9", hint: t("overview.aliasesHint") },
    { label: t("overview.accountId", undefined, "Account ID"), value: user?.accountId || "Generating...", icon: ShieldCheck, color: "#e0a1ef", hint: t("overview.accountIdHint", undefined, "Permanent public account identifier"), account: true },
    { label: t("overview.views"), value: String(profile.views), icon: Eye, color: "#e2b46d", hint: t("overview.viewsHint") },
  ];
  return <main className="mx-auto min-h-screen max-w-[1360px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
    <PageHeader eyebrow={t("overview.eyebrow")} title={t("overview.title")} description={t("overview.description")} action={<a href={`/${profile.username}`} target="_blank"><Button variant="subtle"><Globe2 size={15} />{t("common.viewLive")}</Button></a>} />
    <div className="mb-8"><ShareCard username={profile.username} /></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon, color, hint, account }, index) => <div key={label} className="surface surface-subtle surface-hover animate-fade-up rounded-[16px] p-5" style={{ animationDelay: `${index * 50}ms` }}><div className="mb-6 flex items-center justify-between"><span className="text-xs font-medium text-zinc-500">{label}</span><span className="icon-glass flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ color, background: `${color}16` }}><Icon size={16} /></span></div><div className="flex items-center gap-2"><div className="text-xl font-semibold tracking-[-.03em] text-white">{value}</div>{account && user?.accountId && <button type="button" aria-label="Copy Account ID" title="Copy Account ID" onClick={() => { void navigator.clipboard.writeText(user.accountId).then(() => { setCopiedAccountId(true); window.setTimeout(() => setCopiedAccountId(false), 1600); }); }} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-white">{copiedAccountId ? <Check size={14} /> : <Copy size={14} />}</button>}</div><div className="mt-2 text-[11px] text-zinc-600">{hint}</div></div>)}</div>
    <div className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_.7fr]"><div className="space-y-8"><section><SectionTitle icon={Sparkles} title={t("overview.statsTitle")} description={t("overview.statsDesc")} action={<span className="text-sm font-medium text-[#b6aaff]">{completionPercent}%</span>} /><div className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-medium">{t("overview.completion")}</p><p className="mt-1 text-xs text-zinc-500">{t("overview.completionHint")}</p></div><span className="rounded-lg bg-[#e11d48]/10 px-2.5 py-1 text-xs font-medium text-[#b6aaff]">{completedTasks} / {tasks.length}</span></div><MiniBar value={completionPercent} /><div className="mt-6 grid gap-2 sm:grid-cols-2">{tasks.map(([task, href, done]) => <Link key={task} href={href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-white/[.03]"><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${done ? "bg-emerald-400/10 text-emerald-400" : "bg-white/[.06] text-zinc-600"}`}>{done ? <Check size={14} /> : <CircleUserRound size={14} />}</span><span className={done ? "text-zinc-300" : "text-zinc-500"}>{task}</span>{!done && <span className="ms-auto text-[10px] text-zinc-600">{t("common.open")}</span>}</Link>)}</div></div></section><section><SectionTitle icon={UsersRound} title={t("overview.manageTitle")} description={t("overview.manageDesc")} /><div className="grid gap-3 sm:grid-cols-2"><div className="surface flex items-center gap-4 rounded-2xl p-4"><span className="icon-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400"><AtSign size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-zinc-200">{t("overview.permanentUsername")}</span><span className="mt-1 block truncate text-xs text-zinc-600">{t("overview.cannotChange", { username: profile.username })}</span></span></div>{[{ title: t("overview.changeDisplay"), desc: t("overview.changeDisplayDesc"), icon: Pencil }, { title: t("overview.manageAliases"), desc: t("overview.manageAliasesDesc"), icon: UsersRound }, { title: t("overview.accountSettings"), desc: t("overview.accountSettingsDesc"), icon: ShieldCheck }].map(({ title, desc, icon: Icon }) => <Link href={title === t("overview.manageAliases") ? "/settings#aliases" : "/settings"} key={title} className="surface surface-hover flex items-center gap-4 rounded-2xl p-4 text-start"><span className="icon-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-zinc-200">{title}</span><span className="mt-1 block truncate text-xs text-zinc-600">{desc}</span></span><ChevronRight size={16} className="text-zinc-700" /></Link>)}</div></section></div><div className="space-y-8"><ConnectionsCard /><section className="relative overflow-hidden rounded-2xl border border-[#e11d48]/20 bg-gradient-to-br from-[#211c3b] to-[#111117] p-5"><div className="absolute -end-8 -top-8 h-32 w-32 rounded-full bg-[#e11d48]/20 blur-3xl" /><div className="relative"><div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[#e11d48]/20 text-[#bdb2ff]"><BadgeCheck size={18} /></div><h3 className="font-medium">{t("overview.promoTitle")}</h3><p className="mt-2 max-w-xs text-xs leading-5 text-zinc-400">{t("overview.promoDesc")}</p><Link href="/customize"><Button variant="accent" className="mt-5 h-9 min-h-0 px-3 text-xs">{t("overview.promoCta")} <ChevronRight size={14} /></Button></Link></div></section></div></div>
  </main>;
}

function ConnectionsCard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const discord = useDiscordLive();
  const { enabled } = useFeatureFlags();
  const [oauthError, setOauthError] = useState("");
  useEffect(() => {
    setOauthError(oauthErrorMessage(new URLSearchParams(window.location.search).get("error")));
  }, []);
  const discordOn = Boolean(user?.providers?.discord);
  const discordSubtitle = !discordOn
    ? t("overview.discordHint")
    : discord?.state?.needsReconnect
      ? t("settings.discordReconnect")
      : discord?.state?.username
        ? t("settings.discordAs", { name: discord.state.username })
        : t("common.connected");
  const connectDiscord = () => window.location.assign("/api/v1/auth/discord?next=/dashboard&mode=link");

  return (
    <section>
      <SectionTitle icon={Cloud} title={t("overview.connections")} description={t("overview.connectionsDesc")} />
      {oauthError && <p role="alert" className="mb-3 rounded-xl border border-red-400/20 bg-red-400/[.05] px-3 py-2.5 text-xs text-red-200">{oauthError}</p>}
      <div className="surface divide-y divide-white/[.06] rounded-2xl">
        {enabled("integrations.discord") && (
          <div className="flex items-center gap-3 p-4">
            <ProviderIcon provider="discord" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-200">Discord</span>
              <span className="mt-1 block truncate text-xs text-zinc-600">{discordSubtitle}</span>
            </span>
            {discordOn && !discord?.state?.needsReconnect ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400"><StatusDot />{t("common.connected")}</span>
            ) : (
              <Button variant="subtle" className="h-8 min-h-0 px-3 text-xs" onClick={connectDiscord}>
                {discordOn ? t("common.reconnect") : t("common.connect")}
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 p-4">
          <ProviderIcon provider="google" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-zinc-200">Google</span>
            <span className="mt-1 block truncate text-xs text-zinc-600">{user?.providers?.google ? (user.email || t("common.connected")) : t("common.notConnected")}</span>
          </span>
          {user?.providers?.google ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400"><StatusDot />{t("common.connected")}</span>
          ) : (
            <Button variant="ghost" className="h-8 min-h-0 px-2.5 text-xs" onClick={() => window.location.assign("/api/v1/auth/google?next=/dashboard&mode=link")}>{t("common.connect")}</Button>
          )}
        </div>
      </div>
    </section>
  );
}






