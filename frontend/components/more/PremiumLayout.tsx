"use client";
import { RangeControl } from "@/components/ui";
import { PortfolioPanel } from "@/components/customization/PortfolioPanel";
import { useProfile } from "@/lib/profile-store";
import { BORDER_TYPES, premiumSettings, type PremiumSettings } from "@/lib/premium";
import { PremiumColor, PremiumPanel, PremiumSelect, PremiumToggle } from "./PremiumControls";

export function PremiumLayout() {
  const { config, updateConfig } = useProfile();
  const s = config.settings, p = premiumSettings(config);
  const settings = (patch: Partial<typeof s>) => updateConfig(c => ({ ...c, settings: { ...c.settings, premium: premiumSettings(c), ...patch } }));
  const premium = (patch: Partial<PremiumSettings>) => settings({ premium: { ...p, ...patch } });
  return <div className="space-y-4"><div className="grid items-start gap-4 lg:grid-cols-2"><PremiumPanel title="Hero & visibility"><PremiumSelect label="Hero layout" value={p.hero} options={["Classic", "Centered"]} onChange={v => premium({ hero: v as PremiumSettings["hero"] })} /><PremiumToggle label="Show avatar" checked={s.showAvatar !== false} onChange={showAvatar => settings({ showAvatar })} /><PremiumToggle label="Show social links" checked={s.showSocials} onChange={showSocials => settings({ showSocials })} /></PremiumPanel><PremiumPanel title="Profile border"><PremiumToggle label="Enable border" checked={p.borderEnabled} onChange={borderEnabled => premium({ borderEnabled })} /><PremiumColor label="Border color" value={s.borderColor || "#ffffff"} onChange={borderColor => settings({ borderColor })} /><PremiumSelect label="Border style" value={p.borderType} options={BORDER_TYPES} onChange={v => premium({ borderType: v as PremiumSettings["borderType"] })} /><RangeControl label="Border width" min={0} max={8} value={s.borderWidth ?? 1} suffix="px" onChange={borderWidth => settings({ borderWidth })} /><RangeControl label="Border opacity" min={0} max={100} value={p.borderOpacity} suffix="%" onChange={borderOpacity => premium({ borderOpacity })} /><RangeControl label="Corner radius" min={0} max={80} value={s.profileRadius} suffix="px" onChange={profileRadius => settings({ profileRadius })} /></PremiumPanel></div><PremiumPanel title="Profile modules" description="Drag modules to reorder, or use the arrow buttons. Each card keeps its own configuration."><PortfolioPanel premium /></PremiumPanel></div>;
}
