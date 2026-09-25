import json
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import admin_db
from app.db.dragonfly import get_dragonfly

RANGES = {"7D": 7, "30D": 30, "ALL": None}
METRICS = {"views"}
SORTS = {"popular"}
LIMIT = 50
CACHE_TTL = 45


def _public_row(rank: int, row: dict[str, Any]) -> dict[str, Any]:
    username = str(row.get("username") or "")
    return {
        "rank": rank,
        "username": username,
        "displayName": str(row.get("display_name") or row.get("displayName") or username),
        "views": int(row.get("views") or 0),
        "clicks": int(row.get("clicks") or 0),
        "avatar": f"/api/v1/profile/{username}/assets/avatar" if username else "",
    }


async def leaderboard(range_key: str, metric: str = "views", sort_key: str = "popular", viewer_id: str | None = None) -> dict[str, Any]:
    window = range_key.upper() if range_key.upper() in RANGES else "7D"
    kind = "views"
    days = RANGES[window]
    start = None if days is None else datetime.now(timezone.utc) - timedelta(days=days)
    rows = await _cached_rows(window, kind, start)
    entries = [_public_row(index + 1, row) for index, row in enumerate(rows)]
    you = None
    if viewer_id:
        index = next((i for i, row in enumerate(rows) if str(row.get("user_id")) == viewer_id), None)
        if index is not None:
            you = entries[index]
        else:
            score = await admin_db.leaderboard_score(viewer_id, kind, start)
            if score:
                you = {
                    "rank": score.get("rank"),
                    "username": score["username"],
                    "displayName": score["displayName"],
                    "views": score["views"],
                    "clicks": score["clicks"],
                    "avatar": f"/api/v1/profile/{score['username']}/assets/avatar",
                }
    return {"range": window, "metric": kind, "sort": "popular", "entries": entries, "you": you}


async def _cached_rows(window: str, kind: str, start: datetime | None) -> list[dict[str, Any]]:
    key = f"leaderboard:{window}:{kind}"
    try:
        raw = await get_dragonfly().get(key)
        if raw:
            data = json.loads(raw)
            if isinstance(data, list):
                return data
    except (RuntimeError, OSError, json.JSONDecodeError):
        pass
    rows = await admin_db.leaderboard_rows(kind, start, LIMIT)
    try:
        await get_dragonfly().set(key, json.dumps(rows), ex=CACHE_TTL)
    except (RuntimeError, OSError, TypeError):
        pass
    return rows