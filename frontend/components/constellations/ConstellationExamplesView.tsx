"use client";

import { useMemo, useState } from "react";
import { cloneMockProfile } from "@/lib/mock-data";
import { defaultConstellationPositions, defaultConstellationScale, type PublicConstellation } from "@/lib/constellations";
import { ConstellationRenderer } from "./ConstellationRenderer";

const names = ["Raza", "Mika", "Noir", "Luna"];
const colors = ["#3b82f6", "#e11d48", "#8b5cf6", "#14b8a6"];

function exampleGroup(count: 2 | 3 | 4): PublicConstellation {
  const positions = defaultConstellationPositions(count);
  return {
    id: `example-${count}`,
    ownerUsername: "raza",
    name: count === 2 ? "Same profile. Different people." : count === 3 ? "Three complete worlds." : "Four profiles. One page.",
    slug: `example-${count}`,
    description: "A layout example using the real Misa profile renderer.",
    capacity: count,
    assignmentMode: "owner",
    globalFont: "Inter",
    allowMemberFonts: true,
    allowMemberMove: true,
    allowMemberResize: true,
    frameMode: "member",
    background: { type: "color", color: "#050507" },
    sharedAssets: { cursor: null, audio: null, audioCover: null, effectVideo: null, effect: "None" },
    status: "published",
    published: true,
    publicPath: `/c/example-${count}`,
    canPublish: true,
    hasUnpublishedChanges: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    members: names.slice(0, count).map((name, index) => {
      const profile = cloneMockProfile();
      profile.profile = { ...profile.profile, username: name.toLowerCase(), displayName: name, description: index % 2 ? "Designer · night owl" : "Music · motion · code" };
      profile.settings = { ...profile.settings, accentColor: colors[index], usernameEffectColor: colors[index], entryScreen: false, layout: index % 3 === 1 ? "Simplistic" : index % 3 === 2 ? "Sleek" : "Modern" };
      return { username: name.toLowerCase(), displayName: name, role: index === 0 ? "owner" as const : "member" as const, slot: index + 1, position: positions[index], scale: defaultConstellationScale(count), frameOverride: index === 2 ? "frameless" as const : "inherit" as const, profile };
    }),
  };
}

export function ConstellationExamplesView({ initialCount = 2 }: { initialCount?: 2 | 3 | 4 }) {
  const [count, setCount] = useState<2 | 3 | 4>(initialCount);
  const group = useMemo(() => exampleGroup(count), [count]);
  return <main className="relative min-h-screen bg-black"><nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-2xl border border-white/10 bg-black/75 p-1.5 shadow-2xl backdrop-blur-xl" aria-label="Constellation examples">{([2, 3, 4] as const).map((value) => <button key={value} type="button" onClick={() => setCount(value)} className={`rounded-xl px-4 py-2 text-xs transition ${count === value ? "bg-[#e11d48] text-white" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}>{value} profiles</button>)}</nav><ConstellationRenderer group={group} /></main>;
}
