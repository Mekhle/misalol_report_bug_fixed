"use client";

import { AlignCenter, AlignLeft, AlignRight, Check, GripVertical, Link2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { uploadProfileAsset, useProfile } from "@/lib/profile-store";
import { platformOptions } from "@/lib/mock-data";
import { composeSocialValue, createSocialId, defaultSocialAction, extractSocialHandle, isForeignSocialHost, isSafeSocialIconUrl, PLATFORM_ICON_COLORS, platformUrlPrefix, resolveIconColor, sanitizeSocialHref } from "@/lib/socials";
import type { ProfileAsset, SocialAction, SocialAlign, SocialLink, SocialPlatform } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { Button, FieldLabel, Modal, PageHeader, TextInput, Toggle } from "@/components/ui";
import { SocialIcon } from "./SocialIcon";
import { SocialLinks } from "./SocialLinks";

const MAX_SOCIALS = 40;
const aligns: Array<{ id: SocialAlign; label: string; icon: typeof AlignLeft }> = [
  { id: "left", label: "Left", icon: AlignLeft },
  { id: "center", label: "Center", icon: AlignCenter },
  { id: "right", label: "Right", icon: AlignRight },
];

export function LinksManager() {
  const t = useT();
  const { config, updateConfig, saveProfile, saveState } = useProfile();
  const [editing, setEditing] = useState<SocialLink | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPlatform, setNewPlatform] = useState<SocialPlatform>("YouTube");
  const [dragged, setDragged] = useState<string | null>(null);
  const active = config.socials.filter((social) => social.enabled);
  const hidden = config.socials.filter((social) => !social.enabled);
  const align = config.settings.socialAlign || "center";
  const remove = (id: string) => updateConfig((current) => ({ ...current, socials: current.socials.filter((social) => social.id !== id) }));
  const toggle = (id: string, value: boolean) => updateConfig((current) => ({ ...current, socials: current.socials.map((social) => social.id === id ? { ...social, enabled: value } : social) }));
  const addPlatform = (platform: SocialPlatform) => { setNewPlatform(platform); setAdding(true); };
  const reorder = (targetId: string) => {
    if (!dragged || dragged === targetId) return;
    updateConfig((current) => { const list=[...current.socials]; const from=list.findIndex((item)=>item.id===dragged); const to=list.findIndex((item)=>item.id===targetId); if(from<0||to<0)return current; const [item]=list.splice(from,1); list.splice(to,0,item); return {...current,socials:list}; });
    setDragged(null);
  };
  const setAlign = (socialAlign: SocialAlign) => updateConfig((current) => ({ ...current, settings: { ...current.settings, socialAlign } }));
  return <main className="mx-auto min-h-screen max-w-[1250px] px-4 py-8 sm:px-8 sm:py-11 xl:px-12">
    <PageHeader eyebrow={t("links.eyebrow")} title={t("links.title")} description={t("links.description")} action={<Button variant="accent" onClick={() => void saveProfile()} disabled={saveState === "saving"}>{saveState === "saving" ? t("common.saving") : saveState === "saved" ? <><Check size={15} />{t("common.saved")}</> : t("common.save")}</Button>} />
    <section className="mb-8 rounded-3xl border border-white/[.07] bg-white/[.025] p-4 sm:p-6">
      <div className="mb-5 flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e11d48]/10 text-[#fecdd3]"><Link2 size={18}/></span><div><h2 className="text-base font-semibold text-white">Link your social media profiles.</h2><p className="mt-1 text-xs text-zinc-500">Pick a social media to add to your profile.</p></div></div>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 xl:grid-cols-[repeat(13,minmax(0,1fr))]">{platformOptions.filter((platform)=>platform!=="Custom URL").map((platform)=><button key={platform} type="button" disabled={config.socials.length>=MAX_SOCIALS} onClick={()=>addPlatform(platform)} title={`Add ${platform}`} aria-label={`Add ${platform}`} className="group flex aspect-square min-h-12 items-center justify-center rounded-2xl border border-white/[.06] bg-black/20 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[.05] disabled:opacity-40"><SocialIcon platform={platform} size={22} color={PLATFORM_ICON_COLORS[platform]}/></button>)}</div>
      <button type="button" disabled={config.socials.length>=MAX_SOCIALS} onClick={()=>addPlatform("Custom URL")} className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-black/20 p-3 text-left transition hover:border-white/20 hover:bg-white/[.05] sm:max-w-md"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.05] text-zinc-300"><Link2 size={18}/></span><span><strong className="block text-sm text-white">Add Custom URL</strong><small className="text-xs text-zinc-500">Use any safe URL and choose an icon to match.</small></span></button>
    </section>
    <section className="mb-8 rounded-2xl border border-white/[.07] bg-white/[.02] p-4"><FieldLabel>{t("links.align")}</FieldLabel><div className="grid grid-cols-3 gap-2">{aligns.map(({id,icon:Icon})=><button key={id} type="button" onClick={()=>setAlign(id)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${align===id?"border-[#e11d48]/50 bg-[#e11d48]/10 text-white":"border-white/[.08] text-zinc-500"}`}><Icon size={14}/>{id==="left"?t("common.left"):id==="right"?t("common.right"):t("common.center")}</button>)}</div><div className="mt-4 rounded-xl border border-white/[.06] bg-black/25 px-4 py-3"><p className="mb-1 text-[10px] uppercase tracking-[.14em] text-zinc-600">{t("links.onProfile")}</p><SocialLinks config={config} className="mt-0"/></div></section>
    <div className="space-y-8"><LinkGroup title={t("links.active")} items={active} onEdit={setEditing} onRemove={remove} onToggle={toggle} onDragStart={setDragged} onDrop={reorder}/><LinkGroup title={t("links.hidden")} items={hidden} onEdit={setEditing} onRemove={remove} onToggle={toggle} onDragStart={setDragged} onDrop={reorder}/></div>
    <AddSocialModal key={editing?.id || (adding ? `new-${newPlatform}` : "closed")} open={adding || !!editing} initial={editing} initialPlatform={newPlatform} onClose={()=>{setAdding(false);setEditing(null);}} />
  </main>;
}

function LinkGroup({ title, items, onEdit, onRemove, onToggle, onDragStart, onDrop }: { title: string; items: SocialLink[]; onEdit: (item: SocialLink) => void; onRemove: (id: string) => void; onToggle: (id: string, value: boolean) => void; onDragStart: (id: string) => void; onDrop: (id: string) => void }) {
  const t = useT();
  return <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium text-zinc-300">{title}</h2><span className="rounded-full bg-white/[.06] px-2 py-1 text-[10px] text-zinc-500">{items.length}</span></div>{items.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <div key={item.id} draggable onDragStart={() => onDragStart(item.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(item.id)} className="surface surface-hover flex min-w-0 items-center gap-2.5 rounded-2xl p-3"><GripVertical size={16} className="shrink-0 cursor-grab text-zinc-700" /><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg" style={{ color: resolveIconColor(item), background: `${resolveIconColor(item)}16` }}><SocialIcon platform={item.platform} size={18} color={resolveIconColor(item)} customIcon={item.customIcon} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-200">{item.label}</p><p className="mt-1 truncate text-xs text-zinc-600">{defaultSocialAction(item) === "copy" ? t("links.copyAction") : t("links.openAction")} · {item.displayMode === "link" ? composeSocialValue(item.platform, item.value) : item.value}</p></div><button onClick={() => onEdit(item)} className="rounded-lg p-2 text-zinc-600 hover:bg-white/[.06] hover:text-white" aria-label={t("links.edit", { name: item.label })}><Pencil size={15} /></button><button onClick={() => onRemove(item.id)} className="rounded-lg p-2 text-zinc-600 hover:bg-red-400/10 hover:text-red-300" aria-label={`${t("common.delete")} ${item.label}`}><Trash2 size={15} /></button><Toggle label={item.label} checked={item.enabled} onChange={(value) => onToggle(item.id, value)} /></div>)}</div> : <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center text-xs text-zinc-600">{t("links.noHidden")}</div>}</section>;
}

function AddSocialModal({ open, initial, initialPlatform, onClose }: { open: boolean; initial: SocialLink | null; initialPlatform: SocialPlatform; onClose: () => void }) {
  const t = useT();
  const { config, updateConfig } = useProfile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [platform, setPlatform] = useState<SocialPlatform>(initial?.platform || initialPlatform);
  const [value, setValue] = useState(initial ? extractSocialHandle(initial.platform, initial.value) : "");
  const [label, setLabel] = useState(initial?.label || "");
  const [displayMode, setDisplayMode] = useState<SocialLink["displayMode"]>(initial?.displayMode || "link");
  const [action, setAction] = useState<SocialAction>(defaultSocialAction(initial || { displayMode: "link" }));
  const [iconColor, setIconColor] = useState(initial?.iconColor || "");
  const [glow, setGlow] = useState<"inherit" | "on" | "off">(initial?.iconGlow === true ? "on" : initial?.iconGlow === false ? "off" : "inherit");
  const [customIcon, setCustomIcon] = useState<ProfileAsset | null>(initial?.customIcon || null);
  const [error, setError] = useState("");

  const prefix = displayMode === "link" ? platformUrlPrefix(platform) : null;
  const save = () => {
    const handle = value.trim();
    if (!handle) { setError(prefix ? t("links.needPath") : t("links.needValue")); return; }
    if (prefix && isForeignSocialHost(platform, handle)) { setError(t("links.foreignHost")); return; }
    if (!initial && config.socials.length >= MAX_SOCIALS) { setError(t("links.maxSocials")); return; }
    const candidate = displayMode === "link" ? composeSocialValue(platform, handle) : handle;
    if (action === "open" && !sanitizeSocialHref(candidate, platform)) {
      setError(prefix ? t("links.badLink") : t("links.badOpen"));
      return;
    }
    updateConfig((current) => {
      const next: SocialLink = {
        id: initial?.id || createSocialId(platform),
        platform,
        label: label || platform,
        value: candidate,
        displayMode,
        enabled: initial?.enabled ?? true,
        clicks: initial?.clicks ?? 0,
        action,
        iconColor: iconColor || null,
        iconGlow: glow === "inherit" ? undefined : glow === "on",
        customIcon: isSafeSocialIconUrl(customIcon?.url) ? customIcon : null,
      };
      if (initial) return { ...current, socials: current.socials.map((item) => item.id === initial.id ? next : item) };
      return { ...current, socials: [...current.socials, next] };
    });
    onClose();
  };

  const uploadIcon = async (file: File) => {
    try {
      setCustomIcon(await uploadProfileAsset("socialIcon", file));
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("links.iconFail"));
    }
  };

  return <Modal open={open} title={initial ? t("links.edit", { name: initial.platform }) : t("links.add")} description={t("links.modalDesc")} onClose={onClose}>
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      <div><FieldLabel>{t("links.platform")}</FieldLabel><select value={platform} onChange={(e) => { const next = e.target.value as SocialPlatform; setValue(extractSocialHandle(next, value)); setPlatform(next); }} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#111117] px-3 text-sm text-white outline-none focus:border-[#e11d48]/60">{platformOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
      <div><FieldLabel>{t("links.displayMode")}</FieldLabel><div className="grid grid-cols-2 gap-2">{(["link", "text"] as const).map((mode) => <button key={mode} type="button" onClick={() => { setDisplayMode(mode); setAction(mode === "text" ? "copy" : "open"); }} className={`rounded-xl border px-3 py-2.5 text-left text-xs ${displayMode === mode ? "border-[#e11d48]/50 bg-[#e11d48]/10 text-white" : "border-white/[.08] text-zinc-500"}`}>{mode === "link" ? t("links.linkMode") : t("links.textMode")}<span className="mt-1 block text-[10px] text-zinc-600">{mode === "link" ? t("links.linkModeHint") : t("links.textModeHint")}</span></button>)}</div></div>
      <div><FieldLabel>{t("links.clickAction")}</FieldLabel><div className="grid grid-cols-2 gap-2">{([{ id: "open" as const, title: t("links.openAction"), hint: t("links.openHint") }, { id: "copy" as const, title: t("links.copyAction"), hint: t("links.copyHint") }]).map((option) => <button key={option.id} type="button" onClick={() => setAction(option.id)} className={`rounded-xl border px-3 py-2.5 text-left text-xs ${action === option.id ? "border-[#e11d48]/50 bg-[#e11d48]/10 text-white" : "border-white/[.08] text-zinc-500"}`}>{option.title}<span className="mt-1 block text-[10px] text-zinc-600">{option.hint}</span></button>)}</div></div>
      <div><FieldLabel>{t("links.label")}</FieldLabel><TextInput value={label} onChange={setLabel} placeholder={platform} /></div>
      <div>
        <FieldLabel>{displayMode === "text" ? t("links.text") : prefix ? t("links.username") : t("links.url")}</FieldLabel>
        {prefix ? (
          <div className="flex h-11 overflow-hidden rounded-[11px] border border-white/[.08] bg-white/[.025] focus-within:border-[#e11d48]/60 focus-within:ring-2 focus-within:ring-[#e11d48]/10">
            <span className="flex shrink-0 items-center bg-white/[.04] px-3 text-xs text-zinc-500" aria-hidden="true">{prefix.display}</span>
            <input
              aria-label={`${platform} username`}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              placeholder="yourname"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-600"
            />
          </div>
        ) : (
          <TextInput value={value} onChange={(next) => { setValue(next); setError(""); }} placeholder={displayMode === "link" ? "https://..." : "Available for collabs"} />
        )}
      </div>
      <div>
        <FieldLabel>{t("links.iconColor")}</FieldLabel>
        <div className="flex gap-2">
          <input aria-label="Icon color" type="color" value={iconColor || PLATFORM_ICON_COLORS[platform] || "#d8d3ff"} onChange={(e) => setIconColor(e.target.value)} className="h-11 w-12 cursor-pointer rounded-xl border-0 bg-transparent p-0" />
          <TextInput value={iconColor} onChange={setIconColor} placeholder={PLATFORM_ICON_COLORS[platform] || "Default icon color"} />
          {iconColor && <Button variant="ghost" className="shrink-0 px-3" onClick={() => setIconColor("")}>{t("common.default")}</Button>}
        </div>
      </div>
      <div><FieldLabel>{t("links.iconGlow")}</FieldLabel><div className="grid grid-cols-3 gap-2">{([{ id: "inherit" as const, title: t("links.inherit"), hint: t("links.inheritHint") }, { id: "on" as const, title: t("links.glowOn"), hint: t("links.glowOnHint") }, { id: "off" as const, title: t("links.glowOff"), hint: t("links.glowOffHint") }]).map((option) => <button key={option.id} type="button" onClick={() => setGlow(option.id)} className={`rounded-xl border px-3 py-2.5 text-left text-xs ${glow === option.id ? "border-[#e11d48]/50 bg-[#e11d48]/10 text-white" : "border-white/[.08] text-zinc-500"}`}>{option.title}<span className="mt-1 block text-[10px] text-zinc-600">{option.hint}</span></button>)}</div></div>
      <div>
        <FieldLabel>{t("links.customIcon")}</FieldLabel>
        <div className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.025] p-3">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] text-[#fecdd3]"><SocialIcon platform={platform} size={18} customIcon={customIcon} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs text-zinc-400">{customIcon?.name || t("links.iconHint")}</p></div>
          <input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadIcon(file); e.target.value = ""; }} />
          <Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => fileInput.current?.click()}><Upload size={13} />{customIcon?.url ? t("common.replace") : t("common.upload")}</Button>
          {customIcon?.url && <button type="button" onClick={() => setCustomIcon(null)} className="text-xs text-zinc-600 hover:text-red-300">{t("common.remove")}</button>}
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant="accent" onClick={save}>{initial ? t("common.save") : t("links.addLink")}</Button></div>
    </div>
  </Modal>;
}
