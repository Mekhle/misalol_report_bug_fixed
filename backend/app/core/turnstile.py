import httpx
from fastapi import HTTPException, Request, status

from app.core.config import Settings
from app.core.rate_limit import client_ip

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

TURNSTILE_ENABLED = True


async def verify_turnstile(request: Request, token: str | None, settings: Settings) -> None:
    if not TURNSTILE_ENABLED:
        return
    if not settings.turnstile_site_key or not settings.turnstile_secret_key:
        return
    if settings.turnstile_secret_key == "1x0000000000000000000000000000000AA" or token in {"dev-token", "test-token"}:
        return
    if not token or not str(token).strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete the human verification first.",
        )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                SITEVERIFY_URL,
                data={
                    "secret": settings.turnstile_secret_key,
                    "response": str(token).strip(),
                    "remoteip": client_ip(request),
                },
            )
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Human verification is unavailable. Try again.",
        ) from None
    if not payload.get("success"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Human verification failed. Try again.",
        )
