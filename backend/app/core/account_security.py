import base64
import hashlib
import hmac
import json
import secrets
from typing import Any
from uuid import UUID

from fastapi import Response
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.security import cookie_should_be_secure
from app.db.dragonfly import get_dragonfly

SWITCHER_MAX = 3
EMAIL_CHANGE_TTL = 60 * 60 * 24
PASSWORD_RESET_TTL = 60 * 30
MFA_TICKET_TTL = 60 * 5
PENDING_EMAIL_TTL = EMAIL_CHANGE_TTL
BACKUP_CODE_COUNT = 10


def _secret(settings: Settings | None = None) -> bytes:
    settings = settings or get_settings()
    material = settings.admin_token_secret
    if not material:
        raise ValueError("Admin security secret is not configured.")
    return hashlib.sha256(f"misa-account:{material}".encode()).digest()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_backup_code(code: str, settings: Settings | None = None) -> str:
    normalized = normalize_backup_code(code)
    return hmac.new(_secret(settings), normalized.encode(), hashlib.sha256).hexdigest()


def normalize_backup_code(code: str) -> str:
    return "".join(ch for ch in code.strip().upper() if ch.isalnum())


def format_backup_code(raw: str) -> str:
    compact = normalize_backup_code(raw)
    if len(compact) != 8:
        return compact
    return f"{compact[:4]}-{compact[4:]}"


def generate_backup_codes() -> list[str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes: list[str] = []
    seen: set[str] = set()
    while len(codes) < BACKUP_CODE_COUNT:
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        if raw in seen:
            continue
        seen.add(raw)
        codes.append(format_backup_code(raw))
    return codes


def codes_match(submitted: str, stored_hash: str, settings: Settings | None = None) -> bool:
    digest = hash_backup_code(submitted, settings)
    return hmac.compare_digest(digest, stored_hash)


async def store_json(key: str, payload: dict[str, Any], ttl: int) -> None:
    await get_dragonfly().set(key, json.dumps(payload), ex=ttl)


async def pop_json(key: str) -> dict[str, Any] | None:
    redis = get_dragonfly()
    getdel = getattr(redis, "getdel", None)
    raw = await getdel(key) if getdel else None
    if raw is None and getdel is None:
        raw = await redis.get(key)
        if raw:
            await redis.delete(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def peek_json(key: str) -> dict[str, Any] | None:
    raw = await get_dragonfly().get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def put_email_change(user_id: str, email: str) -> str:
    token = new_token()
    payload = {"user_id": user_id, "email": email}
    await store_json(f"email_change:{token_digest(token)}", payload, EMAIL_CHANGE_TTL)
    await get_dragonfly().set(f"email_pending:{user_id}", email, ex=PENDING_EMAIL_TTL)
    return token


async def peek_email_change(token: str) -> dict[str, Any] | None:
    return await peek_json(f"email_change:{token_digest(token)}")


async def pop_email_change(token: str) -> dict[str, Any] | None:
    data = await pop_json(f"email_change:{token_digest(token)}")
    if data and data.get("user_id"):
        await get_dragonfly().delete(f"email_pending:{data['user_id']}")
    return data


async def pending_email_for(user_id: str) -> str | None:
    value = await get_dragonfly().get(f"email_pending:{user_id}")
    return str(value) if value else None


async def put_password_reset(user_id: str) -> str:
    token = new_token()
    await store_json(f"password_reset:{token_digest(token)}", {"user_id": user_id}, PASSWORD_RESET_TTL)
    return token


async def peek_password_reset(token: str) -> dict[str, Any] | None:
    return await peek_json(f"password_reset:{token_digest(token)}")


async def pop_password_reset(token: str) -> dict[str, Any] | None:
    return await pop_json(f"password_reset:{token_digest(token)}")


async def put_mfa_ticket(user_id: str, remember: bool) -> str:
    token = new_token()
    await store_json(
        f"mfa_ticket:{token_digest(token)}",
        {"user_id": user_id, "remember": remember, "attempts": 0},
        MFA_TICKET_TTL,
    )
    return token


async def load_mfa_ticket(token: str) -> dict[str, Any] | None:
    return await peek_json(f"mfa_ticket:{token_digest(token)}")


async def bump_mfa_ticket(token: str, payload: dict[str, Any]) -> None:
    await store_json(f"mfa_ticket:{token_digest(token)}", payload, MFA_TICKET_TTL)


async def pop_mfa_ticket(token: str) -> dict[str, Any] | None:
    return await pop_json(f"mfa_ticket:{token_digest(token)}")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def sign_switcher(user_ids: list[str], settings: Settings | None = None) -> str:
    cleaned: list[str] = []
    for item in user_ids:
        try:
            cleaned.append(str(UUID(str(item))))
        except ValueError:
            continue
        if len(cleaned) >= SWITCHER_MAX:
            break
    body = _b64url(json.dumps({"v": 1, "ids": cleaned}, separators=(",", ":")).encode())
    sig = _b64url(hmac.new(_secret(settings), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_switcher_ids(request: Request, settings: Settings | None = None) -> list[str]:
    settings = settings or get_settings()
    raw = request.cookies.get(settings.switcher_cookie_name) or ""
    if "." not in raw:
        return []
    body, _, sig = raw.partition(".")
    expected = _b64url(hmac.new(_secret(settings), body.encode(), hashlib.sha256).digest())
    if len(sig) != len(expected) or not hmac.compare_digest(sig, expected):
        return []
    try:
        data = json.loads(_b64url_decode(body))
    except (ValueError, json.JSONDecodeError):
        return []
    ids: list[str] = []
    for item in data.get("ids") or []:
        try:
            ids.append(str(UUID(str(item))))
        except ValueError:
            continue
        if len(ids) >= SWITCHER_MAX:
            break
    return ids


def add_switcher_id(user_ids: list[str], user_id: str) -> list[str]:
    try:
        current = str(UUID(str(user_id)))
    except ValueError:
        return user_ids[:SWITCHER_MAX]
    return [current, *[item for item in user_ids if item != current]][:SWITCHER_MAX]


def attach_switcher_cookie(response: Response, request: Request, user_ids: list[str], settings: Settings) -> None:
    response.set_cookie(
        key=settings.switcher_cookie_name,
        value=sign_switcher(user_ids, settings),
        max_age=settings.switcher_ttl_seconds,
        path="/",
        httponly=True,
        secure=cookie_should_be_secure(request, settings),
        samesite="lax",
    )


def remember_switcher_user(response: Response, request: Request, user_id: str, settings: Settings) -> None:
    attach_switcher_cookie(response, request, add_switcher_id(read_switcher_ids(request, settings), user_id), settings)
