import { NextRequest } from "next/server";
import { disconnectProvider } from "@/lib/server/oauth-disconnect";
export const runtime="nodejs";
export function POST(request:NextRequest){return disconnectProvider(request,"google");}
