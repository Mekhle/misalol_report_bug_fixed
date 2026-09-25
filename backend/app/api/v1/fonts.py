from typing import Any

from fastapi import APIRouter

from app.db import admin_db

router = APIRouter(prefix="/fonts", tags=["fonts"])


@router.get("/defaults")
async def default_fonts() -> dict[str, list[dict[str, Any]]]:
    fonts: list[dict[str, Any]] = [
        {"id": "Inter", "slot": 1, "name": "Inter", "url": None, "mimeType": ""},
    ]
    if admin_db.has_pool():
        fonts.extend(await admin_db.list_default_fonts())
    return {"fonts": fonts}
