"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, CircleHelp, ExternalLink, LifeBuoy, Mail, Search, Share2 } from "lucide-react";
import { Button, PageHeader, SectionTitle, TextInput } from "@/components/ui";
import { useProfile } from "@/lib/profile-store";
import { HELP_CATEGORIES, SUPPORT_EMAIL, findHelpArticle, searchHelp, type HelpArticle, type HelpCategory } from "@/lib/help";
import { useT } from "@/lib/i18n";
import { publicProfileUrl } from "@/lib/share";

function categoryLabel(t: ReturnType<typeof useT>, item: HelpCategory | "All") {
  if (item === "All") return t("help.catAll");
  if (item === "Setup") return t("help.catSetup");
  if (item === "Customize") return t("help.catCustomize");
  if (item === "Account") return t("help.catAccount");
  return t("help.catTroubleshooting");
}

export function HelpCenterView() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { config } = useProfile();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<HelpCategory | "All">("All");
  const selected = findHelpArticle(params.get("article"));
  const results = useMemo(() => {
    const all = searchHelp("", category);
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => {
      const title = t(`helpArticles.${item.id}.title`, undefined, item.title).toLowerCase();
      const summary = t(`helpArticles.${item.id}.summary`, undefined, item.summary).toLowerCase();
      if (title.includes(needle) || summary.includes(needle)) return true;
      return searchHelp(query, category).some((match) => match.id === item.id);
    });
  }, [query, category, t]);
  const liveHref = config.profile.username ? publicProfileUrl(config.profile.username) : "";

  const openArticle = (id: string) => {
    router.replace(`/help?article=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader
        eyebrow={t("help.eyebrow")}
        title={t("help.title")}
        description={t("help.description")}
        action={<a href={`mailto:${SUPPORT_EMAIL}`}><Button variant="accent"><Mail size={15} />{t("common.emailSupport")}</Button></a>}
      />
      {selected ? (
        <ArticleView article={selected} onBack={() => router.replace("/help", { scroll: false })} />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-3.5 text-zinc-600" />
              <TextInput value={query} onChange={setQuery} placeholder={t("help.search")} className="pl-9" />
            </div>
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {(["All", ...HELP_CATEGORIES] as Array<HelpCategory | "All">).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`rounded-xl border px-3 py-2 text-xs ${category === item ? "border-[#e11d48]/50 bg-[#e11d48]/15 text-white" : "border-white/[.08] text-zinc-500 hover:text-white"}`}
              >
                {categoryLabel(t, item)}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {results.map((item) => (
              <button key={item.id} type="button" onClick={() => openArticle(item.id)} className="surface surface-hover flex w-full items-start gap-4 rounded-2xl p-5 text-left">
                <span className="icon-glass mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#fda4af]"><CircleHelp size={17} /></span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-[.16em] text-[#fb7185]">{categoryLabel(t, item.category)}</span>
                  <span className="mt-1 block text-sm font-medium text-white">{t(`helpArticles.${item.id}.title`, undefined, item.title)}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">{t(`helpArticles.${item.id}.summary`, undefined, item.summary)}</span>
                </span>
              </button>
            ))}
            {!results.length && <p className="surface rounded-2xl p-8 text-center text-sm text-zinc-500">{t("help.empty")}</p>}
            {liveHref && (
              <a href={liveHref} target="_blank" rel="noreferrer" className="surface surface-hover flex items-start gap-4 rounded-2xl p-5">
                <span className="icon-glass mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#fda4af]"><Share2 size={17} /></span>
                <span>
                  <span className="block text-sm font-medium text-white">{t("help.liveTitle")}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">{t("help.liveDesc")}</span>
                </span>
              </a>
            )}
          </div>
        </>
      )}
      <section className="mt-8">
        <SectionTitle icon={LifeBuoy} title={t("help.contact")} description={t("help.contactDesc")} />
        <div className="surface flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm text-white">{SUPPORT_EMAIL}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("help.contactHint")}</p>
          </div>
          <a href={`mailto:${SUPPORT_EMAIL}`}><Button variant="subtle"><Mail size={15} />{t("help.write")}</Button></a>
        </div>
      </section>
    </main>
  );
}

function ArticleView({ article, onBack }: { article: HelpArticle; onBack: () => void }) {
  const t = useT();
  return (
    <article className="surface rounded-2xl p-5 sm:p-6">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white">
        <ArrowLeft size={14} />{t("help.allGuides")}
      </button>
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#fb7185]">{categoryLabel(t, article.category)}</p>
      <h2 className="mt-2 text-xl font-semibold text-white">{t(`helpArticles.${article.id}.title`, undefined, article.title)}</h2>
      <p className="mt-2 text-sm text-zinc-500">{t(`helpArticles.${article.id}.summary`, undefined, article.summary)}</p>
      <div className="mt-5 space-y-3">
        {article.body.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-6 text-zinc-300">{paragraph}</p>
        ))}
      </div>
      {article.href && (
        <Link href={article.href} className="mt-6 inline-flex">
          <Button variant="accent"><ExternalLink size={15} />{article.href === "/" ? t("help.openOverview") : `${t("common.open")} ${article.href.slice(1)}`}</Button>
        </Link>
      )}
    </article>
  );
}
