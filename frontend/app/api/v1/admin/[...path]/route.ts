import { NextRequest } from "next/server";
import { adminRoute } from "@/lib/server/admin-routes";
export const runtime="nodejs";
type Context={params:Promise<{path:string[]}>};
export async function GET(request:NextRequest,context:Context){return adminRoute(request,(await context.params).path);}
export const POST=GET;export const PUT=GET;export const PATCH=GET;export const DELETE=GET;
