"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, Copy, Eye, Film, Image as ImageIcon, Link2, Maximize2, MousePointer2, Move, Music, Plus, RotateCcw, Save, Trash2, Upload, UserPlus, UsersRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button, PageHeader, SectionTitle } from "@/components/ui";
import { ConstellationProfileControls } from "@/components/customization/CustomizationWorkspace";
import { BackgroundEffectLayer } from "@/components/profile/BackgroundEffectLayer";
import { BACKGROUND_EFFECTS } from "@/lib/background-effects";
import { ProfileDraftProvider } from "@/lib/profile-store";
import type { BackgroundEffect, ProfileConfig } from "@/lib/types";
import {
  cacheConstellationDashboard,
  constellationApi,
  constellationError,
  loadConstellationDashboard,
  peekConstellationDashboard,
  constellationExamples,
  defaultConstellationPositions,
  defaultConstellationScale,
  type ConstellationAssignmentMode,
  type ConstellationGroup,
  type ConstellationIdentity,
  type ConstellationInvitation,
  type ConstellationMember,
  type ConstellationMutation,
} from "@/lib/constellations";
import { ConstellationRenderer } from "./ConstellationRenderer";
import styles from "./Constellations.module.css";

type Entry = "create" | "join" | null;
type Tab = "design" | "shared" | "members" | "permissions";
type MemberPatch = Partial<Pick<ConstellationMember, "slot" | "position" | "scale" | "frameOverride">>;
type MemberChange = { member: ConstellationMember; patch: MemberPatch };

const constellationSlugPattern = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const constellationSlugHelp = "Use 2–32 lowercase letters, numbers, or internal hyphens.";

function cleanConstellationSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
}

