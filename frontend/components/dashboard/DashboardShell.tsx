"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, BadgeCheck, BookOpen, Check, ChevronRight, CircleHelp, Copy, ExternalLink, LayoutDashboard, Link2, LockKeyhole, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Palette, Search, Settings, Share2, ShieldCheck, Sparkles, Trophy, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LanguageSelect } from "@/components/dashboard/LanguageSelect";
import { RuntimeErrorBoundary } from "@/components/dashboard/RuntimeErrorBoundary";
import { UsernameClaimGate } from "@/components/onboarding/UsernameClaimGate";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile-store";
import { publicProfileUrl } from "@/lib/share";
import { useFeatureFlags } from "@/lib/feature-flags";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

type DashboardNavItem = { label: string; href: string; icon: typeof LayoutDashboard };

function NavLink({ href, label, icon: Icon, close }: DashboardNavItem & { close: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link href={href} prefetch={href === "/" || href === "/analytics" || href === "/badges" || href === "/settings" || href === "/links"} onClick={close} className={`group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white transition ${active ? "bg-[#e11d48]/20 shadow-[inset_0_0_0_1px_rgba(251,113,133,.18)]" : "hover:bg-white/[.055]"}`}>
      <Icon size={17} strokeWidth={active ? 2.1 : 1.8} className={active ? "text-[#fda4af]" : "text-zinc-300 group-hover:text-white"} />
      <span className="truncate">{label}</span>
      {active && <span className="absolute end-3 h-1.5 w-1.5 rounded-full bg-[#fecdd3] shadow-[0_0_10px_#e11d48]" />}
    </Link>
  );
}

