from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from app.core.analytics import ingest_event, summary_for_user
from app.core.rate_limit import client_ip, rate_limit
from app.core.sessions import get_user_from_request
from app.models import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


@router.post("/event")
async def track_event(payload: dict[str, Any], request: Request) -> Response:
    try:
        await rate_limit(f"rl:analytics:{client_ip(request)}", 40, 60)
    except HTTPException:
        return Response(status_code=204)
    except (RuntimeError, OSError):
        pass
    if isinstance(payload, dict):
        try:
            await ingest_event(request, payload)
        except (RuntimeError, OSError, ValueError):
            pass
    return Response(status_code=204)


@router.get("/me")
async def my_analytics(
    range: Annotated[str, Query(min_length=2, max_length=4)] = "7D",
    user: User = Depends(require_user),
) -> dict[str, Any]:
    return await summary_for_user(user.id, range)
