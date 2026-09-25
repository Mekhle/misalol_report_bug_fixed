import { handleConfigJs } from "@/lib/server/config-js";

export const runtime = "nodejs";

export async function GET() {
  return handleConfigJs();
}
