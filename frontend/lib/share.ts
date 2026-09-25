import type { ProfileConfig } from "./types";

export function publicSiteOrigin() {
  if (typeof window === "undefined") return "https://misa.lol";
  const host = window.location.hostname.toLowerCase();
  if (host === "misa.lol" || host === "www.misa.lol" || host.endsWith(".misa.lol")) {
    return "https://misa.lol";
  }
  return window.location.origin;
}

export function publicProfileUrl(username: string) {
  const handle = username.trim().toLowerCase();
  return `${publicSiteOrigin()}/${handle}`;
}

export async function copyText(value: string) {
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

export function sharePageCopy(config: ProfileConfig) {
  const username = config.profile.username.trim().toLowerCase();
  const display = config.profile.displayName.trim() || username;
  const title = (config.settings.ogTitle || "").trim() || `${display} · misa.lol`;
  const description = (config.settings.ogDescription || "").trim() || config.profile.description.trim() || `${display} on misa.lol`;
  return { title, description, address: `misa.lol/${username}` };
}

export function downloadDataUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
