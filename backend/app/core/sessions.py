import hashlib
import json
import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import Response
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.rate_limit import client_ip
from app.core.security import cookie_should_be_secure
from app.db import data_api
from app.db.dragonfly import get_dragonfly
from app.models import User

USER_SESSIONS_TTL = 60 * 60 * 24 * 90
TOUCH_EVERY_SECONDS = 300


def _session_key(token: str) -> str:
    return f"session:{token}"


def _user_sessions_key(user_id: str) -> str:
    return f"user_sessions:{user_id}"


def session_id_for(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_session(user_id: str, remember: bool = False, request: Request | None = None) -> tuple[str, int]:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    ttl = settings.session_remember_ttl_seconds if remember else settings.session_ttl_seconds
    payload = {
        "user_id": user_id,
        "remember": remember,
        "created_at": _now(),
        "last_seen_at": _now(),
        "user_agent": ((request.headers.get("user-agent") or "")[:240] if request else ""),
        "ip": client_ip(request) if request else "",
    }
    redis = get_dragonfly()
    await redis.set(_session_key(token), json.dumps(payload), ex=ttl)
    await redis.sadd(_user_sessions_key(user_id), token)
    await redis.expire(_user_sessions_key(user_id), max(ttl, USER_SESSIONS_TTL))
    return token, ttl


async def destroy_session(token: str | None) -> None:
    if not token:
        return
    redis = get_dragonfly()
    data = await load_session(token)
    await redis.delete(_session_key(token))
    if data and data.get("user_id"):
        await redis.srem(_user_sessions_key(str(data["user_id"])), token)


async def load_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    raw = await get_dragonfly().get(_session_key(token))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) and data.get("user_id") else None


async def touch_session(token: str, remember: bool) -> None:
    settings = get_settings()
    ttl = settings.session_remember_ttl_seconds if remember else settings.session_ttl_seconds
    redis = get_dragonfly()
    data = await load_session(token)
    if not data:
        return
    last = str(data.get("last_seen_at") or "")
    should_write = True
    if last:
        try:
            previous = datetime.fromisoformat(last)
            should_write = (datetime.now(timezone.utc) - previous).total_seconds() >= TOUCH_EVERY_SECONDS
        except ValueError:
            should_write = True
    if should_write:
        data["last_seen_at"] = _now()
        await redis.set(_session_key(token), json.dumps(data), ex=ttl)
    else:
        await redis.expire(_session_key(token), ttl)
    if data.get("user_id"):
        await redis.sadd(_user_sessions_key(str(data["user_id"])), token)
        await redis.expire(_user_sessions_key(str(data["user_id"])), USER_SESSIONS_TTL)


def attach_session_cookie(response: Response, request: Request, token: str, ttl: int, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=ttl,
        path="/",
        httponly=True,
        secure=cookie_should_be_secure(request, settings),
        samesite="lax",
    )


def clear_session_cookie(response: Response, request: Request, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=cookie_should_be_secure(request, settings),
        samesite="lax",
    )


async def list_sessions(user_id: str, current_token: str | None = None) -> list[dict[str, Any]]:
    redis = get_dragonfly()
    tokens = await redis.smembers(_user_sessions_key(user_id))
    sessions: list[dict[str, Any]] = []
    for token in tokens or []:
        data = await load_session(token)
        if not data:
            await redis.srem(_user_sessions_key(user_id), token)
            continue
        sessions.append({
            "id": session_id_for(token),
            "created_at": data.get("created_at"),
            "last_seen_at": data.get("last_seen_at") or data.get("created_at"),
            "user_agent": data.get("user_agent") or "",
            "ip": data.get("ip") or "",
            "current": bool(current_token) and len(token) == len(current_token) and secrets.compare_digest(token, current_token),
        })
    sessions.sort(key=lambda item: (item["current"], str(item.get("last_seen_at") or "")), reverse=True)
    return sessions


async def revoke_session(user_id: str, session_id: str) -> bool:
    redis = get_dragonfly()
    for token in await redis.smembers(_user_sessions_key(user_id)) or []:
        digest = session_id_for(token)
        if len(digest) == len(session_id) and secrets.compare_digest(digest, session_id):
            await destroy_session(token)
            return True
    return False


async def revoke_other_sessions(user_id: str, keep_token: str | None) -> int:
    redis = get_dragonfly()
    removed = 0
    for token in await redis.smembers(_user_sessions_key(user_id)) or []:
        if keep_token and len(token) == len(keep_token) and secrets.compare_digest(token, keep_token):
            continue
        await destroy_session(token)
        removed += 1
    return removed


async def revoke_all_sessions(user_id: str) -> int:
    return await revoke_other_sessions(user_id, None)


async def get_user_from_request(request: Request) -> User | None:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    data = await load_session(token)
    if not data or not token:
        return None
    try:
        UUID(str(data["user_id"]))
    except ValueError:
        return None
    user = await data_api.get_user(str(data["user_id"]))
    if user is None:
        await destroy_session(token)
        return None
    if user.currently_suspended:
        await destroy_session(token)
        return None
    from app.db import admin_db
    if await admin_db.user_is_banned(user.id):
        await destroy_session(token)
        return None
    await touch_session(token, bool(data.get("remember")))
    return user
