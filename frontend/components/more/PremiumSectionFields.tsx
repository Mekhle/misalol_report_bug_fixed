"use client";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { IntegrationCard } from "@/lib/premium";
import { WIDGET_CATALOG, COMMON_TIMEZONES } from "@/lib/widgets";
import { SKILLS } from "@/lib/skills";
import type { ProfileSection } from "@/lib/types";
import { PremiumSelect, PremiumToggle } from "./PremiumControls";

export function PremiumSectionFields({ item, onChange }: { item: ProfileSection; onChange: (patch: Partial<ProfileSection>) => void }) {
  const [side, setSide] = useState<"leftCard" | "rightCard" | null>(null);
  const [draft, setDraft] = useState<IntegrationCard>({ enabled: true, type: "github", value: "" });
  const [query, setQuery] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const tags = item.tags || [];
  const options = [{ id: "presence", name: "Discord presence" }, ...WIDGET_CATALOG.map(w => ({ id: w.id, name: w.label }))];
  const openCard = (key: "leftCard" | "rightCard") => { setDraft(item[key] || { enabled: true, type: "github", value: "" }); setSide(key); };
  return <div className="mt-4 space-y-3">{item.type === "about" && <label className="block text-sm text-zinc-300">Subtitle<input maxLength={160} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={item.subtitle || ""} onChange={e => onChange({ subtitle: e.target.value })} /></label>}
    {(item.type === "about" || item.type === "skills") && <><div className="flex flex-wrap gap-2">{tags.map(tag => <button type="button" aria-label={`Remove ${tag}`} key={tag} className="min-h-10 rounded-lg bg-white/10 px-3 text-xs" onClick={() => onChange({ tags: tags.filter(t => t !== tag) })}>{tag} ×</button>)}</div><Button onClick={() => setSkillsOpen(true)}>Choose skills</Button></>}
    {(item.type === "about" || item.type === "integration") && <div className="grid gap-2 sm:grid-cols-2">{(["leftCard", "rightCard"] as const).map(key => <Button key={key} onClick={() => openCard(key)}>{key === "leftCard" ? "Left" : "Right"} card · {item[key]?.enabled ? options.find(o => o.id === item[key]?.type)?.name : "Disabled"}</Button>)}</div>}
    <Modal open={side !== null} title={`${side === "leftCard" ? "Left" : "Right"} integration card`} onClose={() => setSide(null)}><div className="space-y-5"><PremiumToggle label="Show card" checked={draft.enabled} onChange={enabled => setDraft(d => ({ ...d, enabled }))} /><PremiumSelect label="Provider" value={draft.type} options={options} onChange={v => setDraft({ enabled: draft.enabled, type: v as IntegrationCard["type"], value: v === "timezone" ? "UTC" : "" })} />{draft.type === "presence" ? <p className="text-sm text-zinc-400">Uses your connected Discord account and existing presence integration.</p> : draft.type === "timezone" ? <PremiumSelect label="Timezone" value={draft.value} options={[...new Set([draft.value, ...COMMON_TIMEZONES])]} onChange={value => setDraft(d => ({ ...d, value }))} /> : <label className="block text-sm">{WIDGET_CATALOG.find(w => w.id === draft.type)?.placeholder}<input maxLength={500} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={draft.value} onChange={e => setDraft(d => ({ ...d, value: e.target.value }))} /></label>}<p className="text-xs text-zinc-500">Public data is cached. Private or unavailable accounts show an unavailable state.</p><div className="flex gap-2"><Button variant="accent" onClick={() => { if (side) onChange({ [side]: draft }); setSide(null); }}>Apply card</Button><Button onClick={() => setSide(null)}>Cancel</Button></div></div></Modal>
    <Modal open={skillsOpen} title="Choose skills" onClose={() => setSkillsOpen(false)}><label className="block text-sm">Search skills<input type="search" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="mt-4 flex max-h-72 flex-wrap gap-2 overflow-y-auto">{SKILLS.filter(s => s.toLowerCase().includes(query.toLowerCase())).map(skill => <button type="button" aria-pressed={tags.includes(skill)} disabled={!tags.includes(skill) && tags.length >= 16} key={skill} className={`min-h-11 rounded-xl border px-3 text-sm disabled:opacity-40 ${tags.includes(skill) ? "border-rose-400 bg-rose-500/20" : "border-white/10 bg-white/5"}`} onClick={() => onChange({ tags: tags.includes(skill) ? tags.filter(t => t !== skill) : [...tags, skill] })}>{skill}</button>)}</div><p className="my-4 text-xs text-zinc-500">{tags.length}/16 selected. Custom tags in the module editor are also supported.</p><Button onClick={() => setSkillsOpen(false)}>Done</Button></Modal>
  </div>;
}
