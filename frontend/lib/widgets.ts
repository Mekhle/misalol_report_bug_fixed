import type { ProfileWidget, ResolvedWidget, WidgetType } from "./types";

export const MAX_WIDGETS = 8;

export const WIDGET_CATALOG: Array<{ id: WidgetType; label: string; placeholder: string }> = [
  { id: "youtube", label: "YouTube", placeholder: "Video or channel URL" },
  { id: "spotify", label: "Spotify", placeholder: "open.spotify.com track, album, or playlist" },
  { id: "discord", label: "Discord server", placeholder: "discord.gg invite or invite code" },
  { id: "telegram", label: "Telegram", placeholder: "@handle or t.me link" },
  { id: "roblox", label: "Roblox", placeholder: "Roblox username" },
  { id: "github", label: "GitHub", placeholder: "GitHub username" },
  { id: "lastfm", label: "Last.fm", placeholder: "Last.fm username" },
  { id: "timezone", label: "Timezone", placeholder: "Europe/London" },
  { id: "weather", label: "Weather", placeholder: "City name" },
];

export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Bucharest",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const WIDGET_TYPES = new Set(WIDGET_CATALOG.map((item) => item.id));

export function widgetLabel(type: WidgetType) {
  return WIDGET_CATALOG.find((item) => item.id === type)?.label || type;
}

export function widgetPlaceholder(type: WidgetType) {
  return WIDGET_CATALOG.find((item) => item.id === type)?.placeholder || "";
}

export function createWidgetId(type: WidgetType) {
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${type}-${unique}`.slice(0, 40);
}

export function normalizeWidgets(raw: ProfileWidget[] | undefined): ProfileWidget[] {
  const seen = new Set<string>();
  return (raw || []).slice(0, MAX_WIDGETS).flatMap((item, index) => {
    if (!item || !WIDGET_TYPES.has(item.type)) return [];
    let id = String(item.id || `${item.type}-${index + 1}`).slice(0, 40);
    if (seen.has(id)) id = `${id}-${index + 1}`.slice(0, 40);
    seen.add(id);
    return [{ id, type: item.type, enabled: Boolean(item.enabled), value: String(item.value || "").slice(0, 500) }];
  });
}

export function emptyResolvedWidget(widget: ProfileWidget, status: ResolvedWidget["status"] = "empty"): ResolvedWidget {
  return {
    id: widget.id,
    type: widget.type,
    status,
    title: widgetLabel(widget.type),
    subtitle: status === "error" ? "Could not load this widget." : "Add a value in Customize.",
    image: null,
    href: null,
  };
}

export function previewResolvedWidget(widget: ProfileWidget): ResolvedWidget {
  const value = widget.value.trim();
  return {
    id: widget.id,
    type: widget.type,
    status: value ? "ok" : "empty",
    title: widgetLabel(widget.type),
    subtitle: value || "Add a value in Customize.",
    image: null,
    href: null,
  };
}