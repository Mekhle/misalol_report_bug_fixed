import logging

import httpx

from app.core.config import Settings, get_settings

log = logging.getLogger("misa.mailer")


def _from_address(settings: Settings) -> str:
    return (settings.email_from or "Misa.lol <no-reply@misa.lol>").strip().strip('"')


def mailer_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.email_api_key and settings.email_api_url)


def _wrap(title: str, body: str, action_label: str, action_url: str) -> tuple[str, str]:
    text = f"{title}\n\n{body}\n\n{action_label}: {action_url}\n\nIf you did not ask for this, you can ignore this email."
    html = (
        "<!DOCTYPE html><html><body style=\"margin:0;background:#0b0b10;color:#e8e6f0;"
        "font-family:Inter,Arial,sans-serif;\">"
        "<div style=\"max-width:520px;margin:32px auto;padding:28px 24px;border:1px solid #ffffff14;"
        "border-radius:16px;background:#12121a;\">"
        "<p style=\"margin:0 0 8px;letter-spacing:.16em;font-size:11px;color:#a899ff;\">MISA.LOL</p>"
        f"<h1 style=\"margin:0 0 16px;font-size:22px;\">{title}</h1>"
        f"<p style=\"margin:0 0 22px;line-height:1.6;color:#b9b6c7;\">{body}</p>"
        f"<p><a href=\"{action_url}\" style=\"display:inline-block;padding:12px 18px;border-radius:10px;"
        f"background:#9b87f5;color:#fff;text-decoration:none;font-weight:600;\">{action_label}</a></p>"
        "<p style=\"margin:22px 0 0;font-size:12px;color:#7c7a89;\">If you did not ask for this, ignore this email.</p>"
        "</div></body></html>"
    )
    return html, text


async def send_email(to: str, subject: str, html: str, text: str, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if not mailer_configured(settings):
        log.warning("email not sent; mailer is not configured")
        return False
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                settings.email_api_url,
                headers={
                    "Authorization": f"Bearer {settings.email_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": _from_address(settings),
                    "to": [to],
                    "subject": subject,
                    "html": html,
                    "text": text,
                },
            )
    except httpx.HTTPError:
        log.warning("email provider request failed")
        return False
    if response.status_code >= 400:
        log.warning("email provider rejected send (%s)", response.status_code)
        return False
    return True


async def send_email_change(to: str, confirm_url: str, settings: Settings | None = None) -> bool:
    html, text = _wrap(
        "Confirm your new email",
        "Use this link to finish changing the email on your Misa.lol account. It expires in 24 hours.",
        "Confirm email",
        confirm_url,
    )
    return await send_email(to, "Confirm your new Misa.lol email", html, text, settings)


async def send_email_change_notice(to: str, settings_url: str, settings: Settings | None = None) -> bool:
    html, text = _wrap(
        "Your email is being changed",
        "Someone requested a new email on this Misa.lol account. If that was not you, change your password and review active sessions.",
        "Open settings",
        settings_url,
    )
    return await send_email(to, "Your Misa.lol email is being changed", html, text, settings)


async def send_password_reset(to: str, reset_url: str, settings: Settings | None = None) -> bool:
    html, text = _wrap(
        "Reset your password",
        "Use this link to choose a new password. It expires in 30 minutes and can be used once.",
        "Choose a new password",
        reset_url,
    )
    return await send_email(to, "Reset your Misa.lol password", html, text, settings)
