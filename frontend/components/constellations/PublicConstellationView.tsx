"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { playClickSound } from "@/lib/enter";
import type { PublicConstellation } from "@/lib/constellations";
import { ConstellationRenderer } from "./ConstellationRenderer";

export function PublicConstellationView({ group, error = "" }: { group: PublicConstellation | null; error?: string }) {
  const [entered, setEntered] = useState(false);

  if (error || !group) {
    return <main className="grid min-h-[100svh] place-items-center bg-[#07070a] px-6 text-center text-white"><div><Sparkles className="mx-auto mb-5 text-rose-300" size={28} /><h1 className="text-2xl font-semibold">This Constellation is unavailable</h1><p role="alert" className="mt-3 text-sm text-zinc-400">{error || "Constellation not found."}</p><Link className="mt-6 inline-flex rounded-xl border border-white/10 px-5 py-3 text-sm" href="/">Visit misa.lol</Link></div></main>;
  }

  const ownerProfile = group.members.find((member) => member.role === "owner")?.profile;
  const entryText = ownerProfile?.settings.entryText?.trim() || "click to enter...";
  const enter = () => {
    if (ownerProfile?.settings.clickSound) playClickSound(ownerProfile.assets.clickSound?.url);
    if (typeof document !== "undefined") {
      document.querySelectorAll<HTMLVideoElement>("[data-constellation-background-video]").forEach((video) => {
        video.muted = false;
        void video.play().catch(() => { video.muted = true; });
      });
    }
    setEntered(true);
  };

  return <main className="relative min-h-[100svh] overflow-x-hidden bg-[#07070a]">
    <motion.div initial={false} animate={entered ? { opacity: 1, scale: 1 } : { opacity: .82, scale: 1.01 }} transition={{ duration: .55, ease: [0.22, 1, .36, 1] }}>
      <ConstellationRenderer group={group} backgroundAudio={entered} />
    </motion.div>
    <AnimatePresence>
      {!entered ? <motion.button type="button" aria-label={entryText} className="fixed inset-0 z-[100] grid cursor-pointer place-items-center bg-black/60 text-white backdrop-blur-[2px]" onClick={enter} initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .35 }}>
        <span className="flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white"><Play size={18} fill="currentColor" /></span>
          <span className="text-xs text-white/70">{entryText}</span>
        </span>
      </motion.button> : null}
    </AnimatePresence>
  </main>;
}