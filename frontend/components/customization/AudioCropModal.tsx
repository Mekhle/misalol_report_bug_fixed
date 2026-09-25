 "use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal, RangeControl } from "@/components/ui";

type CropVideo = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };

export function AudioCropModal({ open, src, onCancel, onApply }: { open: boolean; src: string; onCancel: () => void; onApply: (url: string, mime: string) => void }) {
  const videoRef = useRef<CropVideo>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const stopRecording = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    videoRef.current?.pause();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  };

  const cancel = () => {
    cancelledRef.current = true;
    stopRecording();
    setBusy(false);
    onCancel();
  };

  useEffect(() => {
    cancelledRef.current = !open;
    if (!open) stopRecording();
    if (open) {
      setDuration(0);
      setStart(0);
      setEnd(0);
      setError("");
    }
    return () => {
      cancelledRef.current = true;
      stopRecording();
    };
  }, [open, src]);

  const onLoaded = () => {
    const value = videoRef.current?.duration || 0;
    setDuration(value);
    setEnd(value);
  };

  const format = (value: number) => {
    const total = Math.max(0, Math.round(value));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  };

  const apply = async () => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const stream = video.captureStream?.() || video.mozCaptureStream?.();
    const audioTracks = stream?.getAudioTracks() || [];
    if (!stream || audioTracks.length === 0) {
      setError("This video does not contain an audio track.");
      return;
    }
    const supported = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!supported) {
      setError("This browser cannot create a cropped audio file.");
      return;
    }
    setBusy(true);
    setError("");
    cancelledRef.current = false;
    const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: supported });
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const result = new Promise<void>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Audio recording failed."));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: supported });
        const reader = new FileReader();
        reader.onload = () => {
          if (!cancelledRef.current) onApply(String(reader.result || ""), supported);
          resolve();
        };
        reader.onerror = () => reject(new Error("Could not prepare the cropped audio."));
        reader.readAsDataURL(blob);
      };
    });
    try {
      video.currentTime = start;
      await video.play();
      recorder.start(100);
      const stopAt = Math.max(0.25, end - start);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
      }, stopAt * 1000);
      await result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not crop the audio.");
    } finally {
      recorderRef.current = null;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Crop audio from video" description="Choose a section of your uploaded video to use as profile audio." onClose={cancel} size="lg">
      <video ref={videoRef} src={src} controls playsInline onLoadedMetadata={onLoaded} className="w-full rounded-xl border border-white/[.08] bg-black" />
      <div className="mt-5 space-y-4">
        <RangeControl label={"Start " + format(start)} value={Math.round(start * 100)} min={0} max={Math.max(1, Math.round(duration * 100))} suffix="" onChange={(value) => setStart(Math.min(value / 100, Math.max(0, end - .25)))} />
        <RangeControl label={"End " + format(end)} value={Math.round(end * 100)} min={Math.max(1, Math.round(start * 100) + 25)} max={Math.max(1, Math.round(duration * 100))} suffix="" onChange={(value) => setEnd(Math.max(start + .25, value / 100))} />
        <p className="text-xs text-zinc-500">Selected length: {format(Math.max(0, end - start))}</p>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={cancel}>Cancel</Button>
          <Button variant="accent" className="flex-1" disabled={busy || !duration} onClick={() => void apply()}>{busy ? "Preparing..." : "Use this audio"}</Button>
        </div>
      </div>
    </Modal>
  );
}
