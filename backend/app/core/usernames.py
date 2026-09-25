from fastapi.responses import RedirectResponse

from app.db import admin_db


async def current_handle_for(username: str) -> str | None:
    handle = (username or "").strip().lower()
    if not handle or not admin_db.has_pool():
        return None
    return await admin_db.current_username_for_alias(handle)


def username_redirect(location: str) -> RedirectResponse:
    return RedirectResponse(
        location,
        status_code=301,
        headers={"Cache-Control": "public, max-age=120"},
    )
