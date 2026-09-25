import "server-only";

import { NextResponse } from "next/server";

export function handleConfigJs(): NextResponse {
  const siteKey = process.env.MISA_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || "";
  const secretKey = process.env.MISA_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || "";
  const enabled = Boolean(siteKey && secretKey);

  const payload = JSON.stringify({
    turnstileEnabled: enabled,
    turnstileSiteKey: enabled ? siteKey : "",
  });

  const body = `window.MISA_CONFIG = ${payload};\nwindow.MISA_TURNSTILE_SITE_KEY = window.MISA_CONFIG.turnstileSiteKey;\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
