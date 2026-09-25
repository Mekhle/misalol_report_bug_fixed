export const LOCALE_IDS = ["en", "es", "pt-BR", "de", "fr", "ru", "tr", "ar"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export const LOCALES: Array<{ id: LocaleId; name: string; native: string; dir: "ltr" | "rtl" }> = [
  { id: "en", name: "English", native: "English", dir: "ltr" },
  { id: "es", name: "Spanish", native: "Español", dir: "ltr" },
  { id: "pt-BR", name: "Brazilian Portuguese", native: "Português (Brasil)", dir: "ltr" },
  { id: "de", name: "German", native: "Deutsch", dir: "ltr" },
  { id: "fr", name: "French", native: "Français", dir: "ltr" },
  { id: "ru", name: "Russian", native: "Русский", dir: "ltr" },
  { id: "tr", name: "Turkish", native: "Türkçe", dir: "ltr" },
  { id: "ar", name: "Arabic", native: "العربية", dir: "rtl" },
];

export const LOCALE_STORAGE_KEY = "misa:locale";

export function isLocaleId(value: string | null | undefined): value is LocaleId {
  return Boolean(value && (LOCALE_IDS as readonly string[]).includes(value));
}

export function localeMeta(id: LocaleId) {
  return LOCALES.find((item) => item.id === id) || LOCALES[0];
}

export function detectLocale(): LocaleId {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocaleId(saved)) return saved;
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("tr")) return "tr";
  if (nav.startsWith("ar")) return "ar";
  return "en";
}
