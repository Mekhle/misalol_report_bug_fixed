"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-store";
import { useProfile, uploadProfileAsset, dataUrlToFile } from "@/lib/profile-store";
import { premiumSettings } from "@/lib/premium";
import { DraftPreviewBoundary } from "@/lib/draft-preview";
import { SharingAppearance, type ShareCropKey } from "@/components/sharing/SharingAppearance";
import { ImageCropModal } from "@/components/customization/ImageCropModal";
import { ProfilePreviewButton } from "@/components/profile/ProfilePreviewButton";
import { useSearchParams } from "next/navigation";
import type { ProfileAsset, ProfileConfig } from "@/lib/types";
import { PremiumGeneral } from "./PremiumGeneral";
import { PremiumLayout } from "./PremiumLayout";
import { EffectColors } from "@/components/customization/EffectColors";

export function PremiumView() {
  return <DraftPreviewBoundary><PremiumContent /></DraftPreviewBoundary>;
}

function PremiumContent() {
  const { user } = useAuth();
  const { config, savedConfig, resetConfig, updateConfig, saveProfile, saveState, saveError, profileReady } = useProfile();
  const view = useSearchParams().get("view") || "general";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<{ key: ShareCropKey; asset: ProfileAsset } | null>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const allowed = user?.premium === true;
  const settings = (patch: Partial<ProfileConfig["settings"]>) => updateConfig(c => ({ ...c, settings: { ...c.settings, premium: premiumSettings(c), ...patch } }));
  const setAsset = (key: ShareCropKey, asset: ProfileAsset) => updateConfig(c => ({ ...c, settings: { ...c.settings, premium: premiumSettings(c) }, assets: { ...c.assets, [key]: asset } }));
  const upload = async (key: ShareCropKey, file: File) => {
    setBusy(true); setError("");
    try { setAsset(key, await uploadProfileAsset(key, file, true)); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto min-h-screen max-w-[1300px] px-4 py-8 sm:px-8 sm:py-11">
    <PageHeader eyebrow="Make it yours" title="Premium" description="Fine-tune your profile’s presentation, modules and sharing appearance." action={<span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${allowed ? "border-rose-400/30 bg-rose-500/10 text-rose-200" : "border-white/10 text-zinc-400"}`}><Sparkles size={14} />{allowed ? "Premium active" : "Premium required"}</span>} />
    {!allowed && <p className="mb-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">Premium access is managed by the Misa.lol team. Your saved settings are kept if access expires.</p>}
    <h2 id="premium-view-title" className="mb-5 text-lg font-semibold">{view === "layout" ? "Layout Settings" : view === "metadata" ? "Profile Metadata" : "General"}</h2>
    <div aria-labelledby="premium-view-title" inert={!allowed || !profileReady || saveState === "saving"} className={!allowed ? "opacity-50" : ""}>
      {!["layout", "metadata"].includes(view) && <div className="space-y-4"><PremiumGeneral /><EffectColors /></div>}{view === "layout" && <PremiumLayout />}{view === "metadata" && <SharingAppearance config={config} setSettings={settings} setAsset={setAsset} onUpload={upload} onCrop={setCrop} />}
    </div>
    <div className="sticky bottom-3 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#101016]/95 p-3 shadow-xl backdrop-blur-xl"><p role="status" className="text-xs text-zinc-400">{busy ? "Uploading…" : saveState === "saving" ? "Saving…" : dirty ? "Unsaved changes" : "Settings up to date"}</p><div className="flex flex-wrap gap-2"><ProfilePreviewButton /><Button disabled={!dirty || saveState === "saving"} onClick={resetConfig}>Reset draft</Button><Button variant="accent" disabled={!allowed || !profileReady || busy || saveState === "saving" || !dirty} onClick={() => void saveProfile()}>Save changes</Button></div></div>
    {(error || saveError) && <p role="alert" className="mt-3 text-sm text-red-300">{error || saveError}</p>}
    <ImageCropModal open={!!crop} title="Crop sharing image" src={crop?.asset.url || ""} aspect={crop?.key === "ogImage" ? 1200 / 630 : 1} outputWidth={crop?.key === "ogImage" ? 1200 : 256} outputHeight={crop?.key === "ogImage" ? 630 : 256} onCancel={() => setCrop(null)} onApply={url => { if (crop) { const key = crop.key; setCrop(null); void dataUrlToFile(url, `${key}.png`, "image/png").then(file => upload(key, file)).catch(() => setError("Could not prepare cropped image.")); } }} />
  </main>;
}
