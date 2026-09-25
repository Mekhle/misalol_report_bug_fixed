from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.profile import require_user
from app.core.rate_limit import rate_limit
from app.core.widgets import resolve_profile_widgets
from app.models import User

router = APIRouter(prefix="/widgets", tags=["widgets"])


@router.post("/preview")
async def preview_widgets(payload: dict[str, Any], user: User = Depends(require_user)) -> dict[str, Any]:
    await rate_limit(f"rl:widgets-preview:{user.id}", 30, 60)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid widget payload.")
    return {"widgets": await resolve_profile_widgets(payload, include_empty=True)}
