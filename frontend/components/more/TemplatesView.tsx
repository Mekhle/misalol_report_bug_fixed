"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Check, ExternalLink, Heart, Palette, RefreshCw, Search, Share2, Trash2 } from "lucide-react";
import { Button, PageHeader, SectionTitle, TextArea, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth-store";
import { useProfile } from "@/lib/profile-store";
import { publicProfileUrl } from "@/lib/share";
import {
  applyTemplate,
  deleteTemplate,
  favoriteTemplate,
  listMyTemplates,
  listTemplates,
  publishTemplate,
  refreshTemplate,
  updateTemplate,
  type ProfileTemplate,
} from "@/lib/templates";
import { useT } from "@/lib/i18n";
import type { ProfileConfig } from "@/lib/types";

const MANUAL_PREVIEW_MAX_BYTES = 1_800_000;

export function TemplatesView({ creatorOnly = false }: { creatorOnly?: boolean } = {}) {
  const t = useT();
  const { user } = useAuth();
  const { hydrateFromServer } = useProfile();
  const canCreate = Boolean(user?.isTemplateCreator || user?.isAdmin);
  const [items, setItems] = useState<ProfileTemplate[]>([]);
  const [mine, setMine] = useState<ProfileTemplate[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState("");
  const [applied, setApplied] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"latest" | "popular" | "week" | "month" | "all_time">("latest");
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<ProfileTemplate["visibility"]>("public");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [publishProgress, setPublishProgress] = useState(0);

  const loadGallery = (filters?: { q?: string; tag?: string; sort?: "latest" | "popular" | "week" | "month" | "all_time" }) => listTemplates(filters ?? { q: query, tag, sort }).then(setItems);
  const loadMine = () => canCreate ? listMyTemplates().then(setMine).catch(() => setMine([])) : Promise.resolve();

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    Promise.all([loadGallery(), loadMine()])
      .then(() => { if (!cancelled) setStatus("ready"); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load templates.");
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [canCreate]);

  useEffect(() => {
    if (!publishing) {
      setPublishProgress(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setPublishProgress(Math.min(95, Math.round(((Date.now() - started) / 10000) * 100)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [publishing]);

  const apply = async (item: ProfileTemplate) => {
    setApplying(item.id);
    setError("");
    try {
      const result = await applyTemplate(item.id);
      if (result.profile) hydrateFromServer(result.profile as ProfileConfig);
      setApplied(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that template.");
    } finally {
      setApplying("");
    }
  };

  const publish = async () => {
    setPublishing(true);
    const processingStarted = Date.now();
    setError("");
    try {
      await publishTemplate(name.trim(), description.trim(), tagsInput.split(",").map((value) => value.trim()).filter(Boolean), visibility, previewImageUrl);
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, 10000 - (Date.now() - processingStarted))));
      setPublishProgress(100);
      setName("");
      setDescription("");
      setTagsInput("");
      setVisibility("public");
      setPreviewImageUrl(null);
      setPreviewFileName("");
      await Promise.all([loadGallery(), loadMine()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish that template.");
    } finally {
      setPublishing(false);
    }
  };

  const toggleFavorite = async (item: ProfileTemplate) => {
    setBusyId(item.id);
    setError("");
    try {
      const result = await favoriteTemplate(item.id, !item.is_favorite);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_favorite: result.favorite } : entry));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that favorite.");
    } finally {
      setBusyId("");
    }
  };

  const shareTemplate = async (item: ProfileTemplate) => {
    const url = `${window.location.origin}/dashboard/templates/${encodeURIComponent(item.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      setError(t("templates.shareCopied", undefined, "Template link copied."));
    } catch {
      setError(url);
    }
  };

  const runMine = async (id: string, work: () => Promise<void>) => {
    setBusyId(id);
    setError("");
    try {
      await work();
      await Promise.all([loadGallery(), loadMine()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that template.");
    } finally {
      setBusyId("");
    }
  };

  const liveHref = user?.username ? publicProfileUrl(user.username) : "";

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader
        eyebrow={t("templates.eyebrow")}
        title={t("templates.title")}
        description={t("templates.description")}
        action={liveHref ? <a href={liveHref} target="_blank" rel="noreferrer"><Button variant="ghost"><ExternalLink size={15} />{t("common.viewLivePage")}</Button></a> : undefined}
      />
      {error && <p className="mb-4 text-xs text-red-300">{error}</p>}
      {!creatorOnly && <section>
        <SectionTitle icon={BookOpen} title={t("templates.gallery")} description={t("templates.galleryDesc")} />
        {status === "loading" && <p className="text-sm text-zinc-500">{t("templates.loading")}</p>}
        {status === "error" && !items.length && <p className="text-sm text-zinc-500">{t("templates.unavailable")}</p>}
        <div className="surface mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_180px_190px_auto]">
          <div className="relative"><Search size={15} className="absolute left-3 top-3.5 text-zinc-600" /><TextInput value={query} onChange={setQuery} placeholder={t("templates.search", undefined, "Search templates")} className="pl-9" /></div>
          <TextInput value={tag} onChange={setTag} placeholder={t("templates.tagPh", undefined, "Filter by tag")} />
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-10 rounded-xl border border-white/[.1] bg-[#15151d] px-3 text-sm text-zinc-200 outline-none focus:border-[#9b87f5]">
            <option value="latest">Latest</option>
            <option value="popular">Most Popular</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all_time">All Time</option>
          </select>
          <Button variant="accent" onClick={() => void loadGallery()}><Search size={14} />{t("common.search")}</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.id} className="surface overflow-hidden rounded-2xl">
              <div className="relative"><TemplateSwatch preview={item.preview} name={item.name} imageUrl={item.previewImageUrl} /><button type="button" aria-label={item.is_favorite ? "Remove favorite" : "Add favorite"} className="absolute right-3 top-3 rounded-lg bg-black/35 p-1.5 text-zinc-300 backdrop-blur-sm hover:text-[#f4c542]" disabled={busyId === item.id} onClick={() => void toggleFavorite(item)}><Heart size={18} fill={item.is_favorite ? "currentColor" : "none"} /></button></div>
              <div className="p-5 pt-1"><div className="flex items-start gap-2"><p className="flex-1 text-sm font-medium text-white">{item.name}</p></div>
              <p className="mt-1 text-xs text-zinc-500">{item.description || `${item.preview.layout} · ${item.preview.backgroundEffect}`}</p>
              <p className="mt-2 text-[11px] text-zinc-600">
                {item.preview.layout}
                {item.preview.hasBackground ? ` · ${t("templates.background")}` : ""}
                {item.preview.hasAudio ? ` · ${t("templates.audio")}` : ""}
                {item.creator_username ? ` · @${item.creator_username}` : ""}
              </p>
              {item.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((entry) => <span key={entry} className="rounded-full border border-white/[.08] px-2 py-1 text-[10px] text-zinc-500">{entry}</span>)}</div>}
              <div className="mt-4 flex flex-wrap gap-2"><Button variant={applied === item.id ? "accent" : "subtle"} className="h-9 min-h-0 flex-1 px-3 text-xs" disabled={Boolean(applying) || !user?.username} onClick={() => void apply(item)}>{applying === item.id ? t("templates.applying") : applied === item.id ? <><Check size={13} />{t("templates.applied")}</> : t("templates.apply")}</Button><Link href={`/templates/${encodeURIComponent(item.slug)}`}><Button variant="ghost" className="h-9 min-h-0 px-3 text-xs"><ExternalLink size={13} />{t("templates.preview", undefined, "Preview")}</Button></Link><Button variant="ghost" className="h-9 min-h-0 px-3 text-xs" onClick={() => void shareTemplate(item)}><Share2 size={13} />{t("common.share")}</Button></div></div>
            </article>
          ))}
        </div>
        {status === "ready" && !items.length && <p className="text-sm text-zinc-500">{t("templates.empty")}</p>}
      </section>}
      {canCreate && (
        <section className="mt-10">
          <SectionTitle icon={Palette} title={t("templates.publishTitle")} description={t("templates.publishDesc")} />
          <div className="surface mb-6 grid gap-3 rounded-2xl p-5">
            <TextInput value={name} onChange={setName} placeholder={t("templates.namePh")} />
            <TextArea value={description} onChange={setDescription} placeholder={t("templates.descPh")} />
            <TextInput value={tagsInput} onChange={setTagsInput} placeholder={t("templates.tagsPh", undefined, "Tags separated by commas")} />
            <label className="flex flex-col gap-2 text-xs text-zinc-500">
              <span>{t("templates.previewUpload", undefined, "Preview image (optional)")}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={publishing} onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                  setError("Preview must be a JPEG, PNG, or WebP image.");
                  event.target.value = "";
                  return;
                }
                if (file.size > MANUAL_PREVIEW_MAX_BYTES) {
                  setError("Preview image must be smaller than 1.8 MB.");
                  event.target.value = "";
                  return;
                }
                setError("");
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") {
                    setPreviewImageUrl(reader.result);
                    setPreviewFileName(file.name);
                  }
                };
                reader.onerror = () => setError("Could not read that preview image.");
                reader.readAsDataURL(file);
              }} className="w-full rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2 text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-[#e11d48]/20 file:px-3 file:py-1.5 file:text-xs file:text-[#c9c0ff]" />
              {previewImageUrl && <span className="flex items-center gap-2 text-[11px] text-zinc-500"><img src={previewImageUrl} alt="Template preview" className="h-12 w-20 rounded-lg border border-white/[.08] object-cover" /><span className="min-w-0 flex-1 truncate">{previewFileName}</span><button type="button" className="text-[#fda4af] hover:text-white" onClick={() => { setPreviewImageUrl(null); setPreviewFileName(""); }}>Remove</button></span>}
            </label>
            <label className="flex items-center gap-3 text-xs text-zinc-500"><span>{t("templates.visibility", undefined, "Visibility")}</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as ProfileTemplate["visibility"])} className="rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2 text-xs text-zinc-200"><option value="public">{t("templates.public", undefined, "Public")}</option><option value="unlisted">{t("templates.unlisted", undefined, "Unlisted")}</option><option value="private">{t("templates.private", undefined, "Private")}</option></select></label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="accent" disabled={publishing || name.trim().length < 2} onClick={() => void publish()}>
                {publishing ? t("templates.publishing") : t("templates.publishLook")}
              </Button>
              {publishing && <div className="flex w-36 items-center gap-2" role="progressbar" aria-label={t("templates.publishing")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={publishProgress}>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.08]"><div className="h-full rounded-full bg-[#e11d48] transition-[width] duration-100" style={{ width: `${publishProgress}%` }} /></div>
                <span className="w-8 text-right text-[10px] text-zinc-600">{publishProgress}%</span>
              </div>}
              <Link href="/customize"><Button variant="ghost">{t("templates.openCustomize")}</Button></Link>
            </div>
          </div>
          <div className="surface divide-y divide-white/[.06] rounded-2xl">
            {mine.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="text-sm text-zinc-200">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.published ? t("common.published") : t("common.unpublished")} · {item.visibility} · {item.preview.layout}</p>
                  {item.tags.length > 0 && <p className="mt-1 text-[11px] text-zinc-600">{item.tags.join(" · ")}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" disabled={busyId === item.id} onClick={() => void runMine(item.id, () => refreshTemplate(item.id, item.previewImageUrl).then(() => undefined))}>
                    <RefreshCw size={13} />{t("templates.refresh")}
                  </Button>
                  <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" disabled={busyId === item.id} onClick={() => void runMine(item.id, () => updateTemplate(item.id, { published: !item.published }).then(() => undefined))}>
                    {item.published ? t("common.unpublish") : t("common.publish")}
                  </Button>
                  <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs" onClick={() => void shareTemplate(item)}><Share2 size={13} />{t("common.share")}</Button>
                  <Button variant="ghost" className="h-8 min-h-0 px-2 text-xs text-red-300" disabled={busyId === item.id} onClick={() => { if (window.confirm(t("templates.confirmDelete", { name: item.name }))) return runMine(item.id, () => deleteTemplate(item.id)); }}>
                    <Trash2 size={13} />{t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            {!mine.length && <p className="p-8 text-center text-xs text-zinc-600">{t("templates.noneMine")}</p>}
          </div>
        </section>
      )}
      {!canCreate && (
        <p className="mt-8 text-xs text-zinc-600">{t("templates.creatorOnly")}</p>
      )}
    </main>
  );
}

function TemplateSwatch({ preview, name, imageUrl }: { preview: ProfileTemplate["preview"]; name: string; imageUrl?: string | null }) {
  const initials = name.trim().slice(0, 1).toUpperCase() || "M";
  const effect = preview.backgroundEffect && preview.backgroundEffect !== "none"
    ? `radial-gradient(circle at 78% 18%, ${preview.accentColor}66, transparent 42%), linear-gradient(145deg, ${preview.backgroundColor}, #0c0c12)`
    : `linear-gradient(145deg, ${preview.accentColor}44, ${preview.backgroundColor} 58%, #0c0c12)`;
  return (
    <div
      className="relative h-40 overflow-hidden rounded-t-2xl border-b border-white/[.06] p-2"
      style={{ background: effect }}
    >
      {imageUrl ? <img src={imageUrl} alt={`${name} preview`} className="absolute inset-0 h-full w-full object-cover" /> : null}
      {!imageUrl && <div className="mx-auto flex h-full max-w-[170px] items-center justify-center">
        <div className="w-full rounded-lg border p-2 text-center shadow-lg" style={{ background: `${preview.backgroundColor}d9`, borderColor: `${preview.accentColor}55`, color: preview.textColor }}>
          <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: `${preview.accentColor}cc`, color: preview.backgroundColor }}>{initials}</div>
          <p className="mt-1 truncate text-[9px] font-semibold">{name}</p>
          <div className="mx-auto mt-1 flex max-w-[115px] justify-center gap-1"><span className="h-1.5 w-8 rounded-full" style={{ background: `${preview.textColor}66` }} /><span className="h-1.5 w-5 rounded-full" style={{ background: `${preview.textColor}33` }} /><span className="h-1.5 w-6 rounded-full" style={{ background: `${preview.textColor}33` }} /></div>
          <div className="mt-2 flex justify-center gap-1"><span className="rounded px-1.5 py-0.5 text-[7px]" style={{ background: `${preview.accentColor}33`, color: preview.textColor }}>{preview.layout}</span>{preview.hasBackground && <span className="rounded px-1.5 py-0.5 text-[7px]" style={{ background: `${preview.textColor}14`, color: `${preview.textColor}aa` }}>image</span>}{preview.hasAudio && <span className="rounded px-1.5 py-0.5 text-[7px]" style={{ background: `${preview.textColor}14`, color: `${preview.textColor}aa` }}>audio</span>}</div>
        </div>
      </div>}
    </div>
  );
}
