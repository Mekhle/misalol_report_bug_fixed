import { NextRequest } from "next/server";
import { templatesRoute } from "@/lib/server/templates-routes";

export const runtime = "nodejs";

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const path = (await context.params).path || [];
  return templatesRoute(request, path);
}

export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
