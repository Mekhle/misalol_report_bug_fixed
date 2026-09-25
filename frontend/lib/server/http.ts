import { NextResponse } from "next/server";

export function apiError(detail: string, status = 400) {
  return NextResponse.json({ detail }, { status, headers: { "Cache-Control": "no-store" } });
}
