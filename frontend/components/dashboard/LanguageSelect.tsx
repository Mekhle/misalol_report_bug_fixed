"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Languages, X } from "lucide-react";
import { LOCALES, useI18n } from "@/lib/i18n";
import type { LocaleId } from "@/lib/i18n/locales";
// Representative display regions for generic languages; these do not define translations.
const FLAGS: Record<LocaleId, string> = { en: "gb", es: "es", "pt-BR": "br", de: "de", fr: "fr", ru: "ru", tr: "tr", ar: "sa" };
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 12, height: 500, sheet: false });
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId(), reduced = useReducedMotion();
  const current = LOCALES.find(item => item.id === locale) || LOCALES[0];
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect(); if (!box) return;
      const sidebar = root.current?.closest("aside")?.getBoundingClientRect();
      const left = (compact ? sidebar?.right ?? box.right : box.right) + 10;
      const sheet = left + 248 > innerWidth - 12;
      const height = Math.min(530, innerHeight - 24);
      setPosition({ left: sheet ? Math.max(12, innerWidth - 292) : left, top: sheet ? 12 : Math.max(12, Math.min(box.top, innerHeight - height - 12)), height, sheet });
    };
    place();
    const focus = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", key, true); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(focus); window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", key, true); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, compact]);
  return <div ref={root} className={`relative ${compact ? "" : "w-full"}`}>
    <button ref={trigger} type="button" aria-label={t("language.label")} aria-controls={open ? id : undefined} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(value => !value)} onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }} className={`flex w-full items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 text-sm text-zinc-300 outline-none transition hover:border-white/[.14] hover:bg-white/[.04] focus-visible:ring-2 focus-visible:ring-white/50 ${compact ? "h-9 px-3" : "h-11 px-3.5"}`}>
      <Languages size={15} className="shrink-0 text-zinc-600" /><span className="min-w-0 flex-1 truncate text-start text-zinc-200">{current.native}</span><ChevronDown size={14} className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {typeof document !== "undefined" && createPortal(<AnimatePresence>{open && <motion.div ref={menu} role={position.sheet ? "dialog" : undefined} aria-modal={position.sheet || undefined} aria-label={t("language.label")} onKeyDown={e => { if (e.key !== "Tab") return; if (!position.sheet) { e.preventDefault(); close(); return; } const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button") || []); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }} initial={{ opacity: 0, x: reduced ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : .18 }} className="glass-floating fixed z-[200] rounded-[14px] p-1.5" style={{ left: position.left, top: position.top, width: position.sheet ? Math.min(280, window.innerWidth - 24) : 248, maxHeight: position.height, overflowY: "auto" }} onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) close(false); }}>
      {position.sheet && <div className="flex items-center justify-between px-3 text-sm text-white"><span>{t("language.label")}</span><button aria-label="Close languages" type="button" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10" onClick={() => close()}><X size={17} /></button></div>}
      <ul id={id} role="listbox" aria-label={t("language.label")} onKeyDown={e => { const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []); const i = options.indexOf(document.activeElement as HTMLButtonElement); const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : e.key === "ArrowDown" ? (i + 1) % options.length : e.key === "ArrowUp" ? (i - 1 + options.length) % options.length : -1; if (next >= 0) { e.preventDefault(); options[next]?.focus(); } }}>
      {LOCALES.map(item => <li key={item.id}><button type="button" role="option" aria-selected={item.id === locale} onClick={() => { setLocale(item.id); close(); }} className={`flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 ${item.id === locale ? "bg-[#e11d48]/16 text-white" : "text-zinc-300 hover:bg-white/[.07] hover:text-white"}`}>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[13px] leading-5"><bdi dir={item.dir}>{item.native}</bdi><img alt="" aria-hidden="true" src={`/dashboard/locale-flags/${FLAGS[item.id]}.svg`} className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" /></span><span className="mt-0.5 block text-[10px] leading-4 text-zinc-500">{item.name}</span></span>{item.id === locale ? <Check size={14} className="shrink-0 text-[#b6aaff]" /> : <span className="h-3.5 w-3.5 shrink-0" />}
      </button></li>)}
      </ul>
    </motion.div>}</AnimatePresence>, document.body)}
  </div>;
}