export function ConstellationsView() {
  const [me, setMe] = useState<ConstellationIdentity | null>(() => peekConstellationDashboard()?.me || null);
  const [groups, setGroups] = useState<ConstellationGroup[]>(() => peekConstellationDashboard()?.groups || []);
  const [invitations, setInvitations] = useState<ConstellationInvitation[]>(() => peekConstellationDashboard()?.invitations || []);
  const [selectedId, setSelectedId] = useState(() => peekConstellationDashboard()?.groups[0]?.id || "");
  const [working, setWorking] = useState<ConstellationGroup | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileConfig | null>(null);
  const [entry, setEntry] = useState<Entry>(null);
  const [tab, setTab] = useState<Tab>("design");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(() => Boolean(peekConstellationDashboard()));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const joinedToken = useRef("");

  const load = async (force = false) => {
    const data = await loadConstellationDashboard(force);
    setMe(data.me);
    setGroups(data.groups);
    setInvitations(data.invitations);
    setSelectedId((current) => current && data.groups.some((group) => group.id === current) ? current : data.groups[0]?.id || "");
  };

  useEffect(() => {
    void load().catch((reason) => setError(constellationError(reason))).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready && me) cacheConstellationDashboard({ me, groups, invitations });
  }, [groups, invitations, me, ready]);
  useEffect(() => {
    const selected = groups.find((group) => group.id === selectedId) || null;
    setWorking(selected);
  }, [groups, selectedId]);

  useEffect(() => {
    const selected = groups.find((group) => group.id === selectedId);
    const member = selected?.members.find((item) => item.userId === me?.id);
    setProfileDraft(member?.profile || null);
  }, [selectedId, me?.id]);

  useEffect(() => {
    if (!ready || busy) return;
    const token = new URLSearchParams(window.location.search).get("invite") || "";
    if (!token || joinedToken.current === token) return;
    joinedToken.current = token;
    setBusy(true);
    void constellationApi.join(token)
      .then((result) => {
        if (result.group) {
          setGroups((current) => [result.group!, ...current.filter((item) => item.id !== result.group!.id)]);
          setSelectedId(result.group.id);
          setNotice("You joined the Constellation with your current Misa profile.");
          window.history.replaceState({}, "", "/dashboard/constellations");
        }
      })
      .catch((reason) => { setError(constellationError(reason)); setEntry("join"); })
      .finally(() => setBusy(false));
  }, [ready, busy]);

  const apply = async (task: () => Promise<ConstellationMutation>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await task();
      if (result.deleted || (result.left && !result.group)) {
        await load(true);
      } else if (result.group) {
        setGroups((current) => [result.group!, ...current.filter((item) => item.id !== result.group!.id)]);
        setSelectedId(result.group.id);
        setWorking(result.group);
      }
      setNotice(success);
      return result;
    } catch (reason) {
      setError(constellationError(reason));
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className={styles.loading}>Loading Constellations…</main>;

  const group = working;
  const owner = Boolean(group && me && group.ownerId === me.id);
  const previewGroup = group && me && profileDraft ? {
    ...group,
    members: group.members.map((member) => member.userId === me.id ? { ...member, profile: profileDraft } : member),
  } : group;
  const memberProfile = group?.members.find((member) => member.userId === me?.id)?.profile || null;

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Shared profiles"
        title="Constellations"
        description="Compose complete Misa profiles together on one shared page."
        action={<div className={styles.headerActions}><Button onClick={() => setEntry("join")}><Link2 size={15} />Join</Button><Button variant="accent" onClick={() => setEntry("create")}><Plus size={15} />Create</Button></div>}
      />
      {error ? <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setError(""); void load(true).catch((reason) => setError(constellationError(reason))); }}>Retry</button></div> : null}
      {notice ? <p role="status" className={styles.notice}><Check size={15} />{notice}</p> : null}
      {invitations.length ? <InvitationStrip invitations={invitations} busy={busy} onRespond={(invite, accept) => void apply(() => constellationApi.respond(invite, accept), accept ? "Invitation accepted." : "Invitation declined.")} /> : null}
      {entry ? <EntryPanel mode={entry} busy={busy} onClose={() => setEntry(null)} onCreate={(body) => void apply(() => constellationApi.create(body), "Constellation created.").then((result) => { if (result) setEntry(null); })} onJoin={(token) => void apply(() => constellationApi.join(token), "You joined the Constellation.").then((result) => { if (result) setEntry(null); })} /> : null}
      {!group ? <EmptyState onCreate={() => setEntry("create")} onJoin={() => setEntry("join")} /> : me ? (
        <>
          <div className={styles.contextBar}>
            <label>Constellation<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{groups.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
            <span>{group.members.length}/{group.capacity} profiles</span>
            <div className={styles.contextActions}>
              {group.published ? <a href={group.publicPath} target="_blank" rel="noreferrer">Open public page<ArrowUpRight size={14} /></a> : null}
              {owner ? <Button variant="accent" disabled={busy || !group.canPublish} onClick={() => void apply(() => constellationApi.publish(group.id), "Constellation published.")}>Publish / update</Button> : null}
            </div>
          </div>
          <div className={styles.workspace}>
            <section className={styles.controls}>
              <div className={styles.tabs}>{(["design", "shared", "members", "permissions"] as const).map((item) => <button key={item} type="button" data-active={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>
              {tab === "design" ? <DesignPanel group={group} owner={owner} busy={busy} memberProfile={memberProfile} profileDraft={profileDraft} onProfileDraft={setProfileDraft} onSaveProfile={async (profile) => { const result = await apply(() => constellationApi.updateProfile(group.id, profile), "Constellation design saved."); if (!result) throw new Error("Constellation design could not be saved."); }} onBackgroundEffect={(effect) => { if (!busy) void apply(() => constellationApi.setSharedEffect(group.id, effect), "Background effect saved."); }} onLocal={setWorking} onSave={(patch) => void apply(() => constellationApi.update(group.id, patch), "Constellation settings saved.")} onReset={() => void resetLayout(group, apply)} /> : null}
              {tab === "shared" ? <SharedPanel group={group} busy={busy} onBackground={(kind, file) => void apply(() => constellationApi.uploadBackground(group.id, kind, group.background.color, file), "Shared background uploaded to R2.")} onRemoveBackground={() => apply(() => constellationApi.removeBackground(group.id), "Shared background removed.")} onUpload={(kind, file, title) => apply(() => constellationApi.uploadSharedAsset(group.id, kind, file, title), `Shared ${kind} uploaded to R2.`)} onRemove={(kind) => apply(() => constellationApi.removeSharedAsset(group.id, kind), `Shared ${kind} removed.`)} onEffect={(effect) => apply(() => constellationApi.setSharedEffect(group.id, effect), "Background effect saved.")} /> : null}
              {tab === "members" ? <MembersPanel group={group} me={me} owner={owner} busy={busy} onSave={(changes) => apply(() => persistMemberChanges(group.id, changes), "Member settings saved.").then(Boolean)} onRemove={(member) => void apply(() => constellationApi.removeMember(group.id, member.userId || ""), "Member removed.")} onInvite={(username) => apply(() => constellationApi.createInvite(group.id, username), "Invitation created.")} onTransfer={(member) => void apply(() => constellationApi.transfer(group.id, member.userId || ""), "Ownership transferred.")} /> : null}
              {tab === "permissions" ? <PermissionsPanel group={group} owner={owner} busy={busy} onLocal={setWorking} onSave={(patch) => void apply(() => constellationApi.update(group.id, patch), "Permissions saved.")} /> : null}
            </section>
            <EditorPreview group={previewGroup || group} me={me} owner={owner} busy={busy} onSave={(changes) => apply(() => persistMemberChanges(group.id, changes), "Layout saved.").then(Boolean)} />
          </div>
          <PublishBar group={group} owner={owner} busy={busy} onUnpublish={() => void apply(() => constellationApi.unpublish(group.id), "Constellation unpublished.")} onDelete={() => { if (window.confirm(`Delete “${group.name}”? This removes its shared page and invitations.`)) void apply(() => constellationApi.delete(group.id), "Constellation deleted."); }} />
        </>
      ) : null}
    </main>
  );
}

function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <section className={styles.empty}><UsersRound size={34} /><h2>Bring complete profiles into one shared composition</h2><p>Create a shared page or join one with a secure invite. Every member keeps their existing Misa profile design.</p><div><Button variant="accent" onClick={onCreate}><Plus size={16} />Create a Constellation</Button><Button onClick={onJoin}><Link2 size={16} />Join a Constellation</Button></div><a className={styles.exampleLink} href="/dashboard/constellations/examples" target="_blank" rel="noreferrer">Open live 2 / 3 / 4 profile examples<ArrowUpRight size={14} /></a><div className={styles.examples}>{constellationExamples.map((example) => <article key={example.count}><strong>{example.count}</strong><span>{example.label}</span><p>{example.description}</p></article>)}</div></section>;
}

function EntryPanel({ mode, busy, onClose, onCreate, onJoin }: { mode: Exclude<Entry, null>; busy: boolean; onClose: () => void; onCreate: (body: { name: string; slug: string; capacity: number; assignmentMode: ConstellationAssignmentMode }) => void; onJoin: (token: string) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");
  const [capacity, setCapacity] = useState(3);
  const [assignmentMode, setAssignmentMode] = useState<ConstellationAssignmentMode>("owner");
  const [token, setToken] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "create") {
      const cleanName = name.trim();
      const cleanSlug = slug.trim();
      if (!constellationSlugPattern.test(cleanSlug)) {
        setSlugError(constellationSlugHelp);
        return;
      }
      setSlugError("");
      onCreate({ name: cleanName, slug: cleanSlug, capacity, assignmentMode });
      return;
    }
    onJoin(token.trim().split("invite=").pop() || "");
  };

  return (
    <section className={styles.entryPanel}>
      <div className={styles.panelHead}>
        <div><span>{mode === "create" ? "New shared page" : "Secure invitation"}</span><h2>{mode === "create" ? "Create a Constellation" : "Join a Constellation"}</h2></div>
        <button type="button" onClick={onClose}>×</button>
      </div>
      <form onSubmit={submit} className={styles.form}>
        {mode === "create" ? <>
          <label>Name<input required maxLength={60} value={name} onChange={(event) => {
            setName(event.target.value);
            if (!slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32));
          }} /></label>
          <label>Public path
            <span className={styles.urlField + (slugError ? " " + styles.invalidField : "")}>
              <b>misa.lol/c/</b>
              <input
                required
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={slug}
                aria-invalid={Boolean(slugError)}
                aria-describedby="constellation-slug-help"
                onChange={(event) => {
                  setSlug(cleanConstellationSlug(event.target.value));
                  if (slugError) setSlugError("");
                }}
              />
            </span>
            <small id="constellation-slug-help" className={slugError ? styles.fieldError : styles.fieldHint}>{slugError || constellationSlugHelp}</small>
          </label>
          <fieldset><legend>Profile slots</legend><div className={styles.slotChoices}>{[2, 3, 4].map((count) => <button type="button" key={count} data-active={capacity === count} onClick={() => setCapacity(count)}>{count}</button>)}</div></fieldset>
          <label>Slot assignment<select value={assignmentMode} onChange={(event) => setAssignmentMode(event.target.value as ConstellationAssignmentMode)}><option value="owner">Owner assigns members</option><option value="self">Members select available slots</option></select></label>
        </> : <label>Invite link or token<input required value={token} placeholder="Paste your secure invite" onChange={(event) => setToken(event.target.value)} /></label>}
        <Button type="submit" variant="accent" disabled={busy}>{busy ? "Working…" : mode === "create" ? "Create Constellation" : "Join Constellation"}</Button>
      </form>
    </section>
  );
}
function InvitationStrip({ invitations, busy, onRespond }: { invitations: ConstellationInvitation[]; busy: boolean; onRespond: (invite: ConstellationInvitation, accept: boolean) => void }) {
  return <section className={styles.invites}>{invitations.map((invite) => <article key={invite.id}><div><strong>{invite.groupName || "Constellation invitation"}</strong><span>Invited by @{invite.inviterUsername || "a Misa member"}</span></div><Button disabled={busy} onClick={() => onRespond(invite, false)}>Decline</Button><Button variant="accent" disabled={busy} onClick={() => onRespond(invite, true)}>Join</Button></article>)}</section>;
}

