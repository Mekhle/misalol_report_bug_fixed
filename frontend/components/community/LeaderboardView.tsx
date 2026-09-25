"use client";

import { Eye, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader, SectionTitle } from "@/components/ui";
import { loadLeaderboard, type LeaderboardEntry, type LeaderboardRange } from "@/lib/community";
import { useT } from "@/lib/i18n";

const RANGES: Array<[LeaderboardRange, string]> = [["7D", "Week"], ["30D", "Month"], ["ALL", "All time"]];

export function LeaderboardView() {
  const t = useT();
  const [range, setRange] = useState<LeaderboardRange>("7D");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [you, setYou] = useState<LeaderboardEntry | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const publicOrigin = process.env.NEXT_PUBLIC_AUTH_ORIGIN || "http://127.0.0.1:8000";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void loadLeaderboard(range).then((data) => {
      if (cancelled) return;
      setEntries(data.entries || []);
      setYou(data.you);
      setStatus("ready");
    }).catch(() => {
      if (cancelled) return;
      setEntries([]);
      setYou(null);
      setStatus("error");
    });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader eyebrow="Leaderboard" title={t("community.title")} description={t("community.description")} />
      <div className="mb-6 flex flex-wrap gap-2">
        {RANGES.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setRange(id)} className={"rounded-xl border px-3 py-2 text-xs transition " + (range === id ? "border-[#e11d48]/60 bg-[#e11d48]/15 text-white" : "border-white/[.08] text-zinc-500 hover:border-[#e11d48]/35 hover:text-white")}>{label}</button>
        ))}
      </div>
      {you && (
        <div className="surface mb-6 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-[.14em] text-zinc-500">{t("community.yourPlace")}</p>
          <EntryRow entry={you} href={publicOrigin + "/" + you.username} highlight />
        </div>
      )}
      <section className="surface rounded-2xl p-4 sm:p-5">
        <SectionTitle icon={Trophy} title="Most popular profiles" description={status === "error" ? t("community.loadFail") : "Public profiles ranked by profile views."} />
        {status === "ready" && entries.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">{t("community.empty")}</p>}
        <div className="divide-y divide-white/[.06]">
          {entries.map((entry) => (
            <EntryRow key={entry.username} entry={entry} href={publicOrigin + "/" + entry.username} highlight={you?.username === entry.username} />
          ))}
        </div>
      </section>
    </main>
  );
}

function EntryRow({ entry, href, highlight }: { entry: LeaderboardEntry; href: string; highlight?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={"flex items-center gap-3 px-1 py-3 " + (highlight ? "text-white" : "text-zinc-300 hover:bg-white/[.03]")}>
      <span className="w-8 text-right font-mono text-xs text-zinc-500">{entry.rank ?? "-"}</span>
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] text-sm font-semibold">
        {entry.avatar ? <img src={entry.avatar} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
        {(entry.displayName || entry.username).slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{entry.displayName}</span>
        <span className="block truncate text-xs text-zinc-500">@{entry.username}</span>
      </span>
      <span className="flex items-center gap-1.5 text-sm text-zinc-300"><Eye size={14} className="text-[#fb7185]" />{entry.views.toLocaleString()}</span>
    </a>
  );
}