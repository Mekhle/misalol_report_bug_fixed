"use client";

import { Crop, Share2, Upload } from "lucide-react";
import { useRef } from "react";
import { Button, FieldLabel, TextArea, TextInput, Toggle } from "@/components/ui";
import { canCropAsset, FAVICON_ACCEPT, IMAGE_ACCEPT, isAnimatedAsset } from "@/lib/image-edit";
import { useT } from "@/lib/i18n";
import { sharePageCopy } from "@/lib/share";
import type { ProfileAsset, ProfileConfig } from "@/lib/types";

export type ShareCropKey = "ogImage" | "favicon";

export function SharingAppearance({
  config,
  setSettings,
  setAsset,
  onUpload,
  onCrop,
}: {
  config: ProfileConfig;
  setSettings: (patch: Partial<ProfileConfig["settings"]>) => void;
  setAsset: (key: "ogImage" | "favicon", asset: ProfileAsset) => void;
  onUpload: (key: "ogImage" | "favicon", file: File) => Promise<void>;
  onCrop: (next: { key: ShareCropKey; asset: ProfileAsset }) => void;
}) {
  const copy = sharePageCopy(config);
  const ogImage = config.assets.ogImage || { url: null };
  const favicon = config.assets.favicon || { url: null };
  const cover = ogImage.url || config.assets.background?.url || "";
  const avatar = config.assets.avatar?.url || "";
  const overlayAvatar = config.settings.ogOverlayAvatar !== false;
  const overlayName = config.settings.ogOverlayName !== false;
  const overlayAddress = config.settings.ogOverlayAddress !== false;
  const t = useT();

  return (
    <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="mb-4 flex gap-3">
        <div className="icon-glass mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[#fda4af]">
          <Share2 size={16} />
        </div>
        <div>
          <h2 className="font-medium text-white">{t("customize.sharingTitle")}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t("customize.sharingDesc")}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0b0b10]">
        <div className="relative aspect-[1200/630] bg-[#08080d]">
          {cover ? (

            <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 22% 18%, ${config.settings.accentColor}66, transparent 36%), linear-gradient(135deg, ${config.settings.backgroundColor}, #07070a)` }} />
          )}
          {(overlayAvatar || overlayName || overlayAddress) && (
            <div className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-[#08080d]/90 via-[#08080d]/45 to-transparent" />
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
            {overlayAvatar && avatar ? (

              <img src={avatar} alt="" className="h-12 w-12 shrink-0 rounded-full border border-white/20 object-cover" />
            ) : null}
            <div className="min-w-0 pb-0.5">
              {overlayName ? <p className="truncate text-sm font-semibold text-white">{config.profile.displayName || config.profile.username}</p> : null}
              {overlayAddress ? <p className="truncate text-[11px] text-zinc-300">{copy.address}</p> : null}
            </div>
          </div>
        </div>
        <div className="border-t border-white/[.06] px-4 py-3">
          <p className="truncate text-sm font-medium text-zinc-100">{copy.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{copy.description}</p>
          <p className="mt-2 text-[10px] uppercase tracking-[.14em] text-zinc-600">misa.lol</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <FieldLabel>{t("customize.pageTitle")}</FieldLabel>
          <TextInput value={config.settings.ogTitle || ""} onChange={(value) => setSettings({ ogTitle: value.slice(0, 70) })} placeholder={copy.title} />
          <p className="mt-1 text-[11px] text-zinc-600">{t("customize.pageTitleHint", { count: (config.settings.ogTitle || "").length })}</p>
        </div>
        <div>
          <FieldLabel>{t("customize.fieldDesc")}</FieldLabel>
          <TextArea value={config.settings.ogDescription || ""} onChange={(value) => setSettings({ ogDescription: value.slice(0, 200) })} placeholder={copy.description} />
          <p className="mt-1 text-[11px] text-zinc-600">{(config.settings.ogDescription || "").length}/200</p>
        </div>
        <ShareAssetRow
          title={t("customize.shareImage")}
          description={t("customize.shareImageDesc")}
          accept={IMAGE_ACCEPT}
          asset={ogImage}
          croppable={canCropAsset(ogImage)}
          onUpload={(file) => onUpload("ogImage", file)}
          onCrop={() => onCrop({ key: "ogImage", asset: ogImage })}
          onRemove={() => setAsset("ogImage", { url: null, remove: true })}
        />
        <ShareAssetRow
          title={t("customize.favicon")}
          description={t("customize.faviconDesc")}
          accept={FAVICON_ACCEPT}
          asset={favicon}
          croppable={canCropAsset(favicon)}
          preview={favicon.url || avatar}
          onUpload={(file) => onUpload("favicon", file)}
          onCrop={() => onCrop({ key: "favicon", asset: favicon })}
          onRemove={() => setAsset("favicon", { url: null, remove: true })}
        />
      </div>

      <div className="mt-4 space-y-1 divide-y divide-white/[.06] rounded-xl border border-white/[.06] px-4">
        <ToggleRow label={t("customize.overlayAvatar")} checked={overlayAvatar} onChange={(checked) => setSettings({ ogOverlayAvatar: checked })} />
        <ToggleRow label={t("customize.overlayName")} checked={overlayName} onChange={(checked) => setSettings({ ogOverlayName: checked })} />
        <ToggleRow label={t("customize.overlayAddress")} checked={overlayAddress} onChange={(checked) => setSettings({ ogOverlayAddress: checked })} />
      </div>
    </div>
  );
}

function ShareAssetRow({
  title,
  description,
  accept,
  asset,
  croppable,
  preview,
  onUpload,
  onCrop,
  onRemove,
}: {
  title: string;
  description: string;
  accept: string;
  asset: ProfileAsset;
  croppable: boolean;
  preview?: string | null;
  onUpload: (file: File) => void;
  onCrop: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const thumb = preview || asset.url;
  return (
    <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] text-zinc-500">
          {thumb ? (

            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <Share2 size={15} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">{title}</p>
          <p className="mt-1 truncate text-xs text-zinc-600">{asset.url ? (isAnimatedAsset(asset) ? t("customize.animated") : asset.name || t("customize.uploaded")) : description}</p>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:ms-auto">
        <input ref={input} className="hidden" type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} />
        <Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => input.current?.click()}>{asset.url ? t("common.replace") : <><Upload size={13} />{t("common.upload")}</>}</Button>
        {croppable ? <Button variant="ghost" className="h-9 min-h-0 px-3 text-xs" onClick={onCrop}><Crop size={13} />{t("common.crop")}</Button> : null}
        {asset.url ? <button type="button" onClick={onRemove} className="shrink-0 px-1 text-xs text-zinc-600 hover:text-red-300">{t("common.remove")}</button> : null}
      </div></div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <span className="text-sm text-zinc-300">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