function SidebarContent({ close, onToggleDesktop }: { close: () => void; onToggleDesktop?: () => void }) {
  const { config, savedConfig, profileReady } = useProfile();
  const { logout, user } = useAuth();
  const { t } = useI18n();
  const { enabled } = useFeatureFlags();
  const router = useRouter();
  const pathname = usePathname();
  const premiumView = useSearchParams().get("view") || "general";
  const premiumActive = isActive(pathname, "/premium");
  const [premiumOpen, setPremiumOpen] = useState(premiumActive);
  const myPage = profileReady && user?.username && savedConfig.profile.username === user.username ? publicProfileUrl(user.username) : null;
  const premiumItems = [{ label: "General", view: "general" }, { label: "Layout Settings", view: "layout" }, { label: "Profile Metadata", view: "metadata" }];
  const [accountOpen, setAccountOpen] = useState(true);
  const [customizeOpen, setCustomizeOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(false);
  const initials = config.profile.displayName.trim().slice(0, 1).toUpperCase() || "U";
  const avatarUrl = config.assets.avatar.url;
  const copyAccountId = async () => {
    if (!user?.accountId) return;
    try {
      await navigator.clipboard.writeText(user.accountId);
      setCopiedAccountId(true);
      window.setTimeout(() => setCopiedAccountId(false), 1600);
    } catch { /* clipboard access can be unavailable in insecure previews */ }
  };
  const groups = useMemo(() => [
    { label: t("nav.account"), items: [
      enabled("nav.overview") && { label: t("nav.overview"), href: "/", icon: LayoutDashboard },
      enabled("nav.analytics") && { label: t("nav.analytics"), href: "/analytics", icon: BarChart3 },
      enabled("nav.badges") && { label: t("nav.badges"), href: "/badges", icon: BadgeCheck },
      enabled("nav.settings") && { label: t("nav.settings"), href: "/settings", icon: Settings },
      enabled("nav.security") && { label: t("nav.security", undefined, "Security"), href: "/security", icon: LockKeyhole },
    ].filter((item): item is DashboardNavItem => Boolean(item)) },
    { label: t("nav.customize"), items: enabled("nav.customize") ? [{ label: t("nav.customize"), href: "/customize", icon: Palette }, enabled("nav.constellations") && { label: t("nav.constellations", undefined, "Constellations"), href: "/constellations", icon: UsersRound }].filter((item): item is DashboardNavItem => Boolean(item)) : [] },
    { label: t("nav.links"), items: enabled("nav.links") ? [{ label: t("nav.links"), href: "/links", icon: Link2 }] : [] },
  ].filter((group) => group.items.length), [enabled, t]);
  const moreItems = useMemo(() => [
    enabled("nav.templates") && { label: t("nav.templates"), href: "/templates", icon: BookOpen },
    enabled("nav.leaderboard") && { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    enabled("nav.premium") && { label: t("nav.premium"), href: "/premium", icon: Sparkles },
  ].filter((item): item is DashboardNavItem => Boolean(item)), [enabled, t]);
  const accountGroup = groups.find((group) => group.label === t("nav.account"));
  const customizeGroup = groups.find((group) => group.label === t("nav.customize"));
  const linksGroup = groups.find((group) => group.label === t("nav.links"));
  const accountActive = Boolean(accountGroup?.items.some((item) => isActive(pathname, item.href)));
  const customizeActive = Boolean(customizeGroup?.items.some((item) => isActive(pathname, item.href)));
  useEffect(() => {
    if (premiumActive) setPremiumOpen(true);
    if (accountActive) setAccountOpen(true);
    if (customizeActive) setCustomizeOpen(true);
  }, [accountActive, customizeActive, premiumActive]);
  const searchable = useMemo(() => {
    const items = [
      ...groups.flatMap((group) => group.items),
      ...moreItems,
      { label: t("nav.help"), href: "/help", icon: CircleHelp },
    ];
    if (user?.isAdmin || user?.isStaff) items.push({ label: t("nav.admin"), href: "/admin", icon: ShieldCheck });
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  }, [groups, moreItems, query, t, user?.isAdmin, user?.isStaff]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-[76px] shrink-0 items-center justify-between px-5">
        <Link href="/" onClick={close} className="flex items-center gap-3">
          <Image src="/dashboard/apple-touch-icon.png" alt="Misa.lol" width={36} height={36} className="h-9 w-9 rounded-2xl object-cover shadow-[0_0_25px_rgba(225,29,72,.28)]" />
          <span className="text-[15px] font-semibold tracking-[-.02em]">Misa<span className="text-[#fb7185]">.lol</span></span>
        </Link>
        <div className="flex items-center gap-1">
          {onToggleDesktop && <button type="button" className="sidebar-close hidden md:flex" onClick={onToggleDesktop} aria-label="Close navigation" title="Close navigation"><X size={18} strokeWidth={1.8} /></button>}
          <button type="button" className="sidebar-close md:hidden" onClick={close} aria-label={t("nav.close")}><X size={18} /></button>
        </div>
      </div>
      <div className="relative px-4">
        <label className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-white/[.06] bg-white/[.025] px-3 text-start text-xs text-zinc-500 transition focus-within:border-white/[.16] focus-within:text-zinc-300">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchable[0]) {
                router.push(searchable[0].href);
                setQuery("");
                setSearchOpen(false);
                close();
              }
            }}
            placeholder={t("nav.search")}
            className="h-full w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500"
          />
        </label>
        {searchOpen && query.trim() && (
          <div className="absolute inset-x-4 top-12 z-20 overflow-hidden rounded-xl border border-white/[.08] bg-[#0d0d14] py-1 shadow-xl">
            {searchable.length === 0 ? <p className="px-3 py-2 text-xs text-zinc-600">{t("nav.searchEmpty")}</p> : searchable.map(({ label, href, icon: Icon }) => (
              <Link key={href} href={href} prefetch={false} onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); setSearchOpen(false); close(); }} className="flex h-9 items-center gap-2.5 px-3 text-xs text-zinc-400 hover:bg-white/[.05] hover:text-white">
                <Icon size={14} />{label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <nav className="mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-5">
        {accountGroup ? (
          <div>
            <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} className={`flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-semibold text-white transition ${accountActive ? "bg-[#e11d48]/20" : "bg-white/[.035] hover:bg-white/[.06]"}`}>
              <LayoutDashboard size={17} className={accountActive ? "text-[#fda4af]" : "text-zinc-300"} />
              <span className="flex-1">{accountGroup.label}</span>
              <ChevronRight size={15} className={`transition-transform ${accountOpen ? "rotate-90" : ""}`} />
            </button>
            {accountOpen ? <div className="mt-1.5 space-y-1 ps-2">{accountGroup.items.map((item) => <NavLink key={item.href} {...item} close={close} />)}</div> : null}
          </div>
        ) : null}
        {customizeGroup ? (
          <div>
            <button type="button" onClick={() => setCustomizeOpen((open) => !open)} aria-expanded={customizeOpen} className={`flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-semibold text-white transition ${customizeActive ? "bg-[#e11d48]/20" : "hover:bg-white/[.055]"}`}>
              <Palette size={17} className={customizeActive ? "text-[#fda4af]" : "text-zinc-300"} />
              <span className="flex-1">{customizeGroup.label}</span>
              <ChevronRight size={15} className={`transition-transform ${customizeOpen ? "rotate-90" : ""}`} />
            </button>
            {customizeOpen ? <div className="mt-1.5 space-y-1 ps-2">{customizeGroup.items.map((item) => <NavLink key={item.href} {...item} close={close} />)}</div> : null}
          </div>
        ) : null}
        {linksGroup?.items.map((item) => <NavLink key={item.href} {...item} close={close} />)}
        {(user?.isAdmin || user?.isStaff) ? <NavLink href="/admin" label={t("nav.admin")} icon={ShieldCheck} close={close} /> : null}
        {moreItems.map((item) => item.href !== "/premium" ? <NavLink key={item.href} {...item} close={close} /> : <div key={item.href}>
          <button type="button" onClick={() => { if (!premiumActive) setPremiumOpen(v => !v); else setPremiumOpen(true); }} aria-expanded={premiumOpen || premiumActive} className={`flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-semibold text-white transition ${premiumActive ? "bg-[#e11d48]/20" : "hover:bg-white/[.055]"}`}><Sparkles size={17} className={premiumActive ? "text-[#fda4af]" : "text-zinc-300"} /><span className="flex-1">{item.label}</span><ChevronRight size={15} className={`transition-transform ${premiumOpen || premiumActive ? "rotate-90" : ""}`} /></button>
          {(premiumOpen || premiumActive) && <div className="mt-1.5 space-y-1 ps-7">{premiumItems.map(child => { const active = premiumActive && (premiumView === child.view || (child.view === "general" && !["layout", "metadata"].includes(premiumView))); return <Link key={child.view} href={`/premium?view=${child.view}`} scroll={false} onClick={close} aria-current={active ? "page" : undefined} className={`flex min-h-10 items-center rounded-xl px-3 text-sm transition ${active ? "bg-white/[.06] text-white" : "text-zinc-400 hover:bg-white/[.04] hover:text-white"}`}>{child.label}</Link>; })}</div>}
        </div>)}
        <div className="pt-2">
          <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-2.5">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-400">{t("language.label")}</p>
            <LanguageSelect compact />
          </div>
        </div>
        <div className="rounded-[24px] border border-white/[.06] bg-white/[.025] p-2">
          <NavLink href="/help" label={t("nav.help")} icon={CircleHelp} close={close} />
          {myPage ? <a href={myPage} target="_blank" rel="noopener noreferrer" className="mt-1 flex min-h-11 items-center gap-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"><ExternalLink size={17} />{t("nav.myPage", undefined, "My page")}</a> : <Link href="/settings" onClick={close} className="mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-zinc-400"><ExternalLink size={17} />Complete your profile</Link>}
          {myPage && <a href={myPage} target="_blank" rel="noopener noreferrer" className="mt-1 flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white transition hover:bg-white/[.055]"><Share2 size={17} className="text-zinc-300" />{t("nav.share")}</a>}
        </div>
      </nav>
      <div className="shrink-0 border-t border-white/[.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 rounded-[26px] border border-white/[.06] bg-white/[.035] p-2.5 shadow-[0_12px_30px_rgba(0,0,0,.18)]">
          {avatarUrl ? <Image src={avatarUrl} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/10" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5d4ea4] to-[#241d45] text-xs font-semibold text-white">{initials}</div>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">@{config.profile.username}</p>
            <div className="flex items-center gap-1">
              <p className="truncate font-mono text-[10px] text-zinc-400">{user?.accountId || "Generating..."}</p>
              {user?.accountId && <button type="button" aria-label="Copy Account ID" title="Copy Account ID" onClick={() => void copyAccountId()} className="rounded-full p-1 text-zinc-400 hover:bg-white/[.08] hover:text-white">{copiedAccountId ? <Check size={11} /> : <Copy size={11} />}</button>}
            </div>
          </div>
          <button type="button" aria-label={t("nav.logout")} title={t("nav.logout")} onClick={() => void logout()} className="rounded-full p-2 text-zinc-300 hover:bg-white/[.08] hover:text-white"><LogOut size={15} /></button>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isReady } = useAuth();
  const { dir, locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const mobileSidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileSidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const items = [...(mobileSidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input') || [])].filter(el => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const resize = () => { if (window.innerWidth >= 768) setOpen(false); };
    document.addEventListener("keydown", key); window.addEventListener("resize", resize);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); window.removeEventListener("resize", resize); previous?.focus(); };
  }, [open]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const localPreview = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_LOCAL_PREVIEW === "true";
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("misa.dashboard.sidebarCollapsed") === "1");
  }, []);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    window.localStorage.setItem("misa.dashboard.sidebarCollapsed", next ? "1" : "0");
  };
  const isPublicProfile = pathname.startsWith("/p/") || pathname.startsWith("/c/") || pathname === "/constellations/examples";
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/dashboard/admin" || pathname.startsWith("/dashboard/admin/") || pathname === "/m" || pathname.startsWith("/m/");
  useEffect(() => {
    if (!localPreview && !isPublicProfile && !isAdminRoute && isReady && !user) {
      window.location.replace(`${process.env.NEXT_PUBLIC_AUTH_ORIGIN || "http://127.0.0.1:8000"}/login`);
    }
  }, [isAdminRoute, isPublicProfile, isReady, localPreview, user]);
  useEffect(() => { setOpen(false); }, [pathname]);
  if (isPublicProfile || isAdminRoute) return <>{children}</>;
  if (!localPreview && (!isReady || !user)) {
    return (
      <div className="app-shell min-h-[100svh] bg-[#07070a]" aria-busy="true">
        <aside className="sidebar-glass fixed inset-y-0 start-0 hidden w-[280px] border-e p-4 md:block">
          <div className="h-10 w-32 animate-pulse rounded-xl bg-white/[.06]" />
          <div className="mt-10 space-y-3">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded-xl bg-white/[.035]" />)}</div>
        </aside>
        <div className="md:ps-[280px]">
          <header className="h-[68px] border-b border-white/[.06] bg-[#07070a]/80 md:hidden" />
          <main className="mx-auto max-w-[1360px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
            <div className="h-8 w-56 animate-pulse rounded-xl bg-white/[.07]" />
            <div className="mt-4 h-4 w-full max-w-md animate-pulse rounded-lg bg-white/[.04]" />
            <p className="mt-5 text-xs text-zinc-600">{isReady ? t("nav.redirecting") : t("nav.loading")}</p>
          </main>
        </div>
      </div>
    );
  }

  if (!localPreview && !user?.username) return <UsernameClaimGate />;
  return (
    <div className="app-shell min-h-screen" dir={dir} lang={locale}>
      <aside id="desktop-navigation" inert={sidebarCollapsed} aria-hidden={sidebarCollapsed} className={`sidebar-glass desktop-sidebar fixed inset-y-0 start-0 z-50 hidden w-[280px] border-e md:block ${sidebarCollapsed ? "is-collapsed" : ""}`}><SidebarContent close={() => undefined} onToggleDesktop={toggleSidebar} /></aside>
      <button type="button" className={`sidebar-edge sidebar-glass fixed top-1/2 z-[51] hidden h-12 w-8 -translate-y-1/2 items-center justify-center rounded-xl border text-zinc-300 shadow-lg hover:text-white md:flex ${sidebarCollapsed ? "is-collapsed" : ""}`} onClick={toggleSidebar} aria-expanded={!sidebarCollapsed} aria-controls="desktop-navigation" aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {open && (
        <>
          <button type="button" className="animate-fade-in fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} aria-label={t("nav.close")} />
          <aside ref={mobileSidebar} role="dialog" aria-modal="true" aria-label="Navigation" className="sidebar-glass animate-slide-in fixed inset-y-0 start-0 z-50 w-[min(288px,calc(100vw-16px))] border-e md:hidden"><SidebarContent close={() => setOpen(false)} /></aside>
        </>
      )}
      <div inert={open} className={`dashboard-content ${sidebarCollapsed ? "md:ps-10" : "md:ps-[280px]"}`}>
        <header className="sticky top-0 z-30 flex h-[68px] items-center border-b border-white/[.06] bg-[#07070a]/70 px-4 backdrop-blur-xl sm:px-8 md:hidden">
          <button type="button" onClick={() => setOpen(true)} className="rounded-[11px] border border-[#e11d48]/30 bg-[#e11d48]/10 p-2 text-[#fecdd3] hover:bg-[#e11d48]/20" aria-label={t("nav.open")}><Menu size={19} /></button>
          <div className="ms-3 flex items-center gap-2 text-sm font-semibold"><Image src="/dashboard/apple-touch-icon.png" alt="" width={30} height={30} className="h-7 w-7 rounded-lg object-cover" />Misa<span className="text-[#fb7185]">.lol</span></div>
        </header>
        <RuntimeErrorBoundary resetKey={pathname}>{children}</RuntimeErrorBoundary>
      </div>
    </div>
  );
}
