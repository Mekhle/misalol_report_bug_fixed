import type { ProfileConfig, ProfileSection } from "./types";

export function projectConfigured(item: ProfileSection) {
  return Boolean(item.body?.trim() || item.href?.trim() || item.cover?.url || item.tags?.length);
}
/** Render-only normalization: never modifies the saved sections or their IDs. */
export function visibleSections(config: ProfileConfig) {
  const enabled = (config.sections || []).filter(item => item.enabled);
  const about = enabled.find(item => item.type === "about");
  const skills = enabled.filter(item => item.type === "skills").flatMap(item => item.tags || []);
  const result: ProfileSection[] = [];
  for (let index = 0; index < enabled.length; index++) {
    let item = enabled[index];
    if (item.type === "skills" && (about || !item.tags?.length)) continue;
    if (item === about) item = { ...item, tags: [...new Set([...(item.tags || []), ...skills])] };
    if (item.type === "project") {
      const group = [item];
      while (enabled[index + 1]?.type === "project") group.push(enabled[++index]);
      const configured = group.filter(projectConfigured);
      result.push(...(configured.length ? configured : group.slice(0, 1)));
    } else if (["integration", "lyrics"].includes(item.type) || item.title || item.body || item.subtitle || item.tags?.length || item.leftCard?.enabled || item.rightCard?.enabled) result.push(item);
  }
  return result;
}
export interface PortfolioPage { id: string; title: string; items: ProfileSection[]; showcase: boolean }
/** Consecutive project modules share a gallery; no saved module is merged or changed. */
export function portfolioPages(config: ProfileConfig): PortfolioPage[] {
  const pages: PortfolioPage[] = [];
  for (const item of visibleSections(config)) {
    const last = pages[pages.length - 1];
    if (item.type === "project" && last?.showcase) {
      last.items.push(item);
      last.title = "Projects";
    } else pages.push({ id: item.id, title: item.title, items: [item], showcase: item.type === "project" });
  }
  return pages;
}
