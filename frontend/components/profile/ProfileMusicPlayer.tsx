"use client";

import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { audioArtworkUrl, playlistTracks, publicTrackUrls, trackTitle, usesUploadedProfileAudio } from "@/lib/audio";
import { usePreviewPlayer } from "@/lib/preview-player";
import type { ProfileConfig } from "@/lib/types";

type RepeatMode = "off" | "all" | "one";

export function ProfileMusicPlayer({ config, preview = false, autoplay = false }: { config: ProfileConfig; preview?: boolean; autoplay?: boolean }) {
  const tracks = useMemo(() => playlistTracks(config.assets), [config.assets]);
  const trackKey = useMemo(() => tracks.map((item) => item.id).join("|"), [tracks]);
  const { requestedId, requestNonce, pauseNonce, notify } = usePreviewPlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const srcRef = useRef("");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [muted] = useState(false);
  const [repeat] = useState<RepeatMode>("all");
  const [shuffle] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(config.assets.volume);
  const order = useMemo(() => {
    const ids = tracks.map((_, i) => i);
    if (!shuffle) return ids;
    return ids.map((value, i) => [value, (i * 17 + 11) % Math.max(ids.length, 1)] as const).sort((a, b) => a[1] - b[1]).map(([value]) => value);
  }, [tracks, shuffle]);
  const safeIndex = tracks.length ? Math.min(index, tracks.length - 1) : 0;
  const track = tracks[safeIndex];
  const src = track ? (preview ? track.audio.url || "" : publicTrackUrls(config.profile.username, track).audio) : "";
  const artwork = track ? audioArtworkUrl(config.assets, track) || (preview ? "" : publicTrackUrls(config.profile.username, track).artwork) : "";

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { notify(track?.id || null, playing); }, [notify, track?.id, playing]);
  useEffect(() => {
    setIndex((current) => (tracks.length ? Math.min(current, tracks.length - 1) : 0));
  }, [trackKey, tracks.length]);
  useEffect(() => { setLevel(config.assets.volume); }, [config.assets.volume]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => { if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); srcRef.current = ""; } };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = level / 100;
    audio.muted = muted;
  }, [level, muted]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!src) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      srcRef.current = "";
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    if (srcRef.current === src) return;
    setMediaError(false);
    audio.pause();
    audio.currentTime = 0;
    srcRef.current = src;
    audio.src = src;
    audio.preload = "metadata";
    if (playingRef.current || (autoplay && !preview)) {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [src, autoplay, preview]);
  useEffect(() => {
    if (!requestNonce || !requestedId) return;
    const next = tracks.findIndex((item) => item.id === requestedId);
    if (next < 0) return;
    if (next === safeIndex) {
      const audio = audioRef.current;
      if (!audio || !src) return;
      if (srcRef.current !== src) {
        srcRef.current = src;
        audio.src = src;
      }
      playingRef.current = true;
      void audio.play()
        .then(() => setPlaying(true))
        .catch(() => {
          playingRef.current = false;
          setPlaying(false);
        });
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    setIndex(next);
  }, [requestNonce, requestedId, safeIndex, src, tracks]);
  useEffect(() => {
    if (!pauseNonce) return;
    audioRef.current?.pause();
    playingRef.current = false;
    setPlaying(false);
  }, [pauseNonce]);

  const playIndex = (nextIndex: number) => {
    if (!tracks.length) return;
    const next = (nextIndex + tracks.length) % tracks.length;
    playingRef.current = true;
    setPlaying(true);
    if (next === safeIndex) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    setIndex(next);
  };
  const step = (direction: 1 | -1) => {
    if (!tracks.length) return;
    const position = order.indexOf(safeIndex);
    playIndex(order[(position + direction + order.length) % order.length]);
  };
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (!audio.src && src) audio.src = src;
      void audio.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };
  const ended = () => {
    if (repeat === "one") {
      audioRef.current!.currentTime = 0;
      void audioRef.current!.play();
      return;
    }
    const position = order.indexOf(safeIndex);
    if (position === order.length - 1 && repeat === "off") {
      setPlaying(false);
      playingRef.current = false;
      return;
    }
    step(1);
  };
  const keepOnCard = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  if (!usesUploadedProfileAudio(config.assets) || !track) return null;

  const swap = Boolean(config.settings.widgetColorSwap);
  const ink = config.settings.backgroundColor;
  const accent = config.settings.accentColor;
  const sliderAccent = swap ? ink : "#e11d48";

  return (
    <div
      className={`relative z-20 mt-6 rounded-2xl border p-3 text-left ${swap ? "" : "border-white/[.1] bg-black/25"}`}
      style={swap ? { backgroundColor: accent, color: ink, borderColor: `${ink}33` } : undefined}
      onClick={keepOnCard}
      onPointerDown={keepOnCard}
    >
      <audio
        ref={audioRef}
        data-track-info={JSON.stringify({ id: track.id, title: trackTitle(track), artwork, src, recording: track.recording, count: tracks.length })}
        preload="none"
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onPlay={() => { setMediaError(false); setPlaying(true); }}
        onError={() => { playingRef.current = false; setPlaying(false); setMediaError(true); }}
        onPause={() => setPlaying(false)}
        onEnded={ended}
      />
      {mediaError && <p role="status" className="mb-2 text-xs opacity-70">This audio could not be played. Try another track.</p>}
      <div className="profile-player-layout flex min-w-0 flex-wrap items-center gap-3">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-14 sm:w-14  ${swap ? "" : "bg-white/[.06]"}`} style={swap ? { backgroundColor: `${ink}1a` } : undefined}>
          {artwork ? <img src={artwork} alt="" className="h-full w-full object-cover" /> : <Volume2 size={18} className={swap ? "" : "text-white/40"} style={swap ? { color: ink } : undefined} />}
        </div>
        <div className="min-w-0 flex-[1_1_100px]">
          <p className={`truncate text-sm font-medium ${swap ? "" : "text-white"}`}>{trackTitle(track)}</p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <span className={`shrink-0 font-mono text-[10px] ${swap ? "" : "text-white/40"}`} style={swap ? { opacity: 0.6 } : undefined}>{formatTime(currentTime)}</span>
            <input
              aria-label="Seek"
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              value={Math.floor(currentTime)}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (audioRef.current) audioRef.current.currentTime = next;
                setCurrentTime(next);
              }}
              className={`h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full ${swap ? "" : "bg-white/[.12]"}`}
              style={{ accentColor: sliderAccent, backgroundColor: swap ? `${ink}22` : undefined }}
            />
            <span className={`shrink-0 font-mono text-[10px] ${swap ? "" : "text-white/40"}`} style={swap ? { opacity: 0.6 } : undefined}>{formatTime(duration)}</span>
          </div>
        </div>
        <div className={`flex shrink-0 items-center gap-0.5 `}>
          <button type="button" data-player-prev disabled={tracks.length < 2} onClick={() => step(-1)} className={`grid h-8 w-7 place-items-center rounded-lg transition ${swap ? "" : "text-white/45 hover:bg-white/[.08] hover:text-white"}`} style={swap ? { color: ink } : undefined} aria-label="Previous track"><SkipBack size={15} fill="currentColor" /></button>
          <button type="button" onClick={toggle} className={`grid h-9 w-8 place-items-center rounded-lg transition ${swap ? "" : "text-white/80 hover:bg-white/[.08] hover:text-white"}`} style={swap ? { color: ink } : undefined} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button type="button" data-player-next disabled={tracks.length < 2} onClick={() => step(1)} className={`grid h-8 w-7 place-items-center rounded-lg transition ${swap ? "" : "text-white/45 hover:bg-white/[.08] hover:text-white"}`} style={swap ? { color: ink } : undefined} aria-label="Next track"><SkipForward size={15} fill="currentColor" /></button>
        </div>
      </div>
    </div>
  );
}
export function ProfileVideoAudioControl({ config }: { config: ProfileConfig }) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const videoEl = () => scopeRef.current?.closest("[data-profile-layout]")?.querySelector<HTMLVideoElement>("[data-bg-video]") ?? null;
  const [muted, setMuted] = useState(true);
  const [level, setLevel] = useState(config.assets.volume);

  useEffect(() => {
    setLevel(config.assets.volume);
  }, [config.assets.volume]);

  useEffect(() => {
    const video = videoEl();
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, level / 100));
    const sync = () => setMuted(video.muted);
    sync();
    video.addEventListener("volumechange", sync);
    return () => video.removeEventListener("volumechange", sync);
  }, [config.assets.audioEnabled, config.assets.backgroundVideo.url, level]);

  const toggle = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    const video = videoEl();
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, level / 100));
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    if (!nextMuted) {
      void video.play().catch(() => {
        video.muted = true;
        setMuted(true);
      });
    }
    setMuted(video.muted);
  };

  const swap = Boolean(config.settings.widgetColorSwap);
  const ink = config.settings.backgroundColor;
  const accent = config.settings.accentColor;
  const sliderAccent = swap ? ink : "#e11d48";

  return (
    <div
      ref={scopeRef}
      className={`relative z-20 mt-6 rounded-2xl border p-3 text-left ${swap ? "" : "border-white/[.1] bg-black/25"}`}
      style={swap ? { backgroundColor: accent, color: ink, borderColor: `${ink}33` } : undefined}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${swap ? "" : "bg-white/[.06]"}`} style={swap ? { backgroundColor: `${ink}1a` } : undefined}>
          {muted || level === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </div>
        <div className="min-w-0 flex-[1_1_100px]">
          <p className={`truncate text-sm font-medium ${swap ? "" : "text-white"}`}>Background video</p>
          <p className={`mt-0.5 text-[11px] ${swap ? "" : "text-white/40"}`} style={swap ? { opacity: 0.66 } : undefined}>
            {muted ? "Audio off" : "Using video audio"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className={`rounded-lg p-1.5 ${swap ? "" : "text-white/70 hover:bg-white/[.08] hover:text-white"}`}
          style={swap ? { color: ink } : undefined}
          aria-pressed={!muted}
          aria-label={muted ? "Enable background video audio" : "Mute background video audio"}
        >
          {muted || level === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={100}
          value={level}
          onChange={(event) => {
            const next = Number(event.target.value);
            setLevel(next);
            const video = videoEl();
            if (video) {
              video.volume = next / 100;
              if (next > 0 && video.muted) {
                video.muted = false;
                void video.play().catch(() => { video.muted = true; });
              }
              setMuted(video.muted);
            }
          }}
          className={`h-1.5 w-full cursor-pointer appearance-none rounded-full ${swap ? "" : "bg-white/[.12]"}`}
          style={{ accentColor: sliderAccent, backgroundColor: swap ? `${ink}22` : undefined }}
        />
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
