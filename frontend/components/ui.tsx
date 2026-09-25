"use client";

import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const buttonStyles = {
  primary: "bg-white/[.92] text-black hover:bg-white shadow-[0_8px_30px_rgba(255,255,255,.08)]",
  subtle: "bg-white/[.045] text-white hover:bg-white/[.085] border border-white/[.09] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]",
  ghost: "text-zinc-400 hover:bg-white/[.055] hover:text-white",
  accent: "bg-gradient-to-br from-[#b7a9ff] via-[#e11d48] to-[#be123c] text-white hover:brightness-110 shadow-[0_8px_28px_rgba(155,135,245,.2),inset_0_1px_0_rgba(255,255,255,.25)]",
};

export function Button({ children, variant = "subtle", className = "", type = "button", disabled = false, onClick }: { children: React.ReactNode; variant?: keyof typeof buttonStyles; className?: string; type?: "button" | "submit" | "reset"; disabled?: boolean; onClick?: () => void }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e11d48] disabled:pointer-events-none disabled:opacity-40 ${buttonStyles[variant]} ${className}`}>{children}</button>;
}

export function IconButton({ icon: Icon, label, className = "", onClick }: { icon: LucideIcon; label: string; className?: string; onClick?: () => void }) {
  return <button aria-label={label} title={label} onClick={onClick} className={`icon-glass inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-zinc-400 transition hover:bg-white/[.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e11d48] ${className}`}><Icon size={17} strokeWidth={1.8} /></button>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <span role="switch" tabIndex={0} aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChange(!checked); } }} className={`relative inline-block h-6 w-11 shrink-0 cursor-pointer rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e11d48] ${checked ? "bg-[#e11d48]" : "bg-white/[.13]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-[inset-inline-start] ${checked ? "start-6" : "start-1"}`} /></span>;
}

export function RangeControl({ label, value, min, max, suffix = "", onChange, onReset }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void; onReset?: () => void }) {
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2 text-sm"><span className="text-zinc-300">{label}</span><div className="flex items-center gap-2"><span className="font-mono text-xs text-zinc-500">{value}{suffix}</span>{onReset && <button type="button" onClick={onReset} aria-label={"Reset " + label} title={"Reset " + label} className="rounded-md p-1 text-zinc-600 transition hover:bg-white/[.06] hover:text-zinc-200"><RotateCcw size={12} /></button>}</div></div><input aria-label={label} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[.09] accent-[#e11d48]" /></div>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) { return <label className="mb-2 block text-xs font-medium uppercase tracking-[.11em] text-zinc-500">{children}</label>; }

export function TextInput({ value, onChange, placeholder, className = "", type = "text", id, name, autoComplete, disabled = false }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string; type?: string; id?: string; name?: string; autoComplete?: string; disabled?: boolean }) {
  return <input id={id} name={name} autoComplete={autoComplete} disabled={disabled} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`h-11 w-full rounded-[11px] border border-white/[.08] bg-white/[.025] px-3.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e11d48]/60 focus:bg-white/[.04] focus:ring-2 focus:ring-[#e11d48]/10 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} />;
}

export function TextArea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full resize-none rounded-[11px] border border-white/[.08] bg-white/[.025] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e11d48]/60 focus:bg-white/[.04] focus:ring-2 focus:ring-[#e11d48]/10" />;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-[#fb7185]">{eyebrow && <><span className="h-1.5 w-1.5 rounded-full bg-[#fb7185]" />{eyebrow}</>}</div><h1 className="text-3xl font-semibold tracking-[-.04em] text-white sm:text-[34px]">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm text-zinc-500">{description}</p>}</div>{action}</div>;
}

export function SectionTitle({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex items-start justify-between gap-3"><div className="flex gap-3">{Icon && <div className="icon-glass mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[#fda4af]"><Icon size={16} /></div>}<div><h2 className="font-medium text-white">{title}</h2>{description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}</div></div>{action}</div>;
}

export function Modal({ open, title, description, onClose, children, size = "md" }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode; size?: "md" | "lg" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => { node.close(); previous?.focus(); };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} aria-labelledby={label} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => { if (event.target === event.currentTarget) closeRef.current(); }} className={`glass-floating animate-modal-in fixed max-h-[85dvh] w-[calc(100%-32px)] overflow-y-auto rounded-[18px] border border-white/10 p-5 text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm sm:p-6 ${size === "lg" ? "max-w-lg" : "max-w-md"}`}><div className="mb-6 flex items-start justify-between gap-3"><div><h2 id={label} className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}</div><button type="button" onClick={onClose} className="sidebar-close flex" aria-label="Close">×</button></div>{children}</dialog>, document.body);
}

export function MiniBar({ value, color = "#e11d48" }: { value: number; color?: string }) { return <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]"><div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} /></div>; }

export function StatusDot({ active = true }: { active?: boolean }) { return <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" : "bg-zinc-600"}`} />; }

export function SelectBox({ value, options, onChange, onReset }: { value: string; options: string[]; onChange: (value: string) => void; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="flex items-center gap-2"><div className="relative"><button type="button" onClick={() => setOpen(!open)} className="flex h-10 min-w-[128px] items-center justify-between gap-4 rounded-[11px] border border-white/[.09] bg-white/[.035] px-3 text-sm text-zinc-200 hover:bg-white/[.07]"><span>{value}</span><ChevronDown size={15} className="text-zinc-500" /></button>{open && <><button type="button" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" aria-label="Close options" /><div className="glass-floating absolute right-0 top-12 z-20 min-w-full overflow-hidden rounded-[13px] p-1">{options.map((option) => <button key={option} type="button" onClick={() => { onChange(option); setOpen(false); }} className="flex w-full items-center justify-between gap-5 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/[.07]">{option}{option === value && <Check size={13} className="text-[#fb7185]" />}</button>)}</div></>}</div>{onReset && <button type="button" onClick={onReset} aria-label={"Reset " + value} title="Reset" className="rounded-md p-1.5 text-zinc-600 transition hover:bg-white/[.06] hover:text-zinc-200"><RotateCcw size={12} /></button>}</div>;
}

export function LoadingButton({ children, loading }: { children: React.ReactNode; loading: boolean }) { return <Button disabled={loading}>{loading && <LoaderCircle size={15} className="animate-spin" />}{children}</Button>; }
