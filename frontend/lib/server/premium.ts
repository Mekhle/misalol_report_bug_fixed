import "server-only";
import { one } from "./postgres";

const SHARED_SETTINGS = [
  "layout", "pageEnter", "profileFont", "profileFontScope", "entryScreen",
  "entryText", "clickSound", "bioTypewriter", "bioTypeMs", "bioDeleteMs",
  "bioPauseMs", "cardTilt", "showViews", "showAvatar", "showSocials",
  "borderColor", "borderWidth", "profileRadius", "ogTitle", "ogDescription",
  "ogOverlayAvatar", "ogOverlayName", "ogOverlayAddress"
] as const;

const PREMIUM_ASSETS = [
  "customFont", "clickSound", "entryIcon", "ogImage", "favicon"
] as const;

export async function hasActivePremium(userId: string): Promise<boolean> {
  try {
    const row = await one<{ active: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM premium_entitlements
        WHERE user_id = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
      ) AS active
    `, [userId]);
    return Boolean(row?.active);
  } catch {
    return false;
  }
}

function presentationSnapshot(config: Record<string, unknown>): Record<string, unknown> {
  const settings = (config.settings && typeof config.settings === "object" ? config.settings : {}) as Record<string, unknown>;
  const assets = (config.assets && typeof config.assets === "object" ? config.assets : {}) as Record<string, unknown>;
  const sections = Array.isArray(config.sections) ? structuredClone(config.sections) : [];

  const snapSettings: Record<string, unknown> = {};
  for (const key of SHARED_SETTINGS) {
    snapSettings[key] = settings[key];
  }

  const snapAssets: Record<string, unknown> = {};
  for (const key of PREMIUM_ASSETS) {
    snapAssets[key] = assets[key];
  }

  return {
    settings: snapSettings,
    assets: snapAssets,
    sections,
  };
}

export function protectWrite(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  entitled: boolean
): Record<string, unknown> {
  const prev = previous || {};
  const inSettings = (incoming.settings && typeof incoming.settings === "object" ? incoming.settings : {}) as Record<string, unknown>;
  const oldSettings = (prev.settings && typeof prev.settings === "object" ? prev.settings : {}) as Record<string, unknown>;
  const inAssets = (incoming.assets && typeof incoming.assets === "object" ? incoming.assets : {}) as Record<string, unknown>;
  const oldAssets = (prev.assets && typeof prev.assets === "object" ? prev.assets : {}) as Record<string, unknown>;
  const inSections = Array.isArray(incoming.sections) ? incoming.sections : [];
  const oldSections = Array.isArray(prev.sections) ? prev.sections : [];

  const advanced = inSettings.premium;
  const base = prev._premium_base as Record<string, unknown> | undefined;

  const result = { ...incoming };
  delete result._premium_base;

  if (entitled) {
    if (base) {
      result._premium_base = structuredClone(base);
    } else if (advanced) {
      result._premium_base = presentationSnapshot(prev);
    }
  } else {
    if (result.settings && typeof result.settings === "object") {
      const resSettings = { ...(result.settings as Record<string, unknown>) };
      if (oldSettings.premium !== undefined) {
        resSettings.premium = oldSettings.premium;
      } else {
        delete resSettings.premium;
      }
      if (["Default", "Portfolio"].includes(String(resSettings.layout || "")) && resSettings.layout !== oldSettings.layout) {
        resSettings.layout = oldSettings.layout || "Modern";
      }
      result.settings = resSettings;
    }

    if (result.assets && typeof result.assets === "object") {
      const resAssets = { ...(result.assets as Record<string, unknown>) };
      for (const key of PREMIUM_ASSETS) {
        resAssets[key] = oldAssets[key] ?? null;
      }
      result.assets = resAssets;
    }

    if (base) {
      result._premium_base = structuredClone(base);
    }
  }

  return result;
}

export function publicProjection(
  config: Record<string, unknown>,
  entitled: boolean
): Record<string, unknown> {
  const result = structuredClone(config);
  const base = result._premium_base as Record<string, unknown> | undefined;
  delete result._premium_base;

  if (!entitled) {
    if (result.settings && typeof result.settings === "object") {
      delete (result.settings as Record<string, unknown>).premium;
    }

    if (base) {
      for (const group of ["settings", "assets"] as const) {
        const groupObj = (base[group] && typeof base[group] === "object" ? base[group] : {}) as Record<string, unknown>;
        if (!result[group] || typeof result[group] !== "object") {
          result[group] = {};
        }
        const targetGroup = result[group] as Record<string, unknown>;
        for (const [key, value] of Object.entries(groupObj)) {
          if (value === null || value === undefined) {
            delete targetGroup[key];
          } else {
            targetGroup[key] = value;
          }
        }
      }
      result.sections = Array.isArray(base.sections) ? structuredClone(base.sections) : [];
    } else {
      const settings = (result.settings && typeof result.settings === "object" ? result.settings : {}) as Record<string, unknown>;
      if (["Default", "Portfolio"].includes(String(settings.layout || ""))) {
        settings.layout = "Modern";
      }
      if (result.assets && typeof result.assets === "object") {
        const targetAssets = result.assets as Record<string, unknown>;
        for (const key of PREMIUM_ASSETS) {
          delete targetAssets[key];
        }
      }
    }
  }

  return result;
}
