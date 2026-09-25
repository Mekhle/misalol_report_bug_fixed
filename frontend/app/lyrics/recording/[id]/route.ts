import { NextResponse } from "next/server";
import { recordingLyrics } from "@/lib/lyrics-provider";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) return NextResponse.json({ error: "Invalid recording" }, { status: 400 });
  try {
    const response = await fetch(`https://lrclib.net/api/get/${id}`, { headers: { "User-Agent": "Misa.lol/1.0 (https://misa.lol)", "Lrclib-Client": "Misa.lol (https://misa.lol)" }, signal: AbortSignal.timeout(12000), cache: "no-store" });
    if (response.status === 404) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    if (!response.ok) return NextResponse.json({ error: "Lyrics temporarily unavailable" }, { status: 502 });
    const text = await response.text();
    if (text.length > 1000000) throw new Error("Response too large");
    return NextResponse.json(recordingLyrics(JSON.parse(text)), { headers: { "Cache-Control": response.headers.get("Cache-Control") || "no-store" } });
  } catch {
    return NextResponse.json({ error: "Lyrics temporarily unavailable" }, { status: 502 });
  }
}
