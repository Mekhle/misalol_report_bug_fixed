"use client";

import { BadgeCheck, Check, ChevronRight, Crown, Lock, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BadgeArtwork } from "@/components/badges/BadgeArtwork";
import { Button, FieldLabel, Modal, PageHeader, SectionTitle, TextArea, TextInput } from "@/components/ui";
import { cacheBadgeCollection, loadBadgeCollection, peekBadgeCollection, type AchievementBadge, type AchievementCollection, type AchievementRank } from "@/lib/badges";

const rarityTone: Record<string, string> = {
  COMMON: "text-zinc-400 border-white/10",
  UNCOMMON: "text-emerald-300 border-emerald-300/20",
  RARE: "text-sky-300 border-sky-300/20",
  EPIC: "text-violet-300 border-violet-300/20",
  LEGENDARY: "text-amber-300 border-amber-300/20",
};

function BadgeVisual({ badge, className }: { badge: AchievementBadge; className: string }) {
  const hasArtwork = Boolean(badge.previewUrl || badge.icon || (!badge.animated && badge.assetUrl));
  return hasArtwork ? <BadgeArtwork badge={badge} className={className} /> : <ShieldCheck className={className} style={{ color: badge.color }} />;
}

function featuredBadgeIds(collection: AchievementCollection | null | undefined) {
  return (collection?.badges || [])
    .filter((item) => item.owned && item.featured)
    .sort((a, b) => Number(a.featured_order || 0) - Number(b.featured_order || 0))
    .map((item) => item.id);
}

