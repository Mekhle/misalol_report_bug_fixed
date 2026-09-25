"use client";

import { RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { coverScale, cropImageSource, exportCroppedImage } from "@/lib/image-edit";
import { Button, Modal, RangeControl } from "@/components/ui";

export function ImageCropModal({
  open,
  title,
  src,
  aspect = 1,
  outputWidth,
  outputHeight,
  mime = "image/jpeg",
  onCancel,
  onApply,
}: {
  open: boolean;
  title: string;
  src: string;
  aspect?: number;
  outputWidth: number;
  outputHeight: number;
  mime?: string;
  onCancel: () => void;
  onApply: (url: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ w: 320, h: 320 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imageSrc = cropImageSource(src);

  useEffect(() => {
    if (!open || !imageSrc) return;
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setNatural({ w: 0, h: 0 });
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) {
        setNatural({ w: image.naturalWidth, h: image.naturalHeight });
      }
    };
    image.src = imageSrc;
  }, [open, imageSrc]);

  useEffect(() => {
    if (!open || !frame.current) return;
    const el = frame.current;
    const updateBox = () => {
      const w = el.clientWidth || 320;
      setBox({ w, h: w / aspect });
    };
    updateBox();
    const observer = new ResizeObserver(updateBox);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, aspect, src]);

  const baseScale = natural.w > 0 && natural.h > 0 && box.w > 0 && box.h > 0
    ? coverScale(natural.w, natural.h, box.w, box.h, rotation)
    : 1;
  const renderWidth = natural.w > 0 ? natural.w * baseScale : box.w;
  const renderHeight = natural.h > 0 ? natural.h * baseScale : box.h;

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + (event.clientX - drag.current.x),
      y: drag.current.oy + (event.clientY - drag.current.y),
    });
  };
  const endDrag = () => { drag.current = null; };

  const apply = async () => {
    setBusy(true);
    try {
      const url = await exportCroppedImage({
        src: imageSrc,
        boxWidth: box.w,
        boxHeight: box.h,
        outputWidth,
        outputHeight,
        zoom,
        rotation,
        offsetX: offset.x,
        offsetY: offset.y,
        mime,
      });
      onApply(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not crop that image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={title} description="Drag to reposition. This crop becomes the image on your profile." onClose={onCancel} size="lg">
      <div
        ref={frame}
        className="relative mx-auto flex items-center justify-center overflow-hidden rounded-2xl border border-white/[.1] bg-black"
        style={{ width: "min(100%, 320px)", aspectRatio: `${aspect}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            style={{
              width: `${renderWidth}px`,
              height: `${renderHeight}px`,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`,
            }}
          />
        ) : (
          <p className="text-xs text-zinc-500">No image available to crop</p>
        )}
      </div>
      <div className="mt-5 space-y-4">
        <RangeControl label="Zoom" value={Math.round(zoom * 100)} min={100} max={300} suffix="%" onChange={(value) => setZoom(value / 100)} />
        <div className="flex gap-2">
          <Button variant="subtle" className="flex-1" onClick={() => { setRotation((current) => (current - 90 + 360) % 360); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={15} />Rotate left</Button>
          <Button variant="subtle" className="flex-1" onClick={() => { setRotation((current) => (current + 90) % 360); setOffset({ x: 0, y: 0 }); }}><RotateCw size={15} />Rotate right</Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button variant="accent" className="flex-1" disabled={busy} onClick={() => void apply()}>{busy ? "Applying…" : "Use this crop"}</Button>
        </div>
      </div>
    </Modal>
  );
}
