"use client";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import { useDraftPreview } from "@/lib/draft-preview";
import { useProfile } from "@/lib/profile-store";
export function ProfilePreviewButton() {
  const preview = useDraftPreview();
  const { profileReady } = useProfile();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button disabled={!profileReady || !preview.href} onClick={preview.open}><ExternalLink size={14} />Profile Preview</Button>{preview.blocked && <span role="status" className="text-xs text-rose-200">Popup blocked. <a className="underline" href={preview.href} target={preview.target} rel="opener">Open preview tab</a></span>}</span>;
}
