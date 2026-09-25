"use client";

import { useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ProfileRenderer } from "@/components/profile/ProfileRenderer";
import { ProfileMusicPlayer } from "@/components/profile/ProfileMusicPlayer";
import { BackgroundEffectLayer } from "@/components/profile/BackgroundEffectLayer";
import type { ProfileConfig } from "@/lib/types";
import { defaultConstellationPositions, type ConstellationGroup, type ConstellationMember, type PublicConstellation } from "@/lib/constellations";
import styles from "./ConstellationRenderer.module.css";

type PlacementPatch = Partial<Pick<ConstellationMember, "position" | "scale">>;

interface RendererProps {
  group: ConstellationGroup | PublicConstellation;
  editor?: boolean;
  fullPreview?: boolean;
  canvasSize?: { width: number; height: number };
  selectedId?: string | null;
  editableMemberIds?: Set<string>;
  onSelect?: (member: ConstellationMember) => void;
  onPlacement?: (member: ConstellationMember, patch: PlacementPatch, commit: boolean) => void;
  className?: string;
  backgroundAudio?: boolean;
}

function resolvedProfile(group: RendererProps["group"], member: ConstellationMember): ProfileConfig | null {
  if (!member.profile) return null;
  const profile: ProfileConfig = {
    ...member.profile,
    assets: {
      ...member.profile.assets,
      background: { url: null },
      backgroundVideo: { url: null },
        backgroundEffectVideo: { url: null },
      audio: { url: null },
      audioArtwork: { url: null },
      tracks: [],
      cursor: { url: null },
      audioEnabled: false,
      audioSource: "standalone",
    },
    settings: { ...member.profile.settings, backgroundEffect: "None" },
  };
  if (!group.allowMemberFonts) {
    profile.settings.profileFont = (group.globalFont || "Inter") as ProfileConfig["settings"]["profileFont"];
    profile.assets.customFont = { url: null };
  }
  const frame = group.frameMode === "framed" || (group.frameMode === "member" && member.frameOverride === "framed")
    ? true
    : group.frameMode === "frameless" || (group.frameMode === "member" && member.frameOverride === "frameless")
      ? false
      : profile.settings.showProfileFrame !== false;
  profile.settings.showProfileFrame = frame;
  profile.settings.entryScreen = false;
  profile.settings.profileFrameX = 0;
  profile.settings.profileFrameY = 0;
  return profile;
}

