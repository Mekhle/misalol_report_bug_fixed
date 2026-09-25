"use client";

import { Briefcase, ChevronDown, ChevronUp, Plus, Trash2, Upload } from "lucide-react";
import { PremiumSectionFields } from "@/components/more/PremiumSectionFields";
import { useRef, useState } from "react";
import { Button, FieldLabel, SectionTitle, TextArea, TextInput, Toggle } from "@/components/ui";
import { IMAGE_ACCEPT } from "@/lib/image-edit";
import { useT } from "@/lib/i18n";
import { uploadProfileAsset, useProfile } from "@/lib/profile-store";
import type { ProfileSection, SectionType } from "@/lib/types";
import { MAX_SECTIONS, SECTION_CATALOG, defaultSection, sectionLabel, tagsFromInput, tagsToInput } from "@/lib/sections";

export function PortfolioPanel({ premium = false }: { premium?: boolean }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const t = useT();
  const { config, updateConfig } = useProfile();
  const sections = config.sections || [];

  const addSection = (type: SectionType) => {
    updateConfig((current) => {
      const list = current.sections || [];
      if (list.length >= MAX_SECTIONS) return current;
      return { ...current, sections: [...list, defaultSection(type)] };
    });
  };

  const patch = (id: string, next: Partial<ProfileSection>) => {
    updateConfig((current) => ({
      ...current,
      sections: (current.sections || []).map((item) => item.id === id ? { ...item, ...next } : item),
    }));
  };

  const remove = (id: string) => {
    updateConfig((current) => ({ ...current, sections: (current.sections || []).filter((item) => item.id !== id) }));
  };

  const move = (id: string, direction: -1 | 1) => {
    updateConfig((current) => {
      const list = [...(current.sections || [])];
      const index = list.findIndex((item) => item.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= list.length) return current;
      [list[index], list[next]] = [list[next], list[index]];
      return { ...current, sections: list };
    });
  };

  return (
    <div>
      <SectionTitle icon={Briefcase} title={t("customize.portfolioTitle")} description={t("customize.portfolioDesc")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {SECTION_CATALOG.filter(item => premium || item.id !== "integration").map((item) => (
          <Button key={item.id} variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => addSection(item.id)} disabled={sections.length >= MAX_SECTIONS}>
            <Plus size={13} />{t(`section.${item.id}`, undefined, item.label)}
          </Button>
        ))}
      </div>
      {sections.length === 0 && <p className="rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-5 text-sm text-zinc-500">{t("customize.sectionsEmpty")}</p>}
      <div className="space-y-3">
        {sections.map((item, index) => (
          <div key={item.id} onDragOver={event => { if (dragging) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragging && dragging !== item.id) updateConfig(c => { const list = [...c.sections]; const from = list.findIndex(s => s.id === dragging), to = list.findIndex(s => s.id === item.id); if (from < 0 || to < 0) return c; const [section] = list.splice(from, 1); list.splice(to, 0, section); return { ...c, sections: list }; }); setDragging(null); }} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p draggable={premium} onDragStart={() => setDragging(item.id)} onDragEnd={() => setDragging(null)} className="text-sm font-medium text-zinc-200">{t(`section.${item.type}`, undefined, sectionLabel(item.type))}</p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(item.id, -1)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30"><ChevronUp size={14} /></button>
                <button type="button" aria-label="Move down" disabled={index === sections.length - 1} onClick={() => move(item.id, 1)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30"><ChevronDown size={14} /></button>
                <button type="button" aria-label="Remove section" onClick={() => remove(item.id)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-red-300"><Trash2 size={14} /></button>
              </div>
            </div>
            <SectionFields item={item} onChange={(next) => patch(item.id, next)} />
            {premium && <PremiumSectionFields item={item} onChange={next => patch(item.id, next)} />}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-zinc-400">{t("customize.showOnProfile")}</span>
              <Toggle label={t("customize.showOnProfile")} checked={item.enabled} onChange={(checked) => patch(item.id, { enabled: checked })} />
            </div>
          </div>
        ))}
      </div>
      {sections.length >= MAX_SECTIONS && <p className="mt-3 text-xs text-zinc-600">{t("customize.sectionsMax", { count: MAX_SECTIONS })}</p>}
    </div>
  );
}

function SectionFields({ item, onChange }: { item: ProfileSection; onChange: (next: Partial<ProfileSection>) => void }) {
  const t = useT();
  if (item.type === "skills") {
    return (
      <div className="space-y-3">
        <div>
          <FieldLabel>{t("customize.fieldTitle")}</FieldLabel>
          <TextInput value={item.title} onChange={(value) => onChange({ title: value })} placeholder={t("customize.skills")} />
        </div>
        <div>
          <FieldLabel>{t("customize.skills")}</FieldLabel>
          <TextInput value={tagsToInput(item.tags)} onChange={(value) => onChange({ tags: tagsFromInput(value) })} placeholder="Design, Python, Photography" />
        </div>
      </div>
    );
  }
  if (item.type === "project") {
    return (
      <div className="space-y-3">
        <div>
          <FieldLabel>{t("customize.fieldTitle")}</FieldLabel>
          <TextInput value={item.title} onChange={(value) => onChange({ title: value })} placeholder={t("section.project")} />
        </div>
        <div>
          <FieldLabel>{t("customize.fieldDesc")}</FieldLabel>
          <TextArea value={item.body} onChange={(value) => onChange({ body: value })} placeholder="A short Markdown note." />
        </div>
        <div>
          <FieldLabel>{t("customize.link")}</FieldLabel>
          <TextInput value={item.href || ""} onChange={(value) => onChange({ href: value })} placeholder="https://" />
        </div>
        <div>
          <FieldLabel>{t("customize.tags")}</FieldLabel>
          <TextInput value={tagsToInput(item.tags)} onChange={(value) => onChange({ tags: tagsFromInput(value) })} placeholder="web, music, 2026" />
        </div>
        <CoverField cover={item.cover} onChange={(cover) => onChange({ cover })} />
      </div>
    );
  }
  if (item.type === "lyrics") {
    return (
      <div className="space-y-3">
        <div>
          <FieldLabel>{t("customize.fieldTitle")}</FieldLabel>
          <TextInput value={item.title} onChange={(value) => onChange({ title: value })} placeholder={t("section.lyrics")} />
        </div>
        <div>
          <FieldLabel>{t("customize.lrc")}</FieldLabel>
          <textarea value={item.body} onChange={(event) => onChange({ body: event.target.value })} placeholder={"[00:12.00]First line\n[00:16.50]Second line"} rows={7} className="w-full resize-y rounded-[11px] border border-white/[.08] bg-white/[.025] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e11d48]/60 focus:bg-white/[.04] focus:ring-2 focus:ring-[#e11d48]/10" />
          <p className="mt-2 text-[11px] text-zinc-600">{t("customize.lyricsHint")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{t("customize.fieldTitle")}</FieldLabel>
        <TextInput value={item.title} onChange={(value) => onChange({ title: value })} placeholder={item.type === "about" ? t("section.about") : t("customize.fieldTitle")} />
      </div>
      <div>
        <FieldLabel>{t("customize.markdown")}</FieldLabel>
        <textarea value={item.body} onChange={(event) => onChange({ body: event.target.value })} placeholder={"**Bold**, *italic*, [links](https://misa.lol), and lists."} rows={6} className="w-full resize-y rounded-[11px] border border-white/[.08] bg-white/[.025] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e11d48]/60 focus:bg-white/[.04] focus:ring-2 focus:ring-[#e11d48]/10" />
      </div>
    </div>
  );
}

function CoverField({ cover, onChange }: { cover?: ProfileSection["cover"]; onChange: (cover: ProfileSection["cover"]) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (file.size > 3_000_000) {
      window.alert(t("customize.coverTooLarge"));
      return;
    }
    const version = ++revision.current;
    setBusy(true); setError("");
    try { const asset = await uploadProfileAsset("cover", file); if (version === revision.current) onChange(asset); }
    catch (error) { if (version === revision.current) setError(error instanceof Error ? error.message : "Could not upload this image."); }
    finally { if (version === revision.current) setBusy(false); }
  };
  return (
    <div>
      <FieldLabel>{t("customize.cover")}</FieldLabel>
      {busy && <p role="status" className="mb-2 text-xs text-zinc-400">Uploading…</p>}{error && <p role="alert" className="mb-2 text-xs text-red-300">{error}</p>}
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] text-zinc-500">
          {cover?.url ? <img src={cover.url} alt="" className="h-full w-full object-cover" /> : <Upload size={16} />}
        </div>
        <input ref={input} className="hidden" type="file" accept={IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        <Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => input.current?.click()}>{cover?.url ? t("common.replace") : t("common.upload")}</Button>
        {cover?.url && <button type="button" onClick={() => { revision.current++; setBusy(false); setError(""); onChange({ url: null, remove: true }); }} className="text-xs text-zinc-600 hover:text-red-300">{t("common.remove")}</button>}
      </div>
    </div>
  );
}
