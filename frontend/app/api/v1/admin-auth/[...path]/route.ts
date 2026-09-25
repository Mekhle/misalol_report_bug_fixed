import { NextRequest } from "next/server";
import { adminAuthRoute } from "@/lib/server/admin-auth-routes";
export const runtime="nodejs";
type Context={params:Promise<{path:string[]}>};
export async function GET(request:NextRequest,context:Context){return adminAuthRoute(request,(await context.params).path);}
export const POST=GET;
export const DELETE=GET;