export function ConstellationRenderer(props: RendererProps) {
  const { group, editor = false, fullPreview = false, canvasSize, selectedId, editableMemberIds, onSelect, onPlacement, className = "", backgroundAudio = false } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    position: { x: number; y: number };
    scale: number;
    latest: PlacementPatch;
  } | null>(null);
  const capacity = Math.max(2, Math.min(4, group.capacity));
  const ordered = useMemo(() => [...group.members].filter((member) => member.slot <= 4).sort((a, b) => a.slot - b.slot).slice(0, 4), [group.members]);
  const defaults = useMemo(() => defaultConstellationPositions(capacity), [capacity]);
  const background = group.background || { type: "color" as const, color: "#08080d" };
  const sharedAssets = group.sharedAssets || { cursor: null, audio: null, audioCover: null, effectVideo: null, effect: "None" as const };
  const sharedAudioConfig = useMemo(() => {
    const base = ordered.find((member) => member.profile)?.profile;
    if (!base || !sharedAssets.audio?.url) return null;
    return {
      ...base,
      assets: {
        ...base.assets,
        background: { url: null },
        backgroundVideo: { url: null },
        backgroundEffectVideo: { url: null },
        audio: { url: sharedAssets.audio.url, name: sharedAssets.audio.name, type: sharedAssets.audio.contentType },
        audioArtwork: sharedAssets.audioCover?.url ? { url: sharedAssets.audioCover.url, name: sharedAssets.audioCover.name, type: sharedAssets.audioCover.contentType } : { url: null },
        audioTitle: sharedAssets.audio.title || sharedAssets.audio.name || "Constellation audio",
        tracks: [],
        cursor: { url: null },
        audioEnabled: false,
        audioSource: "standalone" as const,
      },
      settings: { ...base.settings, backgroundEffect: "None" as const, widgetColorSwap: false },
    };
  }, [ordered, sharedAssets.audio, sharedAssets.audioCover]);

  const start = (event: ReactPointerEvent, member: ConstellationMember, mode: "move" | "resize") => {
    if (!member.userId || !editableMemberIds?.has(member.userId) || !onPlacement) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: member.userId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      position: member.position,
      scale: member.scale,
      latest: {},
    };
    onSelect?.(member);
  };

  const move = (event: ReactPointerEvent, member: ConstellationMember) => {
    const state = drag.current;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!state || state.id !== member.userId || !bounds || !onPlacement) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const patch: PlacementPatch = state.mode === "resize"
      ? { scale: Math.max(.4, Math.min(1.8, state.scale + Math.max(dx, dy) / 260)) }
      : { position: {
          x: Math.max(0, Math.min(100, state.position.x + dx / bounds.width * 100)),
          y: Math.max(0, Math.min(100, state.position.y + dy / bounds.height * 100)),
        } };
    state.latest = patch;
    const element = event.currentTarget as HTMLElement;
    if ("position" in patch && patch.position) {
      element.style.setProperty("--member-x", String(patch.position.x) + "%");
      element.style.setProperty("--member-y", String(patch.position.y) + "%");
    }
    if ("scale" in patch && patch.scale !== undefined) {
      element.style.setProperty("--member-scale", String(patch.scale));
    }
  };

  const end = (event: ReactPointerEvent, member: ConstellationMember) => {
    const state = drag.current;
    if (!state || state.id !== member.userId || !onPlacement) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    if (Object.keys(state.latest).length) onPlacement(member, state.latest, true);
  };

  return (
    <section
      ref={canvas}
      className={`${styles.canvas} ${editor ? styles.editor : ""} ${fullPreview ? styles.fullPreview : ""} ${className}`}
      data-count={capacity}
      style={{
        backgroundColor: background.color || "#08080d",
        cursor: sharedAssets.cursor?.url ? `url("${sharedAssets.cursor.url}"), auto` : undefined,
        ["--constellation-font" as string]: group.globalFont || "Inter",
        ["--member-count" as string]: capacity,
        ["--constellation-canvas-width" as string]: canvasSize ? String(canvasSize.width) + "px" : undefined,
        ["--constellation-canvas-height" as string]: canvasSize ? String(canvasSize.height) + "px" : undefined,
      } as CSSProperties}
      aria-label={`${group.name} Constellation with ${group.members.length} profiles`}
    >
      {background.type === "image" && background.url ? <div className={styles.backgroundImage} style={{ backgroundImage: `url("${background.url}")` }} /> : null}
      {background.type === "video" && background.url ? <video className={styles.backgroundVideo} src={background.url} autoPlay muted={!backgroundAudio} loop playsInline preload="metadata" data-constellation-background-video /> : null}
      <BackgroundEffectLayer effect={sharedAssets.effect || "None"} className={styles.effectVideo} />
      {(!sharedAssets.effect || sharedAssets.effect === "None") && sharedAssets.effectVideo?.url ? <video className={styles.effectVideo} src={sharedAssets.effectVideo.url} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" /> : null}
      <div className={styles.scrim} />
      {(group.name || group.description) && <header className={styles.heading}><h1>{group.name}</h1>{group.description ? <p>{group.description}</p> : null}</header>}
      <div className={styles.stage}>
        {ordered.map((member, index) => {
          const profile = resolvedProfile(group, member);
          const editable = Boolean(member.userId && editableMemberIds?.has(member.userId));
          const position = member.position || defaults[Math.max(0, member.slot - 1)] || { x: 50, y: 50 };
          const mobileY = (index + 1) * 100 / (ordered.length + 1);
          return (
            <article
              key={member.userId || member.username}
              className={`${styles.member} ${editable ? styles.editable : ""} ${member.userId && selectedId === member.userId ? styles.selected : ""}`}
              style={{
                ["--member-x" as string]: `${position.x}%`,
                ["--member-y" as string]: `${position.y}%`,
                ["--member-mobile-y" as string]: `${mobileY}%`,
                ["--member-scale" as string]: member.scale || 1,
              } as CSSProperties}
              onPointerDown={(event) => start(event, member, "move")}
              onPointerMove={(event) => move(event, member)}
              onPointerUp={(event) => end(event, member)}
              onPointerCancel={(event) => end(event, member)}
              onClick={() => onSelect?.(member)}
              data-slot={member.slot}
            >
              {profile ? <ProfileRenderer config={profile} preview fitViewport embedded /> : <div className={styles.missing}>@{member.username}<span>Profile unavailable</span></div>}
              {editor && <span className={styles.slotLabel}>Slot {member.slot} · @{member.username}</span>}
              {editable && <button type="button" className={styles.resize} aria-label={`Resize @${member.username}'s profile`} onPointerDown={(event) => start(event, member, "resize")} />}
            </article>
          );
        })}
        {editor && Array.from({ length: capacity }, (_, index) => index + 1).filter((slot) => !ordered.some((member) => member.slot === slot)).map((slot, index) => {
          const position = defaults[slot - 1] || { x: 50, y: 50 };
          return <div key={slot} className={styles.emptySlot} style={{ ["--member-x" as string]: `${position.x}%`, ["--member-y" as string]: `${position.y}%`, ["--member-mobile-y" as string]: `${(ordered.length + index + 1) * 100 / (capacity + 1)}%` } as CSSProperties}>Slot {slot}<span>Waiting for a profile</span></div>;
        })}
      </div>
      {sharedAudioConfig ? <div className={styles.sharedAudio}><ProfileMusicPlayer config={sharedAudioConfig} preview /></div> : null}
      <footer className={styles.signature}>misa.lol / {group.slug}</footer>
    </section>
  );
}