function DesignPanel({ group, owner, busy, memberProfile, profileDraft, onProfileDraft, onSaveProfile, onBackgroundEffect, onLocal, onSave, onReset }: { group: ConstellationGroup; owner: boolean; busy: boolean; memberProfile: ProfileConfig | null; profileDraft: ProfileConfig | null; onProfileDraft: (profile: ProfileConfig) => void; onSaveProfile: (profile: ProfileConfig) => Promise<void>; onBackgroundEffect: (effect: BackgroundEffect) => void; onLocal: (group: ConstellationGroup) => void; onSave: (patch: Partial<ConstellationGroup>) => void; onReset: () => void }) {
  const [slugError, setSlugError] = useState("");
  const patch = (next: Partial<ConstellationGroup>) => onLocal({ ...group, ...next });
  const save = () => {
    const slug = group.slug.trim();
    if (!constellationSlugPattern.test(slug)) { setSlugError(constellationSlugHelp); return; }
    setSlugError("");
    onSave({ name: group.name, slug, description: group.description, globalFont: group.globalFont });
  };
  const initialDesign = profileDraft || memberProfile;
  return <div className={styles.panelBody}>
    <SectionTitle title="Constellation page" description="The page settings and each member's Constellation design are separate from normal Customize profiles." />
    <label>Name<input disabled={!owner || busy} maxLength={60} value={group.name} onChange={(event) => patch({ name: event.target.value })} /></label>
    <label>Master description<textarea disabled={!owner || busy} maxLength={500} value={group.description} onChange={(event) => patch({ description: event.target.value })} /></label>
    <div className={styles.twoCols}><label>URL slug<input disabled={!owner || busy} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={group.slug} aria-invalid={Boolean(slugError)} aria-describedby="constellation-design-slug-help" onChange={(event) => { patch({ slug: cleanConstellationSlug(event.target.value) }); if (slugError) setSlugError(""); }} /><small id="constellation-design-slug-help" className={slugError ? styles.fieldError : styles.fieldHint}>{slugError || constellationSlugHelp}</small></label><label>Global font<input disabled={!owner || busy} maxLength={120} value={group.globalFont} onChange={(event) => patch({ globalFont: event.target.value })} /></label></div>
    {owner ? <div className={styles.actionGrid}><Button variant="accent" disabled={busy} onClick={save}><Save size={14} />Save page settings</Button><Button disabled={busy} onClick={onReset}><RotateCcw size={14} />Reset layout</Button></div> : null}
    {initialDesign ? <ProfileDraftProvider initialConfig={initialDesign} draftKey={group.id} onDraftChange={onProfileDraft} onSave={onSaveProfile}><ConstellationProfileControls backgroundEffect={group.sharedAssets?.effect || "None"} onBackgroundEffectChange={onBackgroundEffect} /></ProfileDraftProvider> : <p className={styles.muted}>Your independent Constellation design is loading.</p>}
  </div>;
}
function SharedPanel({ group, busy, onBackground, onRemoveBackground, onUpload, onRemove, onEffect }: {
  group: ConstellationGroup;
  busy: boolean;
  onBackground: (kind: "image" | "video", file: File) => void;
  onRemoveBackground: () => Promise<ConstellationMutation | null>;
  onUpload: (kind: "cursor" | "audio" | "audioCover" | "effectVideo", file: File, title?: string) => Promise<ConstellationMutation | null>;
  onRemove: (kind: "cursor" | "audio" | "audioCover" | "effectVideo") => Promise<ConstellationMutation | null>;
  onEffect: (effect: BackgroundEffect) => Promise<ConstellationMutation | null>;
}) {
  const background = useRef<HTMLInputElement>(null);
  const cursor = useRef<HTMLInputElement>(null);
  const effect = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioTitle, setAudioTitle] = useState("");
  const [audioSaving, setAudioSaving] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const shared = group.sharedAssets || { cursor: null, audio: null, audioCover: null, effectVideo: null, effect: "None" as const };
  const [effectDraft, setEffectDraft] = useState<BackgroundEffect>(shared.effect || "None");
  const choose = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click();

  useEffect(() => {
    if (!coverFile) { setCoverPreview(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  useEffect(() => {
    if (!audioOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [audioOpen]);

  const closeAudio = () => {
    if (audioSaving) return;
    setAudioOpen(false);
    setAudioFile(null);
    setCoverFile(null);
    setAudioTitle("");
  };
  const openAudio = () => {
    setAudioFile(null);
    setCoverFile(null);
    setAudioTitle(shared.audio?.title || shared.audio?.name?.replace(/\.[^.]+$/, "") || "");
    setAudioOpen(true);
  };
  const saveAudio = async () => {
    if (!audioFile || audioSaving) return;
    if (audioFile.size > 40_000_000) { window.alert("Audio files can be up to 40 MB."); return; }
    if (coverFile && coverFile.size > 15_000_000) { window.alert("Audio covers can be up to 15 MB."); return; }
    setAudioSaving(true);
    try {
      const uploaded = await onUpload("audio", audioFile, audioTitle.trim());
      if (!uploaded) return;
      if (coverFile) {
        const coverUploaded = await onUpload("audioCover", coverFile);
        if (!coverUploaded) return;
      }
      setAudioOpen(false);
      setAudioFile(null);
      setCoverFile(null);
      setAudioTitle("");
    } finally {
      setAudioSaving(false);
    }
  };
  const removeAudio = async () => {
    if (shared.audioCover) await onRemove("audioCover");
    await onRemove("audio");
  };
  const backgroundChanged = (file?: File) => {
    if (!file) return;
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
    onBackground(isVideo ? "video" : "image", file);
  };

  const audioSheet = audioOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[160] flex h-[100dvh] items-end justify-center bg-black/70 px-3 pt-3 backdrop-blur-sm sm:items-center sm:p-6" style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeAudio(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="shared-audio-title" className="flex w-full max-w-xl flex-col overflow-hidden rounded-[1.75rem] border border-white/[.1] bg-[#101014]/95 shadow-2xl shadow-black/70" style={{ maxHeight: "min(86dvh, 46rem)" }}>
        <div className="mx-auto mt-2 h-1 w-12 shrink-0 rounded-full bg-white/[.12] sm:hidden" />
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5"><h2 id="shared-audio-title" className="text-base font-semibold text-white sm:text-lg">Add an Audio</h2><button type="button" onClick={closeAudio} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-zinc-400 transition hover:bg-white/[.09] hover:text-white" aria-label="Close audio upload"><X size={20} /></button></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6">
          <input ref={audioInput} hidden type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,.mp3,.wav,.ogg,.m4a,.aac,.webm" onChange={(event) => { const file = event.currentTarget.files?.[0] || null; setAudioFile(file); if (file && !audioTitle) setAudioTitle(file.name.replace(/\.[^.]+$/, "")); event.currentTarget.value = ""; }} />
          <button type="button" onClick={() => choose(audioInput)} className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/[.07] bg-black/20 p-5 text-zinc-500 transition hover:border-white/20 hover:text-white"><Music size={36} className="text-white" /><span className="max-w-full truncate text-sm">{audioFile?.name || "Click to upload an audio"}</span></button>
          <input ref={coverInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { setCoverFile(event.currentTarget.files?.[0] || null); event.currentTarget.value = ""; }} />
          <button type="button" onClick={() => choose(coverInput)} className="flex min-h-28 w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-white/[.07] bg-black/20 p-5 text-zinc-500 transition hover:border-white/20 hover:text-white">{coverPreview ? <img src={coverPreview} alt="Selected audio cover" className="h-20 w-20 rounded-xl object-cover" /> : shared.audioCover?.url ? <img src={shared.audioCover.url} alt="Current audio cover" className="h-20 w-20 rounded-xl object-cover" /> : <ImageIcon size={34} className="text-white" />}<span className="max-w-full truncate text-sm">{coverFile?.name || "Click to upload an audio cover"}</span></button>
          <label className="block"><span className="mb-2 block text-sm text-zinc-200">Audio Title</span><input value={audioTitle} maxLength={120} onChange={(event) => setAudioTitle(event.target.value)} placeholder="Add a title..." className="h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e11d48]/50" /></label>
          <Button variant="accent" className="h-11 w-full justify-center" disabled={!audioFile || audioSaving || busy} onClick={() => void saveAudio()}>{audioSaving ? "Uploading..." : "Add Audio"}</Button>
        </div>
      </section>
    </div>, document.body) : null;

  return <div className={styles.panelBody}>
    <SectionTitle title="Shared media" description="Every accepted member can use the shared background, cursor, audio, and selected background effect." />
    <article className={styles.sharedAssetCard}>
      <div className="relative isolate flex h-[220px] flex-col items-center justify-center overflow-hidden rounded-2xl text-center sm:h-[250px]">{group.background.url ? <div className="absolute inset-0 -z-10">{group.background.type === "video" ? <video src={group.background.url} className="h-full w-full object-cover" muted loop autoPlay playsInline preload="metadata" /> : <img src={group.background.url} alt="Current shared background" className="h-full w-full object-cover" />}<div className="absolute inset-0 bg-black/50" /></div> : null}<strong className="block text-xl text-white drop-shadow-lg">Background</strong><input ref={background} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov" onChange={(event) => { backgroundChanged(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><div className="mt-4 flex items-center justify-center gap-2"><Button className="backdrop-blur-md" disabled={busy} onClick={() => choose(background)}><Upload size={14} />{group.background.url ? "Replace" : "Upload"}</Button>{group.background.url ? <Button className="backdrop-blur-md" disabled={busy} onClick={() => void onRemoveBackground()}><Trash2 size={14} />Remove</Button> : null}</div>{group.background.url ? <p className="absolute inset-x-4 bottom-3 truncate text-[11px] text-white/55">{group.background.name || "Current shared background"}</p> : null}</div>
    </article>
    <article className={styles.sharedAssetCard}>
      <div className={styles.sharedAssetTitle}><Film size={17} /><div><strong>Background effect</strong><span>Lightweight JavaScript particles · no upload needed</span></div></div>
      <div className="relative isolate h-44 overflow-hidden rounded-2xl border border-white/[.07] bg-[radial-gradient(circle_at_25%_20%,rgba(225,29,72,.15),transparent_45%),#09090d]">
        <BackgroundEffectLayer effect={effectDraft} className="z-0" />
        <div className="absolute inset-x-3 bottom-3 z-10"><select aria-label="Background effect" value={effectDraft} onChange={(event) => setEffectDraft(event.target.value as BackgroundEffect)} className="h-11 w-full rounded-xl border border-white/[.1] bg-[#15151a]/90 px-3 text-sm text-white outline-none backdrop-blur-md">{BACKGROUND_EFFECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
      </div>
      <div className={styles.actionGrid}><Button variant="accent" disabled={busy || effectDraft === (shared.effect || "None")} onClick={() => void onEffect(effectDraft)}><Save size={14} />Save effect</Button>{shared.effect && shared.effect !== "None" ? <Button disabled={busy} onClick={() => { setEffectDraft("None"); void onEffect("None"); }}><Trash2 size={14} />Remove</Button> : null}</div>
    </article>
    <article className={styles.sharedAssetCard}>
      <div className="relative isolate flex h-[220px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/[.08] bg-white/[.025] px-5 text-center sm:h-[250px] sm:px-8">
        {shared.cursor?.url ? <div className="absolute inset-0 -z-10"><img src={shared.cursor.url} alt="Current shared cursor" className="h-full w-full object-contain p-10 sm:p-12" /><div className="absolute inset-0 bg-black/50" /></div> : <MousePointer2 size={34} className="mb-3 text-zinc-500" />}
        <strong className="text-xl font-medium text-white drop-shadow-lg">Custom cursor</strong>
        {!shared.cursor?.url ? <span className="mt-2 text-xs text-zinc-500">No cursor uploaded</span> : null}
        <input ref={cursor} hidden type="file" accept="image/png,image/gif,image/x-icon,.ico" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onUpload("cursor", file); event.currentTarget.value = ""; }} />
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button disabled={busy} onClick={() => choose(cursor)}><Upload size={14} />{shared.cursor ? "Replace cursor" : "Upload cursor"}</Button>
          {shared.cursor ? <Button disabled={busy} onClick={() => void onRemove("cursor")}><Trash2 size={14} />Remove</Button> : null}
        </div>
        {shared.cursor?.url ? <span className="absolute inset-x-4 bottom-3 truncate text-[11px] text-white/55">{shared.cursor.name || "Current cursor"}</span> : null}
      </div>
    </article>
    <article className={styles.sharedAssetCard}><div className={styles.sharedAssetTitle}><Music size={17} /><div><strong>Audio</strong><span>{shared.audio?.title || shared.audio?.name || "No audio uploaded"}</span></div></div>{shared.audioCover?.url ? <img className="h-20 w-20 rounded-xl object-cover" src={shared.audioCover.url} alt="Shared audio cover" /> : null}{shared.audio?.url ? <audio className={styles.audioPreview} src={shared.audio.url} controls preload="metadata" /> : null}<div className={styles.actionGrid}><Button disabled={busy} onClick={openAudio}><Upload size={14} />{shared.audio ? "Replace audio" : "Add audio"}</Button>{shared.audio ? <Button disabled={busy} onClick={() => void removeAudio()}><Trash2 size={14} />Remove</Button> : null}</div></article>
    {audioSheet}
  </div>;
}
function memberKey(member: ConstellationMember) {
  return member.userId || member.username;
}

function MembersPanel({ group, me, owner, busy, onSave, onRemove, onInvite, onTransfer }: { group: ConstellationGroup; me: ConstellationIdentity; owner: boolean; busy: boolean; onSave: (changes: MemberChange[]) => Promise<boolean>; onRemove: (member: ConstellationMember) => void; onInvite: (username?: string) => Promise<ConstellationMutation | null>; onTransfer: (member: ConstellationMember) => void }) {
  const [username, setUsername] = useState("");
  const [link, setLink] = useState("");
  const [drafts, setDrafts] = useState<Record<string, MemberPatch>>({});

  useEffect(() => setDrafts({}), [group.id]);

  const draftMember = (member: ConstellationMember) => ({ ...member, ...drafts[memberKey(member)] });
  const updateDraft = (member: ConstellationMember, patch: MemberPatch) => {
    const key = memberKey(member);
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };
  const saveDrafts = async () => {
    const changes = group.members.flatMap((member) => {
      const patch = drafts[memberKey(member)];
      return patch ? [{ member, patch }] : [];
    });
    if (changes.length && await onSave(changes)) setDrafts({});
  };
  const invite = async (target?: string) => {
    const result = await onInvite(target);
    if (result?.invitation?.joinPath) setLink(window.location.origin + result.invitation.joinPath);
    if (target) setUsername("");
  };

  return (
    <div className={styles.panelBody}>
      <SectionTitle title="Members and slots" description="Assign each complete profile to an available place." />
      {group.members.map((member) => {
        const current = draftMember(member);
        return (
          <article className={styles.memberRow} key={memberKey(member)}>
            <div><strong>{member.displayName}{member.userId === me.id ? " (you)" : ""}</strong><span>@{member.username} · {member.role}</span></div>
            <select disabled={busy || (!owner && !(group.assignmentMode === "self" && member.userId === me.id))} value={current.slot} onChange={(event) => updateDraft(member, { slot: Number(event.target.value) })}>
              {Array.from({ length: group.capacity }, (_, index) => index + 1).map((slot) => <option key={slot} value={slot} disabled={group.members.some((item) => draftMember(item).slot === slot && memberKey(item) !== memberKey(member))}>Slot {slot}</option>)}
            </select>
            <select disabled={busy || (!owner && group.frameMode !== "member") || (!owner && member.userId !== me.id)} value={current.frameOverride} onChange={(event) => updateDraft(member, { frameOverride: event.target.value as ConstellationMember["frameOverride"] })}>
              <option value="inherit">Profile frame</option><option value="framed">Framed</option><option value="frameless">Frameless</option>
            </select>
            {owner && member.userId !== me.id ? <div className={styles.rowActions}><button type="button" title="Transfer ownership" disabled={busy} onClick={() => onTransfer(member)}>Owner</button><button type="button" title="Remove member" disabled={busy} onClick={() => onRemove(member)}>Remove</button></div> : null}
          </article>
        );
      })}
      <Button variant="accent" disabled={busy || !Object.keys(drafts).length} onClick={() => void saveDrafts()}><Save size={14} />Save member settings</Button>
      {owner ? <>
        <div className={styles.inviteForm}><input value={username} placeholder="@username (optional)" onChange={(event) => setUsername(event.target.value)} /><Button disabled={busy} onClick={() => void invite(username.trim().replace(/^@/, "") || undefined)}><UserPlus size={14} />{username.trim() ? "Invite user" : "Create invite link"}</Button></div>
        {link ? <div className={styles.copyLink}><input readOnly value={link} onFocus={(event) => event.target.select()} /><Button onClick={() => void navigator.clipboard.writeText(link)}><Copy size={14} />Copy</Button></div> : null}
      </> : null}
    </div>
  );
}
function PermissionsPanel({ group, owner, busy, onLocal, onSave }: { group: ConstellationGroup; owner: boolean; busy: boolean; onLocal: (group: ConstellationGroup) => void; onSave: (patch: Partial<ConstellationGroup>) => void }) {
  const patch = (next: Partial<ConstellationGroup>) => onLocal({ ...group, ...next });
  return <div className={styles.panelBody}><SectionTitle title="Member permissions" description="Every rule is also enforced by the server." /><label>Assignment mode<select disabled={!owner || busy} value={group.assignmentMode} onChange={(event) => patch({ assignmentMode: event.target.value as ConstellationGroup["assignmentMode"] })}><option value="owner">Owner assigns slots</option><option value="self">Members select open slots</option></select></label><label>Frame behavior<select disabled={!owner || busy} value={group.frameMode} onChange={(event) => patch({ frameMode: event.target.value as ConstellationGroup["frameMode"] })}><option value="member">Use profile/member choice</option><option value="framed">Force framed</option><option value="frameless">Force frameless</option></select></label><Toggle label="Members may use their own fonts" checked={group.allowMemberFonts} disabled={!owner || busy} onChange={(value) => patch({ allowMemberFonts: value })} /><Toggle label="Members may move their own profile" checked={group.allowMemberMove} disabled={!owner || busy} onChange={(value) => patch({ allowMemberMove: value })} /><Toggle label="Members may resize their own profile" checked={group.allowMemberResize} disabled={!owner || busy} onChange={(value) => patch({ allowMemberResize: value })} />{owner ? <Button variant="accent" disabled={busy} onClick={() => onSave({ assignmentMode: group.assignmentMode, frameMode: group.frameMode, allowMemberFonts: group.allowMemberFonts, allowMemberMove: group.allowMemberMove, allowMemberResize: group.allowMemberResize })}><Save size={14} />Save permissions</Button> : null}</div>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.toggle}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function EditorPreview({ group, me, owner, busy, onSave }: { group: ConstellationGroup; me: ConstellationIdentity; owner: boolean; busy: boolean; onSave: (changes: MemberChange[]) => Promise<boolean> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [moveMode, setMoveMode] = useState(false);
  const [moveViewportSize, setMoveViewportSize] = useState({ width: 0, height: 0 });
  const [drafts, setDrafts] = useState<Record<string, MemberPatch>>({});
  const viewport = useRef<HTMLDivElement>(null);
  const moveViewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrafts({});
    setMoveMode(false);
    setSelected(null);
  }, [group.id]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => setPreviewScale(Math.max(.1, Math.min(1, element.clientWidth / 1440)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = moveViewport.current;
    if (!moveMode || !element) return;
    const fit = () => setMoveViewportSize({ width: element.clientWidth, height: element.clientHeight });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [moveMode]);

  const previewGroup = useMemo(() => ({
    ...group,
    members: group.members.map((member) => ({ ...member, ...drafts[memberKey(member)] })),
  }), [drafts, group]);
  const editable = useMemo(() => new Set(previewGroup.members.filter((member) => owner || (member.userId === me.id && (previewGroup.allowMemberMove || previewGroup.allowMemberResize))).map((member) => member.userId || "")), [me.id, owner, previewGroup]);
  const selectedMember = previewGroup.members.find((member) => member.userId === selected) || null;
  const selectedEditable = Boolean(selected && editable.has(selected));
  const hasDrafts = Object.keys(drafts).length > 0;
  const narrowMoveMode = moveViewportSize.width > 0 && moveViewportSize.width < 700;
  const moveCanvasSize = narrowMoveMode ? { width: 960, height: 1200 } : { width: 1440, height: 900 };
  const moveCanvasScale = Math.max(.1, Math.min(
    1,
    Math.max(1, moveViewportSize.width - (narrowMoveMode ? 16 : 32)) / moveCanvasSize.width,
    Math.max(1, moveViewportSize.height - (narrowMoveMode ? 150 : 88)) / moveCanvasSize.height,
  ));

  useEffect(() => {
    if (!moveMode || (selected && editable.has(selected))) return;
    setSelected(editable.values().next().value || null);
  }, [editable, moveMode, selected]);

  const placement = (member: ConstellationMember, patch: MemberPatch) => {
    if (busy) return;
    const key = memberKey(member);
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };
  const saveDrafts = async () => {
    const changes = group.members.flatMap((member) => {
      const patch = drafts[memberKey(member)];
      return patch ? [{ member, patch }] : [];
    });
    if (changes.length && await onSave(changes)) setDrafts({});
  };
  const openMoveMode = () => {
    if (!selected || !editable.has(selected)) setSelected(editable.values().next().value || null);
    setMoveMode(true);
  };
  const adjustSelectedScale = (delta: number) => {
    if (!selectedMember || !selectedEditable) return;
    placement(selectedMember, { scale: Math.max(.4, Math.min(1.8, (selectedMember.scale || 1) + delta)) });
  };
  const resetSelected = () => {
    if (!selectedMember || !selectedEditable) return;
    const positions = defaultConstellationPositions(group.capacity);
    placement(selectedMember, {
      position: positions[Math.max(0, selectedMember.slot - 1)] || { x: 50, y: 50 },
      scale: defaultConstellationScale(group.capacity),
    });
  };

  return (
    <aside className={styles.preview}>
      <div className={styles.previewHead}>
        <div><Eye size={15} /><span>Full page preview</span></div>
        <div className={styles.previewActions}>
          <span>{hasDrafts ? "Unsaved layout changes" : "Preview only"}</span>
          <Button className={styles.previewSave} variant="ghost" disabled={!editable.size} onClick={openMoveMode}><Move size={13} />Move profiles</Button>
        </div>
      </div>
      <div ref={viewport} className={styles.previewViewport}>
        <div className={styles.previewScale} style={{ transform: "scale(" + previewScale + ")" }}>
          <ConstellationRenderer group={previewGroup} fullPreview className={styles.previewCanvas} />
        </div>
      </div>

      {moveMode ? <div className={styles.moveOverlay}>
        <div className={styles.moveTopbar}>
          <div><Maximize2 size={15} /><span>Move profiles</span><small>Select a profile, then drag it or use the resize controls.</small></div>
          <button type="button" className={styles.moveClose} aria-label="Close move mode" onClick={() => setMoveMode(false)}><X size={17} /></button>
        </div>
        <div ref={moveViewport} className={styles.moveStage}>
          <div className={styles.moveCanvasShell} style={{
            width: moveCanvasSize.width,
            height: moveCanvasSize.height,
            transform: "translate(-50%, -50%) scale(" + moveCanvasScale + ")",
          }}>
            <ConstellationRenderer
              group={previewGroup}
              editor
              fullPreview
              canvasSize={moveCanvasSize}
              selectedId={selected}
              editableMemberIds={editable}
              onSelect={(member) => {
                const id = member.userId || "";
                if (editable.has(id)) setSelected(id);
              }}
              onPlacement={placement}
              className={styles.moveCanvas}
            />
          </div>
          <div className={styles.moveControls}>
            <span className={styles.moveSelection}>{selectedMember ? "@" + selectedMember.username : "Select a profile"}</span>
            <Button variant="ghost" className={styles.moveControlButton} disabled={busy || !selectedEditable} onClick={resetSelected}><RotateCcw size={13} />Reset</Button>
            <Button variant="ghost" className={styles.moveIconButton} aria-label="Zoom selected profile out" disabled={busy || !selectedEditable || (selectedMember?.scale || 1) <= .4} onClick={() => adjustSelectedScale(-.1)}><ZoomOut size={15} /></Button>
            <span className={styles.moveScale}>{Math.round((selectedMember?.scale || 1) * 100)}%</span>
            <Button variant="ghost" className={styles.moveIconButton} aria-label="Zoom selected profile in" disabled={busy || !selectedEditable || (selectedMember?.scale || 1) >= 1.8} onClick={() => adjustSelectedScale(.1)}><ZoomIn size={15} /></Button>
            <Button variant="ghost" className={styles.moveControlButton} disabled={busy || !hasDrafts} onClick={() => void saveDrafts()}><Save size={13} />Save layout</Button>
            <Button variant="accent" className={styles.moveControlButton} onClick={() => setMoveMode(false)}>Exit move mode</Button>
          </div>
        </div>
      </div> : null}
    </aside>
  );
}
function PublishBar({ group, owner, busy, onUnpublish, onDelete }: { group: ConstellationGroup; owner: boolean; busy: boolean; onUnpublish: () => void; onDelete: () => void }) {
  return <section className={styles.publish}><div><strong>{group.published ? "This Constellation is live" : group.canPublish ? "Ready to publish" : `Fill ${group.availableSlots.length} remaining slot${group.availableSlots.length === 1 ? "" : "s"}`}</strong><p>Preview and public pages use the same renderer. Saved profile positions are restored after refresh.</p></div><div>{group.published ? <a href={group.publicPath} target="_blank" rel="noreferrer">View page<ArrowUpRight size={14} /></a> : null}{owner && group.published ? <Button disabled={busy} onClick={onUnpublish}>Unpublish</Button> : null}{owner ? <Button disabled={busy} onClick={onDelete}><Trash2 size={14} />Delete</Button> : null}</div></section>;
}

async function persistMemberChanges(groupId: string, changes: MemberChange[]) {
  let latest: ConstellationMutation = {};
  for (const { member, patch } of changes) {
    latest = await constellationApi.updateMember(groupId, member.userId || "", patch);
  }
  return latest;
}
async function resetLayout(group: ConstellationGroup, apply: (task: () => Promise<ConstellationMutation>, success: string) => Promise<ConstellationMutation | null>) {
  const positions = defaultConstellationPositions(group.capacity);
  await apply(async () => {
    let latest: ConstellationMutation = {};
    for (const member of group.members) latest = await constellationApi.updateMember(group.id, member.userId || "", { position: positions[member.slot - 1], scale: defaultConstellationScale(group.capacity) });
    return latest;
  }, "Layout reset to the responsive preset.");
}