export function BadgesManager() {
  const [collection, setCollection] = useState<AchievementCollection | null>(() => peekBadgeCollection() || null);
  const [selected, setSelected] = useState<string[]>(() => featuredBadgeIds(peekBadgeCollection()));
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<AchievementBadge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const load = async (force = false) => {
    setError("");
    try {
      const next = await loadBadgeCollection(force);
      setCollection(next);
      setSelected(featuredBadgeIds(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your badges.");
    }
  };
  useEffect(() => { void load(); }, []);
  const toggleFeatured = (badge: AchievementBadge) => {
    if (!badge.owned) return;
    setSaved(false);
    setSelected((current) => current.includes(badge.id) ? current.filter((id) => id !== badge.id) : current.length < (collection?.featuredLimit || 5) ? [...current, badge.id] : current);
  };
  const saveFeatured = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/badges/me/featured", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ badge_ids: selected }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not save featured badges.");
      if (collection) {
        const next = { ...collection, badges: collection.badges.map((badge) => ({ ...badge, featured: selected.includes(badge.id), enabled: selected.includes(badge.id) })) };
        setCollection(next);
        cacheBadgeCollection(next);
      }
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save featured badges."); }
    finally { setBusy(false); }
  };
  const filtered = useMemo(() => (collection?.badges || []).filter((badge) => {
    const categoryMatch = category === "all" || badge.category_slug === category;
    const text = `${badge.name} ${badge.description} ${badge.rarity}`.toLowerCase();
    return categoryMatch && text.includes(search.trim().toLowerCase());
  }), [collection, category, search]);
  const owned = collection?.badges.filter((item) => item.owned) || [];
  const rank = collection?.currentRank;
  return (
    <main className="mx-auto min-h-screen max-w-[1280px] px-4 py-7 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader eyebrow="COLLECTION" title="Badges & ranks" description="Your milestones, rank progression, and the badges you choose to feature." action={<Button variant="accent" onClick={() => void saveFeatured()} disabled={busy || !collection}>{busy ? "Saving…" : saved ? "Saved" : "Save featured"}</Button>} />
      {error && <div role="alert" className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200"><span>{error}</span><button type="button" onClick={() => void load(true)} className="shrink-0 font-medium text-white underline underline-offset-4">Retry</button></div>}
      {!collection ? <div className="surface rounded-2xl p-10 text-center text-sm text-zinc-500">Loading your collection…</div> : <>
        <RankHero rank={rank} next={collection.ranks.find((item) => !item.owned)} />
        <section className="mt-8">
          <SectionTitle icon={Sparkles} title="Featured on your profile" description={`Choose up to ${collection.featuredLimit} badges. Nothing changes until you press Save featured.`} />
          <div className="surface flex min-h-24 flex-wrap items-center gap-3 rounded-2xl p-4">
            {selected.length ? selected.map((id, index) => { const badge = owned.find((item) => item.id === id); return badge ? <button key={id} type="button" onClick={() => toggleFeatured(badge)} className="group relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[.04]" title={`Remove ${badge.name}`}><BadgeVisual badge={badge} className="h-8 w-8" /><span className="absolute -right-1 -top-1 rounded-full bg-[#e11d48] px-1.5 text-[9px] text-white">{index + 1}</span></button> : null; }) : <p className="text-sm text-zinc-600">Select an owned badge below to feature it.</p>}
          </div>
        </section>
        <section className="mt-10">
          <SectionTitle icon={BadgeCheck} title="Badge collection" description={`${owned.length} earned · ${collection.badges.length - owned.length} locked`} />
          <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative"><Search size={15} className="absolute left-3 top-3.5 text-zinc-600" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search badges" className="h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] pl-9 pr-3 text-sm text-zinc-200 outline-none focus:border-[#e11d48]/50" /></div>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-xl border border-white/[.08] bg-[#0d0d12] px-3 text-sm text-zinc-300 outline-none"><option value="all">All categories</option>{collection.categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((badge) => <BadgeCard key={badge.id} badge={badge} selected={selected.includes(badge.id)} limitReached={selected.length >= collection.featuredLimit} onFeature={() => toggleFeatured(badge)} onDetail={() => setDetail(badge)} />)}</div>
          {!filtered.length && <p className="surface rounded-2xl p-8 text-center text-sm text-zinc-600">No badges match that filter.</p>}
        </section>
        <section className="mt-10"><SectionTitle icon={Crown} title="Rank path" description="Ranks and included badges are configured by the misa.lol team." /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{collection.ranks.map((item) => <RankCard key={item.id} rank={item} />)}</div></section>
        <VerificationCard owned={collection.badges.some((item) => item.id === "verified" && item.owned)} />
      </>}
      <Modal open={Boolean(detail)} title={detail?.name || "Badge"} description={detail?.description || ""} onClose={() => setDetail(null)}>{detail && <div className="space-y-4"><div className="flex items-center gap-4"><span className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-white/[.04]"><BadgeVisual badge={detail} className="h-12 w-12" /></span><div><p className={`text-xs uppercase tracking-[.16em] ${rarityTone[detail.rarity]?.split(" ")[0] || "text-zinc-400"}`}>{detail.rarity}</p><p className="mt-2 text-sm text-zinc-400">{detail.owned ? `Earned${detail.earned_at ? ` ${new Date(detail.earned_at).toLocaleDateString()}` : ""}` : "Locked"}</p></div></div>{detail.progress && <Progress progress={detail.progress} />}{detail.purchasable && <p className="rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-xs text-zinc-500">Purchases are prepared but not active yet.</p>}</div>}</Modal>
    </main>
  );
}

function RankHero({ rank, next }: { rank: AchievementRank | null | undefined; next?: AchievementRank }) {
  return <section className="relative overflow-hidden rounded-3xl border border-violet-300/10 bg-[radial-gradient(circle_at_15%_20%,rgba(139,92,246,.18),transparent_38%),rgba(255,255,255,.025)] p-5 sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-violet-200"><Crown size={28} /></span><div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-[.18em] text-violet-300/70">Current rank</p><h2 className="mt-1 text-2xl font-semibold text-white">{rank?.name || "Unranked"}</h2><p className="mt-1 text-sm text-zinc-500">{rank?.description || "Complete milestones to earn your first rank."}</p></div>{next?.progress && <div className="w-full sm:max-w-xs"><p className="mb-2 text-xs text-zinc-400">Next: {next.name}</p><Progress progress={next.progress} /></div>}</div></section>;
}

function Progress({ progress }: { progress: { current: number; target: number; label: string; percent: number } }) {
  return <div><div className="mb-2 flex justify-between text-[11px] text-zinc-500"><span>{progress.current.toLocaleString()} / {progress.target.toLocaleString()} {progress.label}</span><span>{progress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-[#e11d48]" style={{ width: `${progress.percent}%` }} /></div></div>;
}

function BadgeCard({ badge, selected, limitReached, onFeature, onDetail }: { badge: AchievementBadge; selected: boolean; limitReached: boolean; onFeature: () => void; onDetail: () => void }) {
  return <article className={`group min-w-0 rounded-2xl border bg-white/[.025] p-4 transition ${badge.owned ? "border-white/[.09] hover:border-violet-300/25" : "border-white/[.06] opacity-70"}`}><div className="flex items-start gap-3"><button type="button" onClick={onDetail} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[.08] bg-black/20">{badge.previewUrl || badge.icon ? <BadgeArtwork badge={badge} className="h-7 w-7" /> : badge.owned ? <ShieldCheck size={21} style={{ color: badge.color }} /> : <Lock size={18} />}</button><button type="button" onClick={onDetail} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium text-zinc-100">{badge.name}</p>{badge.owned && <Check size={13} className="text-emerald-300" />}</div><p className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] tracking-wider ${rarityTone[badge.rarity] || rarityTone.COMMON}`}>{badge.rarity}</p></button><ChevronRight size={14} className="mt-1 text-zinc-700" /></div><p className="mt-3 line-clamp-2 min-h-8 text-xs leading-4 text-zinc-600">{badge.description}</p>{badge.progress && <div className="mt-3"><Progress progress={badge.progress} /></div>}{badge.owned && <button type="button" onClick={onFeature} disabled={!selected && limitReached} className={`mt-4 w-full rounded-xl border px-3 py-2 text-xs transition ${selected ? "border-[#e11d48]/40 bg-[#e11d48]/15 text-white" : "border-white/[.07] text-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"}`}>{selected ? "Featured" : "Feature badge"}</button>}</article>;
}

function RankCard({ rank }: { rank: AchievementRank }) {
  return <article className={`rounded-2xl border p-4 ${rank.owned ? "border-violet-300/20 bg-violet-300/[.05]" : "border-white/[.07] bg-white/[.02]"}`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.08]" style={{ color: rank.color }}><Crown size={19} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-100">{rank.name}</p><p className="text-[10px] uppercase tracking-[.14em] text-zinc-600">Level {rank.level}</p></div>{rank.owned ? <span className="text-xs text-emerald-300">Earned</span> : <Lock size={14} className="text-zinc-600" />}</div><p className="mt-3 text-xs leading-5 text-zinc-500">{rank.description}</p>{rank.progress && <div className="mt-4"><Progress progress={rank.progress} /></div>}{Boolean(rank.badges?.length) && <p className="mt-3 text-[10px] text-zinc-600">Includes {rank.badges?.map((item) => item.name).join(", ")}</p>}</article>;
}

function VerificationCard({ owned }: { owned: boolean }) {
  const [status, setStatus] = useState<"none" | "pending" | "approved" | "rejected" | "verified">(owned ? "verified" : "none");
  const [reason, setReason] = useState(""); const [proofUrl, setProofUrl] = useState(""); const [reviewNote, setReviewNote] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/v1/verification/me", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((data) => { if (["pending","approved","rejected","verified"].includes(data.status)) setStatus(data.status); setReason(data.reason || ""); setProofUrl(data.proofUrl || ""); setReviewNote(data.reviewNote || ""); }).catch(() => undefined); }, []);
  const apply = async () => { setBusy(true); setError(""); try { const response = await fetch("/api/v1/verification/me", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, proofUrl }) }); const data = await response.json(); if (!response.ok) throw new Error(data.detail || "Could not send request."); setStatus(data.status || "pending"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send request."); } finally { setBusy(false); } };
  return <section className="mt-10"><SectionTitle icon={BadgeCheck} title="Verification" description="Request the verified badge for an established public identity." /><div className="surface rounded-2xl p-4">{owned || status === "verified" || status === "approved" ? <p className="text-sm text-emerald-300">Your account is verified.</p> : status === "pending" ? <p className="text-sm text-zinc-300">Your verification request is under review.</p> : <div className="space-y-3">{status === "rejected" && <p className="text-sm text-amber-200">{reviewNote || "Your previous request was not approved."}</p>}<div><FieldLabel>Why should this profile be verified?</FieldLabel><TextArea value={reason} onChange={setReason} placeholder="Explain your public identity and audience." /></div><div><FieldLabel>Proof link</FieldLabel><TextInput value={proofUrl} onChange={setProofUrl} placeholder="https://" /></div>{error && <p className="text-xs text-red-300">{error}</p>}<Button variant="accent" onClick={() => void apply()} disabled={busy || reason.trim().length < 12}>{busy ? "Sending…" : "Request verification"}</Button></div>}</div></section>;
}