from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from httpx import HTTPError
from pydantic import BaseModel, EmailStr, Field

from app.core.account_security import (
    generate_backup_codes,
    hash_backup_code,
    pending_email_for,
    pop_email_change,
    put_email_change,
    read_switcher_ids,
    remember_switcher_user,
)
from app.core.mailer import mailer_configured, send_email_change, send_email_change_notice
from app.core.public_origin import public_origin_for
from app.core.profiles import unwrap_profile_config
from app.core.rate_limit import rate_limit
from app.core.security import hash_password, normalize_email, validate_username, verify_password
from app.core.config import Settings, get_settings
from app.core.sessions import get_user_from_request, list_sessions, revoke_other_sessions, revoke_session, session_id_for
from app.db import admin_db, data_api
from app.db.data_api import DataConflict
from app.models import User

router = APIRouter(tags=["users"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def public_user(user: User, settings: Settings) -> dict:
    payload = user.to_public_dict()
    payload["is_admin"] = user.is_admin or user.id in settings.admin_user_id_list
    return payload


async def public_user_payload(user: User, settings: Settings, request: Request | None = None, *, include_profile: bool = False) -> dict:
    payload = public_user(user, settings)
    payload["is_admin"] = await admin_db.is_admin_user(user.id, user.is_admin, settings.admin_user_id_list)
    payload["staff_role"] = await admin_db.staff_role(user.id, user.is_admin, settings.admin_user_id_list)
    payload["is_staff"] = payload["staff_role"] is not None
    payload["is_template_creator"] = bool(
        payload["is_admin"] or await admin_db.user_has_role(user.id, "template_creator")
    )
    from app.core.premium import has_premium
    payload["premium"] = await has_premium(user.id)
    payload["has_password"] = bool(user.password_hash)
    payload["mfa_enabled"] = await admin_db.mfa_is_enabled(user.id)
    payload["mfa_codes_left"] = await admin_db.unused_backup_count(user.id) if payload["mfa_enabled"] else 0
    payload["pending_email"] = await pending_email_for(user.id)
    payload["accounts"] = await _switcher_accounts(request, user, settings) if request else []
    if include_profile:
        try:
            payload["profile"] = unwrap_profile_config(await data_api.get_profile(user.id))
        except (HTTPError, RuntimeError, ValueError, TimeoutError, OSError):
            # Keep authentication available if optional profile hydration is temporarily unavailable.
            # The frontend will use its authenticated identity seed and retry the profile endpoint.
            pass
    return payload


def _require_current_password(user: User, password: str) -> None:
    if not user.password_hash:
        return
    if not password or not verify_password(user.password_hash, password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is wrong.")


async def _switcher_accounts(request: Request, user: User, settings: Settings) -> list[dict]:
    ids = read_switcher_ids(request, settings)
    if user.id not in ids:
        ids = [user.id, *[item for item in ids if item != user.id]][:3]
    accounts: list[dict] = []
    for user_id in ids:
        person = user if user_id == user.id else await data_api.get_user(user_id)
        if person is None:
            continue
        accounts.append({
            "id": person.id,
            "username": person.username,
            "display_name": person.display_name or person.username or person.email,
            "avatar_url": person.avatar_url,
            "current": person.id == user.id,
        })
    return accounts


class UsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class DisplayNameRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=128)


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


class EmailChangeRequest(BaseModel):
    email: EmailStr
    password: str = ""


class PasswordChangeRequest(BaseModel):
    current_password: str = ""
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class PasswordConfirmRequest(BaseModel):
    password: str = ""


class SessionRevokeRequest(BaseModel):
    session_id: str = ""
    others: bool = False


@router.get("/me")
async def me(
    request: Request,
    response: Response,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    remember_switcher_user(response, request, user.id, settings)
    payload = await public_user_payload(user, settings, request, include_profile=True)
    payload["badges"] = await data_api.list_user_badge_grants(user.id)
    return payload


@router.patch("/me/username")
async def set_username(
    payload: UsernameRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    try:
        username = validate_username(payload.username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    current = (user.username or "").strip().lower() or None
    if current == username:
        return await public_user_payload(user, settings, request)
    if await admin_db.username_is_banned(username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is not allowed.")
    reclaim = await admin_db.owns_former_username(user.id, username)
    if await admin_db.is_reserved(username) and not reclaim:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is reserved.")
    if admin_db.has_pool():
        try:
            await admin_db.change_username(user.id, username, current)
        except LookupError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.") from None
        except ValueError as exc:
            if str(exc) == "banned":
                detail = "That username is not allowed."
            elif str(exc) == "reserved":
                detail = "That username is reserved."
            else:
                detail = "That username is taken."
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
        except Exception:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not change that username. Please try again.") from None
        if current:
            try:
                await rate_limit(f"rl:rename:{user.id}", 3, 86400)
            except (HTTPException, RuntimeError, OSError):
                pass
        updated = await data_api.get_user(user.id)
    else:
        try:
            updated = await data_api.update_user(user.id, username=username)
        except DataConflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is taken.") from None
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return await public_user_payload(updated, settings, request)


@router.patch("/me")
async def update_me(
    payload: DisplayNameRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    updated = await data_api.update_user(user.id, display_name=payload.display_name.strip())
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return await public_user_payload(updated, settings, request)


@router.post("/me/email")
async def change_email(
    payload: EmailChangeRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    _require_current_password(user, payload.password)
    await rate_limit(f"rl:email-change:{user.id}", 5, 86400)
    email = normalize_email(str(payload.email))
    same_email = email == normalize_email(user.email or "")
    if same_email and user.email_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This email is already confirmed.")
    if not same_email:
        existing = await data_api.find_user(email=email)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already used.")
    if not mailer_configured(settings):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email confirmation is not configured.")
    token = await put_email_change(user.id, email)
    confirm_url = f"{public_origin_for(request)}/api/v1/auth/confirm-email?token={token}"
    sent = await send_email_change(email, confirm_url, settings)
    if not sent:
        await pop_email_change(token)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not send the confirmation email.")
    if user.email and user.email != email:
        dashboard = settings.dashboard_url.rstrip("/")
        settings_url = f"{dashboard}/settings" if dashboard.startswith("http") else f"{public_origin_for(request)}{dashboard}/settings"
        await send_email_change_notice(user.email, settings_url, settings)
    return {"ok": True, "pending_email": email}


@router.post("/me/password")
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")
    _require_current_password(user, payload.current_password)
    await rate_limit(f"rl:password-change:{user.id}", 8, 3600)
    if user.password_hash and verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a different password.")
    updated = await data_api.update_user(user.id, password_hash=hash_password(payload.password))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    await revoke_other_sessions(user.id, request.cookies.get(settings.session_cookie_name))
    return await public_user_payload(updated, settings, request)


@router.get("/me/sessions")
async def my_sessions(request: Request, user: Annotated[User, Depends(require_user)], settings: SettingsDep) -> dict:
    token = request.cookies.get(settings.session_cookie_name)
    return {"sessions": await list_sessions(user.id, token)}


@router.post("/me/sessions/revoke")
async def revoke_my_sessions(
    payload: SessionRevokeRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    token = request.cookies.get(settings.session_cookie_name)
    if payload.others:
        removed = await revoke_other_sessions(user.id, token)
        return {"ok": True, "removed": removed, "sessions": await list_sessions(user.id, token)}
    if not payload.session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick a session to sign out.")
    current_id = session_id_for(token) if token else ""
    if token and payload.session_id == current_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use log out to end this session.")
    removed = await revoke_session(user.id, payload.session_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That session is already gone.")
    return {"ok": True, "removed": 1, "sessions": await list_sessions(user.id, token)}


@router.post("/me/mfa/backup-codes")
async def rotate_backup_codes(
    payload: PasswordConfirmRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    _require_current_password(user, payload.password)
    await rate_limit(f"rl:mfa-codes:{user.id}", 5, 86400)
    if not admin_db.has_pool():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not save backup codes.")
    codes = generate_backup_codes()
    await admin_db.replace_backup_codes(user.id, [hash_backup_code(code) for code in codes])
    return {"ok": True, "codes": codes, "mfa_enabled": True, "mfa_codes_left": len(codes)}


@router.post("/me/mfa/disable")
async def disable_mfa(
    payload: PasswordConfirmRequest,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    _require_current_password(user, payload.password)
    await rate_limit(f"rl:mfa-disable:{user.id}", 8, 3600)
    if not admin_db.has_pool():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not update MFA.")
    await admin_db.disable_mfa(user.id)
    return await public_user_payload(user, settings, request)
