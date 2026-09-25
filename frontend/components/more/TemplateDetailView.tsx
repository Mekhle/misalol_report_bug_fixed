"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Share2 } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-store";
import { useProfile } from "@/lib/profile-store";
import { useT } from "@/lib/i18n";
import { applyTemplate, getTemplateBySlug, type ProfileTemplate } from "@/lib/templates";
import type { ProfileConfig } from "@/lib/types";

export function TemplateDetailView({ slug }: { slug: string }) {
  const t = useT();
  const { user } = useAuth();
  const { hydrateFromServer } = useProfile();
  const [template, setTemplate] = useState<ProfileTemplate | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getTemplateBySlug(slug).then((value) => {
      if (!cancelled) setTemplate(value);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Template not found.");
    });
    return () => { cancelled = true; };
  }, [slug]);

  const apply = async () => {
    if (!template) return;
    setApplying(true);
    setError("");
    try {
      const result = await applyTemplate(template.id);
      if (result.profile) hydrateFromServer(result.profile as ProfileConfig);
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that template.");
    } finally {
      setApplying(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setError(t("templates.shareCopied", undefined, "Template link copied."));
    } catch {
      setError(url);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader eyebrow={t("templates.eyebrow")} title={template?.name || t("templates.preview", undefined, "Template preview")} description={template?.description || t("templates.loading")} action={<Link href="/templates"><Button variant="ghost"><ArrowLeft size={15} />{t("common.back", undefined, "Back")}</Button></Link>} />
      {error && <p className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2.5 text-xs text-red-200">{error}</p>}
      {template && <section className="surface rounded-2xl p-5 sm:p-7">
        <div className="relative mb-6 h-52 overflow-hidden rounded-2xl border border-white/[.06]" style={{ background: `linear-gradient(145deg, ${template.preview.accentColor}66, ${template.preview.backgroundColor} 55%, #0c0c12)` }}>{template.previewImageUrl ? <img src={template.previewImageUrl} alt={`${template.name} preview`} className="absolute inset-0 h-full w-full object-cover" /> : <div className="flex h-full items-end p-5"><span className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: `${template.preview.accentColor}33`, color: template.preview.textColor }}>{template.preview.layout}</span></div>}</div>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500"><span>{template.preview.layout}</span><span>·</span><span>{template.visibility}</span>{template.preview.hasBackground && <><span>·</span><span>{t("templates.background")}</span> </>}{template.preview.hasAudio && <><span>·</span><span>{t("templates.audio")}</span></>}</div>
        {template.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{template.tags.map((tag) => <span key={tag} className="rounded-full border border-white/[.08] px-2.5 py-1 text-[11px] text-zinc-500">{tag}</span>)}</div>}
        <div className="mt-6 flex flex-wrap gap-2"><Button variant={applied ? "accent" : "subtle"} disabled={applying || !user?.username} onClick={() => void apply()}>{applying ? t("templates.applying") : applied ? <><Check size={13} />{t("templates.applied")}</> : t("templates.apply")}</Button><Button variant="ghost" onClick={() => void share()}><Share2 size={14} />{t("common.share")}</Button>{user?.username && <a href={`/dashboard/p/${encodeURIComponent(user.username)}`} target="_blank" rel="noreferrer"><Button variant="ghost"><ExternalLink size={14} />{t("common.viewLivePage")}</Button></a>}</div>
      </section>}
    </main>
  );
}
