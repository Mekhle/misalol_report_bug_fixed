import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { nativeCoreEnabled } from "@/lib/server/rollout";
import { one } from "@/lib/server/postgres";
import { uploadToR2 } from "@/lib/server/r2";
import { currentUser } from "@/lib/server/sessions";

export const runtime = "nodejs";

const limits: Record<string, number> = {
  avatar: 25_000_000, background: 40_000_000, banner: 25_000_000, ogImage: 25_000_000, favicon: 5_000_000,
  cursor: 5_000_000, backgroundVideo: 110_000_000, backgroundEffectVideo: 110_000_000, audio: 40_000_000,
  audioArtwork: 15_000_000, clickSound: 400_000, customFont: 2_000_000, cover: 3_000_000, socialIcon: 512_000, entryIcon: 5_000_000,
};
const premiumKinds = new Set(["customFont", "clickSound", "entryIcon", "ogImage", "favicon"]);
const extensionTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };

function nameFor(value: string) {
  const name = value.split(/[\\/]/).pop()?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "upload";
  return name.slice(0, 100);
}

function mediaAllowed(kind: string, type: string) {
  if (["avatar", "background", "banner", "ogImage", "favicon", "audioArtwork", "cover", "socialIcon", "cursor", "entryIcon"].includes(kind)) return ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"].includes(type);
  if (["backgroundVideo", "backgroundEffectVideo"].includes(kind)) return ["video/mp4", "video/webm", "video/quicktime"].includes(type);
  if (["audio", "clickSound"].includes(kind)) return type.startsWith("audio/");
  return kind === "customFont" && (type.startsWith("font/") || ["application/font-woff", "application/font-woff2", "application/octet-stream"].includes(type));
}

function looksValid(kind: string, body: Uint8Array) {
  if (!body.length) return false;
  if (kind === "customFont") return ["wOFF", "wOF2", "OTTO"].some((signature) => Buffer.from(body.subarray(0, 4)).toString("ascii") === signature) || Buffer.from(body.subarray(0, 4)).equals(Buffer.from([0, 1, 0, 0]));
  if (kind === "clickSound") return Buffer.from(body.subarray(0, 3)).toString("ascii") === "ID3" || Buffer.from(body.subarray(0, 4)).toString("ascii") === "OggS" || Buffer.from(body.subarray(0, 4)).toString("ascii") === "fLaC" || (Buffer.from(body.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(body.subarray(8, 12)).toString("ascii") === "WAVE") || Buffer.from(body.subarray(4, 8)).toString("ascii") === "ftyp" || (body.length > 1 && body[0] === 0xff && (body[1] & 0xe0) === 0xe0);
  return true;
}

export async function POST(request: NextRequest) {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  try {
    const user = await currentUser(request);
    if (!user) return apiError("Not authenticated.", 401);
    const form = await request.formData();
    const kind = String(form.get("kind") || "");
    const premium = premiumKinds.has(kind);
    const file = form.get("file");
    if (!limits[kind] || !(file instanceof File)) return apiError("Unsupported asset type.");
    if (premium) {
      const entitlement = await one<{ active: boolean }>("SELECT EXISTS(SELECT 1 FROM premium_entitlements WHERE user_id = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())) AS active", [user.id]);
      if (!entitlement?.active) return apiError("Premium is required for this upload.", 403);
    }
    const name = nameFor(file.name);
    const extension = name.split(".").pop()?.toLowerCase() || "";
    const contentType = (file.type && file.type !== "application/octet-stream" ? file.type : extensionTypes[extension] || "application/octet-stream").toLowerCase();
    if (!mediaAllowed(kind, contentType)) return apiError("That file type is not supported for this asset.");
    if (file.size > limits[kind]) return apiError("That file is too large.", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    if (!looksValid(kind, body)) return apiError("The file is not a valid upload.");
    const key = `profiles/${user.id}/${kind}/${randomUUID().replaceAll("-", "")}-${name}`;
    const url = await uploadToR2(key, body, contentType);
    return NextResponse.json({ asset: { url, name, type: contentType, key } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("R2 object storage is temporarily unavailable.", 502);
  }
}
