import type { ProfileAsset } from "./types";

export async function readAudioTags(file: File): Promise<{ title: string; artwork: ProfileAsset | null }> {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (String.fromCharCode(...header.slice(0, 3)) !== "ID3") {
    return { title: "", artwork: null };
  }
  const size = synchsafe(header, 6);
  const tag = new Uint8Array(await file.slice(0, Math.min(file.size, 10 + size)).arrayBuffer());
  const version = tag[3];
  let offset = 10;
  if (tag[5] & 0x40) offset += (version === 4 ? synchsafe(tag, 10) : view32(tag, 10)) + 4;
  let title = "";
  let artwork: ProfileAsset | null = null;
  while (offset + 10 < tag.length) {
    const id = String.fromCharCode(tag[offset], tag[offset + 1], tag[offset + 2], tag[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = version === 4 ? synchsafe(tag, offset + 4) : view32(tag, offset + 4);
    const start = offset + 10;
    const end = Math.min(tag.length, start + frameSize);
    if (frameSize <= 0) break;
    if (id === "TIT2" && !title) title = decodeTextFrame(tag.subarray(start, end));
    if (id === "APIC" && !artwork) artwork = decodeApic(tag.subarray(start, end));
    offset = end;
  }
  return { title: title.slice(0, 80), artwork };
}

function synchsafe(bytes: Uint8Array, index: number) {
  return ((bytes[index] & 0x7f) << 21) | ((bytes[index + 1] & 0x7f) << 14) | ((bytes[index + 2] & 0x7f) << 7) | (bytes[index + 3] & 0x7f);
}

function view32(bytes: Uint8Array, index: number) {
  return ((bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]) >>> 0;
}

function decodeTextFrame(bytes: Uint8Array) {
  if (!bytes.length) return "";
  const encoding = bytes[0];
  const data = bytes.subarray(1);
  try {
    if (encoding === 1) return new TextDecoder("utf-16").decode(data).replace(/\0/g, "").trim();
    if (encoding === 2) return new TextDecoder("utf-16be").decode(data).replace(/\0/g, "").trim();
    if (encoding === 3) return new TextDecoder("utf-8").decode(data).replace(/\0/g, "").trim();
    return new TextDecoder("latin1").decode(data).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

function decodeApic(bytes: Uint8Array): ProfileAsset | null {
  if (bytes.length < 16) return null;
  const encoding = bytes[0];
  let index = 1;
  while (index < bytes.length && bytes[index] !== 0) index += 1;
  const mime = new TextDecoder("latin1").decode(bytes.subarray(1, index)) || "image/jpeg";
  index += 2;
  if (encoding === 1 || encoding === 2) {
    while (index + 1 < bytes.length && (bytes[index] !== 0 || bytes[index + 1] !== 0)) index += 2;
    index += 2;
  } else {
    while (index < bytes.length && bytes[index] !== 0) index += 1;
    index += 1;
  }
  const image = bytes.subarray(Math.min(index, bytes.length));
  if (image.length < 24) return null;
  let binary = "";
  image.forEach((value) => { binary += String.fromCharCode(value); });
  const type = mime.startsWith("image/") ? mime : "image/jpeg";
  return { url: `data:${type};base64,${btoa(binary)}`, name: "embedded-artwork", type };
}
