from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.community import METRICS, RANGES, SORTS, leaderboard
from app.core.rate_limit import client_ip, rate_limit
from app.core.sessions import get_user_from_request

router = APIRouter(prefix="/community", tags=["community"])


@router.get("/leaderboard")
async def public_leaderboard(
    request: Request,
    range: Annotated[str, Query(min_length=2, max_length=8)] = "7D",
    metric: Annotated[str, Query(min_length=5, max_length=6)] = "views",
    sort: Annotated[str, Query(min_length=7, max_length=7)] = "popular",
) -> dict[str, Any]:
    try:
        await rate_limit(f"rl:leaderboard:{client_ip(request)}", 30, 60)
    except HTTPException:
        raise
    except (RuntimeError, OSError):
        pass
    window = range.upper() if range.upper() in RANGES else "7D"
    kind = metric if metric in METRICS else "views"
    ordering = sort if sort in SORTS else "popular"
    user = await get_user_from_request(request)
    return await leaderboard(window, kind, ordering, user.id if user else None)
