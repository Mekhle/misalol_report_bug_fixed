"use client";

import { AppWindow, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button, FieldLabel, SectionTitle, SelectBox, TextInput, Toggle } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useProfile } from "@/lib/profile-store";
import type { WidgetType } from "@/lib/types";
import { COMMON_TIMEZONES, MAX_WIDGETS, WIDGET_CATALOG, createWidgetId, widgetPlaceholder } from "@/lib/widgets";

export function WidgetsPanel() {
  const t = useT();
  const { config, updateConfig } = useProfile();
  const widgets = config.widgets || [];

  const addWidget = (type: WidgetType) => {
    updateConfig((current) => {
      const list = current.widgets || [];
      if (list.length >= MAX_WIDGETS) return current;
      return {
        ...current,
        widgets: [...list, { id: createWidgetId(type), type, enabled: true, value: type === "timezone" ? "UTC" : "" }],
      };
    });
  };

  const patch = (id: string, next: Partial<(typeof widgets)[number]>) => {
    updateConfig((current) => ({
      ...current,
      widgets: (current.widgets || []).map((item) => item.id === id ? { ...item, ...next } : item),
    }));
  };

  const remove = (id: string) => {
    updateConfig((current) => ({ ...current, widgets: (current.widgets || []).filter((item) => item.id !== id) }));
  };

  const move = (id: string, direction: -1 | 1) => {
    updateConfig((current) => {
      const list = [...(current.widgets || [])];
      const index = list.findIndex((item) => item.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= list.length) return current;
      [list[index], list[next]] = [list[next], list[index]];
      return { ...current, widgets: list };
    });
  };

  return (
    <div>
      <SectionTitle icon={AppWindow} title={t("customize.widgetsTitle")} description={t("customize.widgetsDesc")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {WIDGET_CATALOG.map((item) => (
          <Button key={item.id} variant="subtle" className="h-9 min-h-0 px-3 text-xs" onClick={() => addWidget(item.id)} disabled={widgets.length >= MAX_WIDGETS}>
            <Plus size={13} />{t(`widget.${item.id}`, undefined, item.label)}
          </Button>
        ))}
      </div>
      {widgets.length === 0 && <p className="rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-5 text-sm text-zinc-500">{t("customize.widgetsEmpty")}</p>}
      <div className="space-y-3">
        {widgets.map((item, index) => (
          <div key={item.id} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-zinc-200">{t(`widget.${item.type}`, undefined, WIDGET_CATALOG.find((entry) => entry.id === item.type)?.label || item.type)}</p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(item.id, -1)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30"><ChevronUp size={14} /></button>
                <button type="button" aria-label="Move down" disabled={index === widgets.length - 1} onClick={() => move(item.id, 1)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30"><ChevronDown size={14} /></button>
                <button type="button" aria-label="Remove widget" onClick={() => remove(item.id)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[.06] hover:text-red-300"><Trash2 size={14} /></button>
              </div>
            </div>
            {item.type === "timezone" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <div>
                  <FieldLabel>{t("customize.zones")}</FieldLabel>
                  <SelectBox value={COMMON_TIMEZONES.includes(item.value) ? item.value : "UTC"} options={COMMON_TIMEZONES} onChange={(value) => patch(item.id, { value })} />
                </div>
                <div>
                  <FieldLabel>{t("customize.iana")}</FieldLabel>
                  <TextInput value={item.value} onChange={(value) => patch(item.id, { value })} placeholder={widgetPlaceholder(item.type)} />
                </div>
              </div>
            ) : (
              <TextInput value={item.value} onChange={(value) => patch(item.id, { value })} placeholder={widgetPlaceholder(item.type)} />
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-zinc-400">{t("customize.showOnProfile")}</span>
              <Toggle label={t("customize.showOnProfile")} checked={item.enabled} onChange={(checked) => patch(item.id, { enabled: checked })} />
            </div>
          </div>
        ))}
      </div>
      {widgets.length >= MAX_WIDGETS && <p className="mt-3 text-xs text-zinc-600">{t("customize.widgetsMax", { count: MAX_WIDGETS })}</p>}
    </div>
  );
}
