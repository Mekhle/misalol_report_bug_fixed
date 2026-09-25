"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { en, type Messages } from "./en";
import { detectLocale, localeMeta, LOCALE_STORAGE_KEY, type LocaleId } from "./locales";

const catalogCache: Partial<Record<LocaleId, Messages>> = { en };
const catalogLoaders: Record<Exclude<LocaleId, "en">, () => Promise<Messages>> = {
  es: () => import("./es").then((module) => module.es),
  "pt-BR": () => import("./pt-BR").then((module) => module.ptBR),
  de: () => import("./de").then((module) => module.de),
  fr: () => import("./fr").then((module) => module.fr),
  ru: () => import("./ru").then((module) => module.ru),
  tr: () => import("./tr").then((module) => module.tr),
  ar: () => import("./ar").then((module) => module.ar),
};

type Vars = Record<string, string | number>;

function lookup(messages: Messages, path: string): string | undefined {
  let current: unknown = messages;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (vars[key] == null ? `{${key}}` : String(vars[key])));
}

async function loadCatalog(locale: LocaleId): Promise<Messages> {
  const cached = catalogCache[locale];
  if (cached) return cached;
  const catalog = await catalogLoaders[locale as Exclude<LocaleId, "en">]();
  catalogCache[locale] = catalog;
  return catalog;
}

export function translate(locale: LocaleId, path: string, vars?: Vars, fallback?: string) {
  const messages = catalogCache[locale] || en;
  const found = lookup(messages, path) ?? lookup(en, path) ?? fallback ?? path;
  return interpolate(found, vars);
}

interface I18nValue {
  locale: LocaleId;
  dir: "ltr" | "rtl";
  setLocale: (next: LocaleId) => void;
  t: (path: string, vars?: Vars, fallback?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleId>("en");
  const [messages, setMessages] = useState<Messages>(en);
  const requestVersion = useRef(0);

  const activateLocale = useCallback((next: LocaleId, persist: boolean) => {
    const version = ++requestVersion.current;
    setLocaleState(next);
    if (persist) window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    const cached = catalogCache[next];
    if (cached) {
      setMessages(cached);
      return;
    }
    setMessages(en);
    void loadCatalog(next).then((catalog) => {
      if (version === requestVersion.current) setMessages(catalog);
    }).catch(() => {
      if (version === requestVersion.current) {
        setLocaleState("en");
        setMessages(en);
      }
    });
  }, []);

  useEffect(() => {
    activateLocale(detectLocale(), false);
    return () => { requestVersion.current += 1; };
  }, [activateLocale]);

  const setLocale = useCallback((next: LocaleId) => activateLocale(next, true), [activateLocale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    dir: localeMeta(locale).dir,
    setLocale,
    t: (path, vars, fallback) => interpolate(lookup(messages, path) ?? lookup(en, path) ?? fallback ?? path, vars),
  }), [locale, messages, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export function useT() {
  return useI18n().t;
}

export { LOCALES, localeMeta, type LocaleId } from "./locales";