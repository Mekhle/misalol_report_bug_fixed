"use client";

import type { ReactNode } from "react";
import { Toggle } from "@/components/ui";

export function PremiumPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="surface min-w-0 rounded-2xl border border-white/[.08] p-4 sm:p-6"><h2 className="font-medium text-white">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>}<div className="mt-5 space-y-5">{children}</div></section>;
}
export function PremiumSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly (string | { id: string; name: string })[]; onChange: (value: string) => void }) {
  return <label className="block space-y-2 text-sm text-zinc-300"><span>{label}</span><select aria-label={label} className="h-11 w-full min-w-0 rounded-xl border border-white/10 bg-[#15151c] px-3 text-white outline-none focus:ring-2 focus:ring-rose-500" value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={typeof o === "string" ? o : o.id} value={typeof o === "string" ? o : o.id}>{typeof o === "string" ? o : o.name}</option>)}</select></label>;
}
export function PremiumToggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4"><div><p className="text-sm text-zinc-200">{label}</p>{description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}</div><Toggle label={label} checked={checked} onChange={onChange} /></div>;
}
export function PremiumColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">{label}<span className="flex items-center gap-2 font-mono text-xs"><input aria-label={label} className="h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent" type="color" value={value} onChange={e => onChange(e.target.value)} />{value}</span></label>;
}
