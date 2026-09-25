import type { ProfileAsset } from "./types";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const FAVICON_ACCEPT = `${IMAGE_ACCEPT},image/x-icon,image/vnd.microsoft.icon,.ico`;
const CROP_PROXY_HOSTS = new Set(
  (process.env.NEXT_PUBLIC_MEDIA_HOSTS || "r2.misa.lol")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

export function cropImageSource(src: string) {
  return src;
}

export function isAnimatedAsset(asset: Pick<ProfileAsset, "url" | "type" | "name"> | null | undefined) {
  if (!asset) return false;
  const type = (asset.type || "").toLowerCase();
  const name = (asset.name || "").toLowerCase();
  const url = asset.url || "";
  return type === "image/gif" || name.endsWith(".gif") || url.startsWith("data:image/gif");
}

export function canCropAsset(asset: Pick<ProfileAsset, "url" | "type" | "name"> | null | undefined) {
  return Boolean(asset?.url) && !isAnimatedAsset(asset);
}

export async function prepareCursorAsset(asset: ProfileAsset): Promise<ProfileAsset> {
  if (!asset.url) return asset;
  try {
    const image = await loadImage(asset.url);
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return asset;
    context.clearRect(0, 0, 32, 32);
    context.drawImage(image, 0, 0, 32, 32);
    return { ...asset, url: canvas.toDataURL("image/png"), type: "image/png" };
  } catch {
    return asset;
  }
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src) && !src.startsWith("data:")) {
      try {
        const parsed = new URL(src, typeof window !== "undefined" ? window.location.href : "http://localhost");
        if (typeof window !== "undefined" && parsed.origin !== window.location.origin) {
          image.crossOrigin = "anonymous";
        }
      } catch {
        image.crossOrigin = "anonymous";
      }
    }
    image.onload = () => resolve(image);
    image.onerror = () => {
      const retry = new Image();
      retry.onload = () => resolve(retry);
      retry.onerror = () => reject(new Error("Could not load that image."));
      retry.src = src;
    };
    image.src = src;
  });
}

export function coverScale(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number, rotation: number) {
  const swapped = rotation % 180 !== 0;
  const width = swapped ? imageHeight : imageWidth;
  const height = swapped ? imageWidth : imageHeight;
  if (!width || !height || !boxWidth || !boxHeight) return 1;
  return Math.max(boxWidth / width, boxHeight / height);
}

export async function exportCroppedImage({
  src,
  boxWidth,
  boxHeight,
  outputWidth,
  outputHeight,
  zoom,
  rotation,
  offsetX,
  offsetY,
  mime = "image/jpeg",
  quality = 0.9,
}: {
  src: string;
  boxWidth: number;
  boxHeight: number;
  outputWidth: number;
  outputHeight: number;
  zoom: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  mime?: string;
  quality?: number;
}) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not crop that image.");
  const scale = outputWidth / boxWidth;
  const fitted = coverScale(image.naturalWidth, image.naturalHeight, boxWidth, boxHeight, rotation) * zoom;
  if (mime === "image/png") {
    context.clearRect(0, 0, outputWidth, outputHeight);
  } else {
    context.fillStyle = "#08080d";
    context.fillRect(0, 0, outputWidth, outputHeight);
  }
  context.translate(outputWidth / 2 + offsetX * scale, outputHeight / 2 + offsetY * scale);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(fitted * scale, fitted * scale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL(mime, quality);
}
