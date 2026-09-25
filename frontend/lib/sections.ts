import type { ProfileAsset, ProfileSection, SectionType } from "./types";

export const MAX_SECTIONS = 12;

export const SECTION_CATALOG: Array<{ id: SectionType; label: string; hint: string }> = [
  { id: "about", label: "About me", hint: "Markdown bio under your card." },
  { id: "project", label: "Project", hint: "Cover, tags, and a link." },
  { id: "skills", label: "Skills", hint: "A row of skill chips." },
  { id: "text", label: "Custom text", hint: "A free Markdown block." },
  { id: "lyrics", label: "Synced lyrics", hint: "LRC lines follow the music player." },
  { id: "integration", label: "Integration cards", hint: "Independent provider cards." },
];

const SECTION_TYPES = new Set(SECTION_CATALOG.map((item) => item.id));

export function sectionLabel(type: SectionType) {
  return SECTION_CATALOG.find((item) => item.id === type)?.label || type;
}

export function createSectionId(type: SectionType) {
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${type}-${unique}`.slice(0, 40);
}

export function defaultSection(type: SectionType): ProfileSection {
  const titles: Record<SectionType, string> = {
    about: "About",
    project: "Project",
    skills: "Skills",
    text: "",
    lyrics: "Lyrics",
    integration: "Connections",
  };
  return { id: createSectionId(type), type, enabled: true, title: titles[type], body: "", href: "", tags: [], cover: { url: null } };
}

export function normalizeSections(raw: ProfileSection[] | undefined): ProfileSection[] {
  const seen = new Set<string>();
  return (raw || []).slice(0, MAX_SECTIONS).flatMap((item, index) => {
    if (!item || !SECTION_TYPES.has(item.type)) return [];
    let id = String(item.id || `${item.type}-${index + 1}`).slice(0, 40);
    if (seen.has(id)) id = `${id}-${index + 1}`.slice(0, 40);
    seen.add(id);
    const tags = Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 16) : [];
    const cover = item.cover && typeof item.cover === "object" ? item.cover : { url: null };
    return [{
      id,
      type: item.type,
      enabled: Boolean(item.enabled),
      subtitle: String(item.subtitle || "").slice(0, 160),
      leftCard: item.leftCard,
      rightCard: item.rightCard,
      title: String(item.title || "").slice(0, 80),
      body: String(item.body || "").slice(0, 8000),
      href: String(item.href || "").slice(0, 500),
      tags,
      cover: { url: cover.url || null, name: cover.name || "", type: cover.type || "" },
    }];
  });
}

export function tagsFromInput(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 16);
}

export function tagsToInput(tags: string[] | undefined) {
  return (tags || []).join(", ");
}

export function sectionCoverSrc(username: string, section: ProfileSection, preview: boolean) {
  if (preview) return section.cover?.url || "";
  return section.cover?.url ? `/api/v1/profile/${encodeURIComponent(username)}/sections/${encodeURIComponent(section.id)}/cover` : "";
}

export function emptyCover(): ProfileAsset {
  return { url: null };
}
