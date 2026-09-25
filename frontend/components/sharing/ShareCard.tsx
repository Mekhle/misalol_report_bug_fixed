"use client";

import { Check, Copy, Download, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText, downloadDataUrl, publicProfileUrl } from "@/lib/share";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui";

export function ShareCard({ username }: { username: string }) {
  const t = useT();
  const [url, setUrl] = useState(`/${username}`);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const next = publicProfileUrl(username);
    setUrl(next);
    let cancelled = false;
    void import("qrcode").then((mod) => {
      const QRCode = (mod.default ?? mod) as { toDataURL: (text: string, options: { width: number; margin: number; color: { dark: string; light: string } }) => Promise<string> };
      return QRCode.toDataURL(next, {
        width: 512,
        margin: 2,
        color: { dark: "#111118", light: "#ffffff" },
      });
    }).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl);
    }).catch(() => {
      if (!cancelled) setQr("");
    });
    return () => { cancelled = true; };
  }, [username]);

  const copy = async () => {
    const ok = await copyText(url);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-[116px] w-[116px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[.08] bg-white">
          {qr ? (

            <img src={qr} alt={t("share.qrAlt", { username })} className="h-full w-full" />
          ) : (
            <QrCode size={28} className="text-zinc-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">{t("share.title")}</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => void copy()}>{copied ? <><Check size={13} />{t("common.copied")}</> : <><Copy size={13} />{t("common.copyLink")}</>}</Button>
            <Button variant="subtle" className="h-9 min-h-0 px-3 text-xs" disabled={!qr} onClick={() => qr && downloadDataUrl(qr, `${username}-misa-qr.png`)}><Download size={13} />{t("common.downloadQr")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
