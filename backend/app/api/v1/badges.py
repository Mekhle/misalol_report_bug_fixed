import re
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.core.profile_sanitize import decode_data_url
from app.core.sessions import get_user_from_request
from app.db import achievements, admin_db
from app.models import User

router = APIRouter(prefix="/badges", tags=["badges"])
BADGE_ID = re.compile(r"^[a-z0-9-]{2,64}$")


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


class FeaturedBadgesRequest(BaseModel):
    badge_ids: list[str] = Field(default_factory=list, max_length=5)


@router.get("/me")
async def my_badges(user: User = Depends(require_user)) -> dict:
    try:
        return await achievements.collection_for_user(user.id)
    except LookupError:
        raise HTTPException(status_code=404, detail="User not found.") from None


@router.put("/me/featured")
async def update_featured(payload: FeaturedBadgesRequest, user: User = Depends(require_user)) -> dict:
    if any(not BADGE_ID.fullmatch(item) for item in payload.badge_ids):
        raise HTTPException(status_code=400, detail="Invalid badge selection.")
    try:
        selected = await achievements.set_featured(user.id, payload.badge_ids)
    except ValueError as exc:
        detail = "You can feature at most five badges." if str(exc) == "featured_limit" else "Only owned badges can be featured."
        raise HTTPException(status_code=400, detail=detail) from None
    return {"ok": True, "badgeIds": selected}


@router.get("/{badge_id}/icon")
async def badge_icon(badge_id: str) -> Response:
    if not BADGE_ID.fullmatch(badge_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badge not found.")
    row = await admin_db.database_pool().fetchrow("SELECT preview_url,asset_url,icon FROM badges WHERE id=$1 AND active=TRUE", badge_id)
    if row:
        remote = str(row["preview_url"] or row["asset_url"] or "")
        parsed = urlparse(remote)
        if parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password:
            return RedirectResponse(remote, status_code=302, headers={"Cache-Control": "public, max-age=3600"})
        decoded = decode_data_url(str(row["icon"] or ""))
        if decoded:
            body, mime = decoded
            return Response(content=body, media_type=mime, headers={"Cache-Control": "public, max-age=3600"})
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badge icon not found.")