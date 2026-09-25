"use client";
import { useState } from "react";
import { Button, Modal, RangeControl } from "@/components/ui";
import { useProfile, uploadProfileAsset } from "@/lib/profile-store";
import { useDefaultFonts } from "@/lib/default-fonts";
import { PROFILE_LAYOUTS } from "@/lib/profile-layout";
import { CLICK_PRESETS, CURSOR_EFFECTS, premiumSettings, type PremiumSettings } from "@/lib/premium";
import { playClickSound } from "@/lib/enter";
import type { ProfileConfig } from "@/lib/types";
import { PremiumColor, PremiumPanel, PremiumSelect, PremiumToggle } from "./PremiumControls";

export function PremiumGeneral() {
  const { config, updateConfig } = useProfile();
  const s = config.settings, p = premiumSettings(config);
  const fonts = useDefaultFonts();
  const [modal, setModal] = useState<"font" | "entry" | "sound" | "typewriter" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settings = (patch: Partial<ProfileConfig["settings"]>) => updateConfig(c => ({ ...c, settings: { ...c.settings, premium: premiumSettings(c), ...patch } }));
  const premium = (patch: Partial<PremiumSettings>) => updateConfig(c => ({ ...c, settings: { ...c.settings, premium: { ...premiumSettings(c), ...patch } } }));
  const upload = async (kind: "customFont" | "clickSound" | "entryIcon", file: File) => {
    setBusy(true); setError("");
    try { const asset = await uploadProfileAsset(kind, file, true); updateConfig(c => ({ ...c, settings: { ...c.settings, premium: premiumSettings(c) }, assets: { ...c.assets, [kind]: asset } })); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed. Please try again."); }
    finally { setBusy(false); }
  };
  const asset = (kind: "customFont" | "clickSound" | "entryIcon", accept: string) => <div className="space-y-2"><label className="block text-sm text-zinc-300">Upload {kind === "customFont" ? "font" : kind === "entryIcon" ? "entry icon" : "click sound"}<input disabled={busy} type="file" accept={accept} className="mt-2 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-3 file:text-white" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(kind, f); e.target.value = ""; }} /></label>{config.assets[kind]?.url && <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400"><span className="break-all">{config.assets[kind]?.name || "Uploaded"}</span><Button onClick={() => updateConfig(c => ({ ...c, assets: { ...c.assets, [kind]: { url: null, remove: true } } }))}>Remove</Button></div>}</div>;
  return <>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <PremiumPanel title="Profile presentation" description="Your existing profile, with a different composition.">
        <PremiumSelect label="Profile layout" value={s.layout || "Modern"} options={PROFILE_LAYOUTS.map(l => ({ id: l.id, name: l.label }))} onChange={v => settings({ layout: v as ProfileConfig["settings"]["layout"] })} />
        <p className="text-xs text-zinc-500">{PROFILE_LAYOUTS.find(l => l.id === s.layout)?.description}</p>
        <PremiumSelect label="Page entrance" value={s.pageEnter || "Fade"} options={["None", "Fade", "Unfold", "Pop"]} onChange={v => settings({ pageEnter: v as ProfileConfig["settings"]["pageEnter"] })} />
        <div className="flex flex-wrap gap-2"><Button onClick={() => setModal("font")}>Manage fonts</Button><Button onClick={() => setModal("entry")}>Entry screen</Button></div>
      </PremiumPanel>
      <PremiumPanel title="Cursor" description="Effects run on pointer devices and respect reduced motion.">
        <PremiumSelect label="Cursor effect" value={p.cursorEffect} options={CURSOR_EFFECTS} onChange={v => premium({ cursorEffect: v as PremiumSettings["cursorEffect"] })} />
        <PremiumColor label="Cursor color" value={p.cursorColor} onChange={cursorColor => premium({ cursorColor })} />
      </PremiumPanel>
      <PremiumPanel title="Interaction & text">
        <div className="flex flex-wrap gap-2"><Button onClick={() => setModal("sound")}>Click sounds</Button><Button onClick={() => setModal("typewriter")}>Typewriter</Button></div>
        <PremiumToggle label="Parallax tilt" description="A subtle pointer response on desktop." checked={!!s.cardTilt} onChange={cardTilt => settings({ cardTilt })} />
        <PremiumToggle label="Hide view count" checked={!s.showViews} onChange={v => settings({ showViews: !v })} />
      </PremiumPanel>
    </div>
    <Modal open={modal !== null} title={modal === "font" ? "Profile fonts" : modal === "entry" ? "Entry screen" : modal === "sound" ? "Click sounds" : "Typewriter"} description="Changes stay in your draft until you save Premium settings." onClose={() => setModal(null)}>
      <div className="space-y-5">
        {modal === "font" && <><PremiumSelect label="Built-in font" value={s.profileFont || "Inter"} options={fonts} onChange={v => settings({ profileFont: v as ProfileConfig["settings"]["profileFont"] })} /><PremiumSelect label="Apply font to" value={s.profileFontScope || "name"} options={[{ id: "name", name: "Profile name" }, { id: "all", name: "Entire profile" }]} onChange={v => settings({ profileFontScope: v as "all" | "name" })} />{asset("customFont", ".woff,.woff2,.ttf,.otf")}<p className="text-xs text-zinc-500">An uploaded font takes priority. Remove it to use your selected built-in font.</p></>}
        {modal === "entry" && <><PremiumToggle label="Enable entry screen" checked={s.entryScreen} onChange={entryScreen => settings({ entryScreen })} /><label className="block text-sm">Entry text<input maxLength={160} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={s.entryText} onChange={e => settings({ entryText: e.target.value })} /></label><label className="block text-sm">Subtitle<input maxLength={160} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={p.entrySubtitle} onChange={e => premium({ entrySubtitle: e.target.value })} /></label>{asset("entryIcon", "image/png,image/jpeg,image/webp,image/gif")}</>}
        {modal === "sound" && <><PremiumSelect label="Sound preset" value={p.clickPreset} options={CLICK_PRESETS} onChange={v => { premium({ clickPreset: v as PremiumSettings["clickPreset"] }); settings({ clickSound: v !== "None" }); }} /><Button onClick={() => playClickSound(p.clickPreset === "Custom" ? config.assets.clickSound?.url : null, p.clickPreset)}>Preview sound</Button>{p.clickPreset === "Custom" && asset("clickSound", "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac")}<p className="text-xs text-zinc-500">Click sounds are separate from profile music.</p></>}
        {modal === "typewriter" && <><PremiumToggle label="Enable typewriter" checked={!!s.bioTypewriter} onChange={bioTypewriter => settings({ bioTypewriter })} /><label className="block text-sm">Text entries (one per line, up to 12)<textarea rows={5} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3" value={p.typewriterTexts.join("\n")} onChange={e => premium({ typewriterTexts: e.target.value.split("\n").slice(0, 12).map(t => t.slice(0, 200)) })} /></label><RangeControl label="Typing speed" value={s.bioTypeMs || 55} min={20} max={160} suffix="ms" onChange={bioTypeMs => settings({ bioTypeMs })} /><RangeControl label="Deleting speed" value={s.bioDeleteMs || 35} min={20} max={160} suffix="ms" onChange={bioDeleteMs => settings({ bioDeleteMs })} /><RangeControl label="Pause" value={s.bioPauseMs || 1200} min={400} max={4000} suffix="ms" onChange={bioPauseMs => settings({ bioPauseMs })} /></>}
        {busy && <p role="status" className="text-sm text-zinc-400">Uploading…</p>}{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<Button onClick={() => setModal(null)}>Done</Button>
      </div>
    </Modal>
  </>;
}
