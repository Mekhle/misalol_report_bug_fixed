from typing import Any

import httpx

from app.core.config import Settings


async def send_transactional_email(settings: Settings, *, to: str, subject: str, text: str, html: str | None = None) -> None:
    """Use the configured production email provider; never print OTPs or fall back to fake SMTP."""
    if not settings.email_api_url or not settings.email_api_key:
        raise RuntimeError("Transactional email provider is not configured.")
    payload: dict[str, Any] = {"from": settings.email_from, "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    headers = {"Authorization": f"Bearer {settings.email_api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(settings.email_api_url, headers=headers, json=payload)
        response.raise_for_status()
