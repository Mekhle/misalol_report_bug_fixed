"use client";

import { ChevronDown, ChevronUp, FolderPen, Image as ImageIcon, Music, Pause, Play, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, TextInput } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { fileTitle, loadPlaylistLimits, newTrackId, playlistTracks, trackTitle } from "@/lib/audio";
import { LyricsRecordingPicker } from "./LyricsRecordingPicker";
import { readAudioTags } from "@/lib/id3";
import { IMAGE_ACCEPT } from "@/lib/image-edit";
import { usePreviewPlayer } from "@/lib/preview-player";
import { uploadProfileAsset } from "@/lib/profile-store";
import type { AudioTrack, ProfileAsset, ProfileConfig } from "@/lib/types";

export function PlaylistEditor({ config, onChange }: { config: ProfileConfig; onChange: (tracks: AudioTrack[]) => void }) {
  const t = useT();
  const tracks = playlistTracks(config.assets);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ maxTracks: 8, maxTrackBytes: 40_000_000, maxArtworkBytes: 15_000_000 });
  const audioInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadPlaylistLimits().then(setLimits); }, []);
  useEffect(() => {
    if (!coverFile) { setCoverPreview(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { if (adding) setAdding(false); else setOpen(false); } };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [open, adding]);

  const resetAdd = () => { setAdding(false); setAudioFile(null); setCoverFile(null); setTitle(""); };
  const addAudio = async () => {
    if (!audioFile || busy) return;
    if (tracks.length >= limits.maxTracks) { window.alert(t("customize.playlistMax", { count: limits.maxTracks })); return; }
    if (audioFile.size > limits.maxTrackBytes) { window.alert(t("customize.playlistFileTooLarge", { name: audioFile.name, mb: Math.round(limits.maxTrackBytes / 1_000_000) })); return; }
    if (coverFile && coverFile.size > limits.maxArtworkBytes) { window.alert(t("customize.artTooLarge", { mb: Math.round(limits.maxArtworkBytes / 1_000_000) })); return; }
    setBusy(true);
    try {
      const [audio, artwork, tags] = await Promise.all([
        uploadProfileAsset("audio", audioFile),
        coverFile ? uploadProfileAsset("audioArtwork", coverFile) : Promise.resolve<ProfileAsset>({ url: null }),
        readAudioTags(audioFile),
      ]);
      onChange([...tracks, { id: newTrackId(), title: title.trim() || tags.title || fileTitle(audioFile.name), audio, artwork: coverFile ? artwork : tags.artwork || artwork }]);
      resetAdd();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The audio could not be uploaded.");
    } finally { setBusy(false); }
  };

  const update = (id: string, patch: Partial<AudioTrack>) => onChange(tracks.map((track) => track.id === id ? { ...track, ...patch } : track));
  const move = (index: number, direction: -1 | 1) => { const next=[...tracks]; const swap=index+direction; if (swap<0 || swap>=next.length) return; [next[index],next[swap]]=[next[swap],next[index]]; onChange(next); };
  const manager = open && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[140] flex h-[100dvh] items-end justify-center bg-black/70 px-3 pt-3 backdrop-blur-sm sm:items-center sm:p-6" style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="audio-manager-title" className="flex w-full max-w-xl flex-col overflow-hidden rounded-[1.75rem] border border-white/[.1] bg-[#101014]/95 shadow-2xl shadow-black/70" style={{ maxHeight: "min(78dvh, 42rem)" }}>
        <div className="mx-auto mt-2 h-1 w-12 shrink-0 rounded-full bg-white/[.12] sm:hidden" />
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5"><h2 id="audio-manager-title" className="text-base font-semibold text-white sm:text-lg">{adding ? "Add an Audio" : "Audio Manager"}</h2><button type="button" onClick={() => adding ? resetAdd() : setOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-zinc-400 transition hover:bg-white/[.09] hover:text-white" aria-label={adding ? "Back to Audio Manager" : "Close Audio Manager"}><X size={20} /></button></header>
        {adding ? <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6">
          <input ref={audioInput} className="hidden" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,.mp3,.wav,.ogg,.m4a,.aac,.webm" onChange={(event) => { const file=event.currentTarget.files?.[0] || null; setAudioFile(file); if (file && !title) setTitle(fileTitle(file.name)); event.currentTarget.value=""; }} />
          <button type="button" onClick={() => audioInput.current?.click()} className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/[.07] bg-black/20 p-5 text-zinc-500 transition hover:border-white/20 hover:text-white"><Music size={36} className="text-white" /><span className="max-w-full truncate text-sm">{audioFile?.name || "Click to upload an audio"}</span></button>
          <input ref={coverInput} className="hidden" type="file" accept={IMAGE_ACCEPT} onChange={(event) => { setCoverFile(event.currentTarget.files?.[0] || null); event.currentTarget.value=""; }} />
          <button type="button" onClick={() => coverInput.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-white/[.07] bg-black/20 p-5 text-zinc-500 transition hover:border-white/20 hover:text-white">{coverPreview ? <img src={coverPreview} alt="Selected audio cover" className="h-20 w-20 rounded-xl object-cover" /> : <ImageIcon size={34} className="text-white" />}<span className="max-w-full truncate text-sm">{coverFile?.name || "Click to upload an audio cover"}</span></button>
          <div><label className="mb-2 block text-sm text-zinc-200">Audio Title</label><TextInput value={title} onChange={setTitle} placeholder="Add a title..." /></div>
          <Button variant="accent" className="h-11 w-full justify-center" disabled={!audioFile || busy} onClick={() => void addAudio()}>{busy ? "Uploading..." : "Add Audio"}</Button>
        </div> : <><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-6">{tracks.length === 0 ? <div className="flex min-h-24 items-center justify-center rounded-2xl border border-white/[.06] bg-black/15 px-4 py-6 text-center"><p className="text-sm text-zinc-400">You have no audios uploaded.</p></div> : <div className="space-y-3">{tracks.map((track,index)=><TrackRow key={track.id} track={track} index={index} total={tracks.length} maxArtworkBytes={limits.maxArtworkBytes} onTitle={(nextTitle)=>update(track.id,{title:nextTitle})} onRecording={(recording) => update(track.id, { recording })} onArtwork={(artwork)=>update(track.id,{artwork})} onMove={move} onRemove={()=>onChange(tracks.filter((item)=>item.id!==track.id))} />)}</div>}</div><footer className="shrink-0 border-t border-white/[.06] px-4 pb-4 pt-3 sm:px-6 sm:pb-5"><Button variant="subtle" className="h-11 w-full justify-center rounded-xl text-sm" onClick={() => setAdding(true)} disabled={tracks.length>=limits.maxTracks}><Music size={16} />Add Audio</Button></footer></>}
      </section>
    </div>, document.body) : null;
  return <><section className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3.5"><div className="mb-2"><p className="text-sm font-medium text-zinc-200">Audio</p><p className="mt-1 text-xs text-zinc-600">{tracks.length ? `${tracks.length} audio file${tracks.length===1?"":"s"}` : "Manage uploaded audio and artwork"}</p></div><button type="button" onClick={()=>setOpen(true)} className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/[.06] bg-black/15 px-4 py-5 text-zinc-500 transition hover:border-white/[.12] hover:bg-white/[.025] hover:text-zinc-300" aria-haspopup="dialog"><FolderPen size={34}/><span className="text-sm">Click to open audio manager</span></button></section>{manager}</>;
}

function TrackRow({ track, index, total, maxArtworkBytes, onRecording, onTitle, onArtwork, onMove, onRemove }: { track: AudioTrack; index: number; total: number; maxArtworkBytes: number; onRecording: (recording: AudioTrack["recording"]) => void; onTitle: (title: string) => void; onArtwork: (artwork: ProfileAsset) => void; onMove: (index: number, direction: -1 | 1) => void; onRemove: () => void }) {
  const t = useT();
  const artInput = useRef<HTMLInputElement>(null);
  const player = usePreviewPlayer();
  const playing = player.activeId === track.id && player.playing;
  const uploadArt = async (file: File) => {
    if (file.size > maxArtworkBytes) { window.alert(t("customize.artTooLarge", { mb: Math.round(maxArtworkBytes / 1_000_000) })); return; }
    onArtwork(await uploadProfileAsset("audioArtwork", file));
  };
  return <div className="rounded-xl border border-white/[.06] bg-black/15 p-3">
    <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
      <div className="flex shrink-0 flex-col gap-1 pt-1"><button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} className="rounded-md p-1 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30" aria-label="Move up"><ChevronUp size={14} /></button><button type="button" onClick={() => onMove(index, 1)} disabled={index === total - 1} className="rounded-md p-1 text-zinc-500 hover:bg-white/[.06] hover:text-white disabled:opacity-30" aria-label="Move down"><ChevronDown size={14} /></button></div>
      <button type="button" onClick={() => artInput.current?.click()} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] sm:h-14 sm:w-14" aria-label="Upload cover artwork">{track.artwork?.url ? <img src={track.artwork.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={16} className="text-zinc-500" />}</button>
      <div className="min-w-0 flex-1 space-y-2"><TextInput value={track.title} onChange={onTitle} placeholder={trackTitle(track)} /><p className="truncate text-[11px] text-zinc-600">{track.audio.name || t("customize.audioFile")} · {t("customize.playsOnPreview")}</p></div>
      <div className="flex shrink-0 flex-col gap-1"><button type="button" onClick={() => playing ? player.requestPause() : player.requestPlay(track.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/[.06] hover:text-white" aria-label={playing ? "Pause preview card" : "Play on preview card"}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" onClick={onRemove} className="rounded-lg p-2 text-zinc-600 hover:bg-white/[.06] hover:text-red-300" aria-label="Remove track"><Trash2 size={14} /></button></div>
    </div>
    <LyricsRecordingPicker track={track} onChange={onRecording} />
    <input ref={artInput} className="hidden" type="file" accept={IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadArt(file); event.target.value = ""; }} />
  </div>;
}