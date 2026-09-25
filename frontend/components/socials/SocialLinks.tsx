"use client";

import { useState } from "react";
import { cardIconColor, defaultSocialAction, normalizeSocialAlign, resolveIconGlow, sanitizeSocialHref } from "@/lib/socials";
import type { ProfileConfig, SocialLink } from "@/lib/types";
import { SocialIcon } from "./SocialIcon";

const justifyContent = { left: "flex-start", center: "center", right: "flex-end" } as const;

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "true");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

export function SocialLinks({ config, className = "mt-7", align }: { config: ProfileConfig; className?: string; align?: "left" | "center" | "right" }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const settings = config.settings;
  const visible = config.socials.filter((social) => social.enabled);
  if (!settings.showSocials || visible.length === 0) return null;

  const showToast = (id: string | null, message: string) => {
    setCopiedId(id);
    setToast(message);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
      setToast("");
    }, 1600);
  };

  const copyValue = async (social: SocialLink) => {
    const ok = await copyText(social.value);
    showToast(social.id, ok ? `Copied ${social.label}` : "Could not copy");
  };

  const openValue = (social: SocialLink, event?: React.MouseEvent) => {
    event?.preventDefault();
    const href = sanitizeSocialHref(social.value, social.platform);
    if (!href) {
      showToast(social.id, "That link cannot be opened");
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={`relative z-20 w-full ${className}`}>
      <div className="flex w-full flex-wrap gap-2.5" style={{ justifyContent: justifyContent[normalizeSocialAlign(align ?? settings.socialAlign)] }}>
        {visible.map((social) => {
          const href = sanitizeSocialHref(social.value, social.platform);
          const action = defaultSocialAction(social);
          const color = cardIconColor(social, settings);
          const glow = resolveIconGlow(social, settings.socialGlow);
          const styleKind = settings.buttonStyle || "glass";
          const simplistic = settings.layout === "Simplistic";
          const className = `${simplistic ? "profile-social-button" : ""} pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl transition hover:-translate-y-1 ${styleKind === "solid" ? "border-0" : styleKind === "outline" ? "border-2 bg-transparent hover:bg-white/[.06]" : "border border-white/[.09] bg-white/[.055] hover:border-white/20 hover:bg-white/[.1]"}`;
          const style = styleKind === "solid"
            ? { color: "#0b0b10", fill: "#0b0b10", backgroundColor: color, filter: glow ? `drop-shadow(0 0 10px ${color})` : "none" }
            : { color, fill: color, borderColor: color, filter: glow ? `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 16px ${color})` : "none" };
          const icon = <SocialIcon platform={social.platform} size={17} color={color} customIcon={social.customIcon} monochrome={Boolean(settings.monochromeIcons)} />;
          if (action === "open") {
            return (
              <a key={social.id} href={href || "#"} target="_blank" rel="noopener noreferrer" onClick={(event) => openValue(social, event)} data-social-id={social.id} data-social-action="open" aria-label={`Open ${social.label}`} title={social.value} className={className} style={style}>
                {icon}{simplistic && <span className="min-w-0 break-words">{social.label}</span>}
              </a>
            );
          }
          return (
            <button key={social.id} type="button" onClick={() => void copyValue(social)} data-social-id={social.id} data-social-action="copy" aria-label={`Copy ${social.label}`} title={copiedId === social.id ? "Copied" : `Copy ${social.value}`} className={className} style={style}>
              {icon}{simplistic && <span className="min-w-0 break-words">{social.label}</span>}
            </button>
          );
        })}
      </div>
      {toast ? <p className="pointer-events-none absolute inset-x-0 -bottom-7 text-center text-[10px] text-white/55">{toast}</p> : null}
    </div>
  );
}
