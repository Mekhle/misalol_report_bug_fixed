"use client";

import { portfolioPages, visibleSections, projectConfigured } from "@/lib/portfolio";
export { visibleSections } from "@/lib/portfolio";
import { useRef, type CSSProperties } from "react";
import { EmptyContent } from "./EmptyContent";
import { ProfileLyrics } from "./ProfileLyrics";
import { playlistTracks } from "@/lib/audio";
import { SectionWidget } from "./ProfileWidgets";
import { DiscordPresenceTile } from "./ProfileCardModules";
import { renderSafeMarkdown } from "@/lib/markdown";
import { sectionCoverSrc } from "@/lib/sections";
import type { ProfileConfig, ProfileSection } from "@/lib/types";

export function ProfileSections({ config, preview = false, portfolio = false }: { config: ProfileConfig; preview?: boolean; portfolio?: boolean }) {
  const sections = visibleSections(config);
  const swap = Boolean(config.settings.widgetColorSwap);
  const ink = config.settings.backgroundColor;
  const accent = config.settings.accentColor;
  const root = useRef<HTMLDivElement>(null);
  if (sections.length === 0) return null;
  return (
    <div ref={root} className={portfolio ? "portfolio-sections" : "profile-sections mt-6 space-y-2.5 text-left"} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      {portfolio ? portfolioPages(config).map(page => <section key={page.id} data-portfolio-section={page.id} data-section-title={page.title} className="portfolio-section">
        <div className="portfolio-section-content">
          {page.showcase && page.title && <h2>{page.title}</h2>}
          {page.showcase ? <div className={`portfolio-showcase ${page.items.length === 1 ? "portfolio-feature" : ""}`}>{page.items.map(item => <SectionCard key={item.id} item={item} config={config} preview={preview} swap={swap} accent={accent} ink={ink} />)}</div> : page.items.map(item => <SectionCard key={item.id} item={item} config={config} preview={preview} swap={swap} accent={accent} ink={ink} />)}
        </div>
      </section>) : sections.map(item => <SectionCard key={item.id} item={item} config={config} preview={preview} swap={swap} accent={accent} ink={ink} />)}
    </div>
  );
}

function SectionCard({ item, config, preview, swap, accent, ink }: { item: ProfileSection; config: ProfileConfig; preview: boolean; swap: boolean; accent: string; ink: string }) {
  const className = `rounded-2xl border p-3 ${swap ? "" : "border-white/[.1] bg-black/25 text-white"}`;
  const style = swap ? { backgroundColor: accent, color: ink, borderColor: `${ink}33` } : undefined;
  const enabledCards = (["leftCard", "rightCard"] as const).filter(side => item[side]?.enabled);
  const configuredCards = enabledCards.filter(side => item[side]?.type === "presence" || item[side]?.value?.trim());
  const cards = configuredCards.length ? configuredCards : enabledCards.slice(0, 1);
  const muted = swap ? { opacity: 0.7 } : undefined;
  if (item.type === "skills") {
    return <Skills tags={item.tags} />;
  }
  if (item.type === "project") {
    const cover = sectionCoverSrc(config.profile.username, item, preview);
    if (!projectConfigured(item)) return <EmptyContent title={item.title} subtitle={item.subtitle} />;
    const inner = (
      <>
        {cover ? <img key={cover} src={cover} onError={event => { event.currentTarget.style.display = "none"; }} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{item.title}</h2>
          {item.body ? <Markdown body={item.body} className="mt-1 text-[13px] leading-5" style={muted} /> : null}
          {!!item.tags?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => <span key={tag} className={`rounded-full px-2 py-0.5 text-[10px] ${swap ? "" : "bg-white/10 text-white/80"}`} style={swap ? { backgroundColor: `${ink}22` } : undefined}>{tag}</span>)}
            </div>
          )}
        </div>
      </>
    );
    if (item.href) {
      return <a href={item.href} target="_blank" rel="noopener noreferrer" className={`${className} profile-project flex items-start gap-3 no-underline`} style={style}>{inner}<span className="project-visit">visit <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg></span></a>;
    }
    return <section className={`${className} profile-project flex items-start gap-3`} style={style}>{inner}</section>;
  }
  if (item.type === "lyrics") {
    return <ProfileLyrics body={item.body} trackId={playlistTracks(config.assets)[0]?.id} />;
  }
  if (item.type === "integration" && !item.body && !item.leftCard?.enabled && !item.rightCard?.enabled) return <><h2>{item.title}</h2><EmptyContent subtitle={item.subtitle} /></>;
  if (!preview && !item.body && !item.title && !item.subtitle && !item.tags?.length && !item.leftCard?.enabled && !item.rightCard?.enabled) return null;
  return (
    <section className={`${className} profile-introduction`} style={style}>
      {item.title && <h2 className="text-sm font-semibold">{item.title}</h2>}
      {item.subtitle && <p className="mt-1 text-xs opacity-60">{item.subtitle}</p>}

      {item.body ? <Markdown body={item.body} className="profile-introduction-card" style={muted} /> : preview ? <p className="text-[11px] opacity-50">Add Markdown in Portfolio.</p> : null}
      <Skills tags={item.tags} />
      <div className="profile-section-cards">{cards.map(side => { const card = item[side]; return card?.enabled ? <div key={side}>{card.type === "presence" ? <DiscordPresenceTile config={config} /> : <SectionWidget config={config} id={`${item.id.slice(0, 38)}-${side === "leftCard" ? "l" : "r"}`} type={card.type} value={card.value} />}</div> : null; })}</div>
    </section>
  );
}

function Markdown({ body, className, style }: { body: string; className?: string; style?: CSSProperties }) {
  return <div className={`profile-rich-text [&_a]:underline [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_h2]:text-sm [&_h3]:text-sm [&_li]:my-0.5 [&_ol]:ml-4 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal ${className || ""}`} style={style} dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(body) }} />;
}

function Skills({ tags }: { tags?: string[] }) {
  return tags?.length ? <div className="profile-skills" aria-label="Skills">{tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div> : null;
}
