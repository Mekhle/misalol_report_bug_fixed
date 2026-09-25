"use client";

import { MoveDiagonal2 } from "lucide-react";
import "@/public/profile-layout.css";

import { createContext, useContext, useRef, type ReactNode, type PointerEvent } from "react";
import { constrainBox, elementBox, elementStyle, updateElementLayout, type ElementBox, type LayoutElement, type LayoutViewport } from "@/lib/element-layout";
import type { ProfileConfig } from "@/lib/types";

interface LayoutContext {
  settings: ProfileConfig["settings"];
  editing: boolean;
  viewport: LayoutViewport;
  selected: LayoutElement;
  select: (id: LayoutElement) => void;
  change?: (patch: Partial<ProfileConfig["settings"]>) => void;
}
const Context = createContext<LayoutContext | null>(null);
export const ProfileLayoutProvider = Context.Provider;

/** Each instance owns its capture, draft and resize handles. Commit once on release. */
export function ProfileLayoutElement({ id, children }: { id: LayoutElement; children: ReactNode }) {
  const context = useContext(Context);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; box: ElementBox; draft: ElementBox; travel: number; mode: "move" | "resize"; viewport: LayoutViewport } | null>(null);
  if (!context) return <>{children}</>;
  const { settings, editing, viewport, selected, select, change } = context;
  const commit = (box: ElementBox) => change?.({ elementLayouts: updateElementLayout(settings, viewport, id, box) });
  const start = (event: PointerEvent<HTMLButtonElement>, mode: "move" | "resize") => {
    if (event.button !== 0 || !ref.current) return;
    event.preventDefault(); event.stopPropagation(); select(id);
    const box = elementBox(settings, id, viewport);
    const width = ref.current.offsetWidth;
    const parent = ref.current.parentElement;
    const padding = parent ? getComputedStyle(parent) : null;
    const parentWidth = (parent?.clientWidth ?? width) - parseFloat(padding?.paddingLeft || "0") - parseFloat(padding?.paddingRight || "0");
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, box: { ...box, width: mode === "resize" ? width : box.width, height: mode === "resize" ? ref.current.offsetHeight : box.height }, draft: box, travel: Math.max(1, parentWidth - width), mode, viewport };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId || d.viewport !== viewport || !ref.current) return;
    event.stopPropagation();
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    d.draft = constrainBox(id, d.mode === "resize" ? { ...d.box, width: d.box.width + dx, height: d.box.height + dy } : { ...d.box, x: d.box.x + dx / d.travel * 200, y: d.box.y + dy });
    // DOM-only draft: no provider re-render, fetch or save during pointer movement.
    const style = elementStyle({ ...settings, elementLayouts: { version: 2, [viewport]: { [id]: d.draft } } }, id);
    for (const [key, value] of Object.entries(style)) if (key.startsWith(`--${viewport}-`)) ref.current.style.setProperty(key, String(value));
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    drag.current = null;
    if (cancel || d.viewport !== viewport) {
      for (const [key, value] of Object.entries(elementStyle(settings, id))) ref.current?.style.setProperty(key, String(value));
    } else commit(d.draft);
  };
  return <div ref={ref} data-layout-element={id} data-selected={editing && selected === id ? "true" : undefined} className={`profile-element profile-element-${id.startsWith("widget:") ? "widget" : id}`} style={elementStyle(settings, id)} onPointerDownCapture={editing ? (event) => { if ((event.target as HTMLElement).closest("[data-layout-element]") === event.currentTarget) select(id); } : undefined} onPointerDown={editing ? (event) => event.stopPropagation() : undefined}>
    {children}
    {editing && <button type="button" className="profile-move-handle" aria-label={`Move ${id}`} aria-pressed={selected === id} onPointerDown={(event) => start(event, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={(event) => finish(event, true)} onKeyDown={(event) => {
      const deltas: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] };
      const delta = deltas[event.key]; if (!delta) return;
      event.preventDefault(); event.stopPropagation(); select(id);
      const box = elementBox(settings, id, viewport); commit({ ...box, x: box.x + delta[0], y: box.y + delta[1] });
    }}>{id.startsWith("widget:") ? "widget" : id}</button>}
    {editing && selected === id && <button type="button" aria-label={`Resize ${id}`} className="profile-resize-handle" onPointerDown={(event) => start(event, "resize")} onPointerMove={move} onPointerUp={finish} onPointerCancel={(event) => finish(event, true)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const box = elementBox(settings, id, viewport);
      commit({ ...box, width: (ref.current?.offsetWidth ?? box.width) + (event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0), height: (ref.current?.offsetHeight ?? box.height) + (event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0) });
    }}><MoveDiagonal2 size={16} aria-hidden="true" /></button>}
  </div>;
}
