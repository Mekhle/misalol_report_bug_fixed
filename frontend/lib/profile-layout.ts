import type { BannerShape, ProfileConfig, ProfileFont, ProfileLayout, ProfileShape, SocialAlign } from "./types";
import { fontStack } from "./typography";

export const PROFILE_LAYOUTS: Array<{ id: ProfileLayout; label: string; description: string }> = [
  {id:"Default",label:"Default",description:"A familiar, balanced profile."},
  {id:"Modern",label:"Modern",description:"A wide glass frame with a compact identity."},
  {id:"Simplistic",label:"Simplistic",description:"Quiet details and a light frame."},
  {id:"Sleek",label:"Sleek",description:"A banner-led profile with a floating avatar."},
  {id:"Portfolio",label:"Portfolio",description:"Give your biography, work and skills more space."},
];

export function profileLayout(settings: ProfileConfig["settings"]): ProfileLayout {
  return PROFILE_LAYOUTS.find(item => item.id === settings.layout)?.id || "Modern";
}

export function avatarRadius(shape?: ProfileShape) {
  return shape === "square" ? "12px" : shape === "rounded" ? "22px" : "999px";
}

export function bannerRadius(shape?: BannerShape, cardRadius = 24) {
  if (shape === "square") return "0px";
  if (shape === "pill") return "999px";
  return `${Math.max(10, cardRadius - 6)}px`;
}

export function profileFont(font?: ProfileFont) {
  return fontStack(font);
}

export function pageJustify(align?: SocialAlign) {
  return align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
}

export function contentAlign(align?: SocialAlign) {
  return align === "left" ? "left" : align === "right" ? "right" : "center";
}

export function formatJoinDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${date.toLocaleString("en-US", { month: "short", year: "numeric" })}`;
}
