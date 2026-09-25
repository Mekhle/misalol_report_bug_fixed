"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { profileWidgets } from "@/lib/premium";
import type { ProfileConfig, ProfileWidget, ResolvedWidget } from "@/lib/types";
import { emptyResolvedWidget, widgetLabel } from "@/lib/widgets";
import { EmptyContent } from "./EmptyContent";
import { ProfileLayoutElement } from "./ProfileLayoutElement";

const WidgetContext = createContext<{ resolved: ResolvedWidget[]; loading: boolean }>({ resolved: [], loading: false });
export function WidgetResolutionProvider({ config, preview, children }: { config: ProfileConfig; preview: boolean; children: ReactNode }) {
  const widgets = useMemo(() => profileWidgets(config), [config.widgets, config.sections]);
  const [resolved, setResolved] = useState<ResolvedWidget[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedSignature, setResolvedSignature] = useState("");
  const signature = widgets.map((item) => `${item.id}:${item.type}:${item.value}`).join("|");

  useEffect(() => {
    if (widgets.length === 0) {
      setResolved([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = preview
          ? await fetch("/api/v1/widgets/preview", {
              method: "POST", signal: controller.signal,
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ widgets: config.widgets, sections: config.sections }),
            })
          : await fetch(`/api/v1/profile/${encodeURIComponent(config.profile.username)}/widgets`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Widget request failed (${response.status})`);
        }
        const data = await response.json() as { widgets?: ResolvedWidget[] };
        if (!Array.isArray(data.widgets)) throw new Error("Widget response was invalid");
        if (!cancelled) { setResolved(widgets.map(item => data.widgets?.find(card => card.id === item.id) || emptyResolvedWidget(item, "error"))); setResolvedSignature(signature); }
      } catch {
        if (!cancelled) { setResolved(widgets.map((item) => emptyResolvedWidget(item, "error"))); setResolvedSignature(signature); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, preview ? 400 : 0);
    return () => {
      cancelled = true; controller.abort();
      window.clearTimeout(timer);
    };
  // Only provider inputs trigger resolution; text/style editing does not refetch.
  }, [signature, preview, config.profile.username]);
  return <WidgetContext.Provider value={{ resolved: resolvedSignature === signature ? resolved : [], loading: loading || (widgets.length > 0 && resolvedSignature !== signature) }}>{children}</WidgetContext.Provider>;
}

export function ProfileWidgets({ config, presence }: { config: ProfileConfig; preview?: boolean; presence?: ReactNode }) {
  const widgets = config.widgets.filter(w => w.enabled);
  const { resolved, loading } = useContext(WidgetContext);
  const swap = Boolean(config.settings.widgetColorSwap), ink = config.settings.backgroundColor, accent = config.settings.accentColor;

  return (
    <div className="profile-media-row" data-profile-media-row onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      {presence}
      {widgets.map((item) => <div className="profile-media-slot" key={item.id}><ProfileLayoutElement id={`widget:${item.id}`}>
        {loading && resolved.length === 0 ? <WidgetSkeleton swap={swap} accent={accent} ink={ink} /> : <WidgetCard widget={resolved.find((card) => card.id === item.id) || emptyResolvedWidget(item)} swap={swap} accent={accent} ink={ink} />}
      </ProfileLayoutElement></div>)}
    </div>
  );
}

export function WidgetCard({ widget, swap, accent, ink }: { widget: ResolvedWidget; swap: boolean; accent: string; ink: string }) {
  const className = `flex items-center gap-3 rounded-2xl border p-3 text-left no-underline ${swap ? "" : "border-white/[.1] bg-black/25 text-white"} ${widget.status !== "ok" ? "opacity-85" : ""}`;
  const style = swap ? { backgroundColor: accent, color: ink, borderColor: `${ink}33` } : undefined;
  const inner = (
    <>
      {widget.image ? (
        <img src={widget.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-[10px] uppercase tracking-[.06em] ${swap ? "" : "bg-white/[.06] text-white/40"}`} style={swap ? { backgroundColor: `${ink}1a` } : undefined}>
          {widgetLabel(widget.type)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{widget.type === "timezone" && widget.meta?.timezone ? <ClockTitle timezone={widget.meta.timezone} initial={widget.title} /> : widget.title || widgetLabel(widget.type)}</p>
        <p className={`mt-0.5 break-words text-[11px] ${swap ? "" : "text-white/40"}`} style={swap ? { opacity: 0.66 } : undefined}>{widget.subtitle}</p>
      </div>
    </>
  );
  if (widget.href && widget.status === "ok") {
    return <a href={widget.href} target="_blank" rel="noopener noreferrer" className={className} style={style}>{inner}</a>;
  }
  return <div className={className} style={style}>{inner}</div>;
}

function WidgetSkeleton({ swap, accent, ink }: { swap: boolean; accent: string; ink: string }) {
  return (
    <div className={`flex animate-pulse items-center gap-3 rounded-2xl border p-3 ${swap ? "" : "border-white/[.1] bg-black/25"}`} style={swap ? { backgroundColor: accent, borderColor: `${ink}33` } : undefined}>
      <div className={`h-14 w-14 rounded-xl ${swap ? "" : "bg-white/[.08]"}`} style={swap ? { backgroundColor: `${ink}22` } : undefined} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`h-3 w-2/3 rounded ${swap ? "" : "bg-white/[.08]"}`} style={swap ? { backgroundColor: `${ink}22` } : undefined} />
        <div className={`h-2.5 w-1/2 rounded ${swap ? "" : "bg-white/[.06]"}`} style={swap ? { backgroundColor: `${ink}1a` } : undefined} />
      </div>
    </div>
  );
}

function ClockTitle({ timezone, initial }: { timezone: string; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const tick = () => {
      try {
        setText(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date()));
      } catch {
        setText(initial);
      }
    };
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, [timezone, initial]);
  return <>{text}</>;
}

export function widgetCount(widgets: ProfileWidget[] | undefined) {
  return (widgets || []).filter((item) => item.enabled).length;
}

export function SectionWidget({ config, id, type, value }: { config: ProfileConfig; id: string; type: ProfileWidget["type"]; value: string }) {
  const { resolved, loading } = useContext(WidgetContext);
  if (!value.trim()) return <EmptyContent />;
  if (loading || !resolved.some(w => w.id === id)) return <WidgetSkeleton swap={!!config.settings.widgetColorSwap} accent={config.settings.accentColor} ink={config.settings.backgroundColor} />;
  return <WidgetCard widget={resolved.find(w => w.id === id) || emptyResolvedWidget({ id, type, value, enabled: true })} swap={!!config.settings.widgetColorSwap} accent={config.settings.accentColor} ink={config.settings.backgroundColor} />;
}
