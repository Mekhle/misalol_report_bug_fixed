import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { database } from "@/lib/server/postgres";
import { nativeCoreEnabled } from "@/lib/server/rollout";

export const runtime = "nodejs";

type Font = { slot: number; name: string; data_url: string; mime_type: string; updated_at: string | null };

export async function GET() {
  if (!nativeCoreEnabled()) return apiError("Not found.", 404);
  const fonts: Array<{ id: string; slot: number; name: string; url: string | null; mimeType: string; updatedAt?: string | null }> = [{ id: "Inter", slot: 1, name: "Inter", url: null, mimeType: "" }];
  try {
    const result = await database().query<Font>("SELECT slot, name, data_url, mime_type, updated_at FROM default_profile_fonts ORDER BY slot");
    fonts.push(...result.rows.map((font) => ({ id: `font-${font.slot}`, slot: Number(font.slot), name: font.name || "", url: font.data_url || "", mimeType: font.mime_type || "", updatedAt: font.updated_at })));
  } catch {
    // The legacy endpoint still returns Inter if optional admin font storage is unavailable.
  }
  return NextResponse.json({ fonts }, { headers: { "Cache-Control": "no-store" } });
}

