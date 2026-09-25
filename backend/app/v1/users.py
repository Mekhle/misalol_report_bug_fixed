from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.security import hash_password, validate_username, verify_password
from app.core.mfa import generate_totp_secret, otpauth_uri, verify_totp
from app.core.config import Settings, get_settings
from app.core.sessions import get_user_from_request
from app.core.sessions import destroy_session, list_user_sessions, revoke_all_user_sessions, revoke_user_session, clear_session_cookie
from app.db import admin_db, data_api
from app.db.data_api import DataConflict
from app.models import User

router = APIRouter(tags=["users"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def public_user(user: User, settings: Settings) -> dict:
    payload = user.to_public_dict()
    payload["is_admin"] = user.is_admin or user.id in settings.admin_user_id_list
    return payload


class UsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class DisplayNameRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=128)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(default="", max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class DeleteAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=320)
    password: str = Field(default="", max_length=128)


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


@router.get("/me")
async def me(user: Annotated[User, Depends(require_user)], settings: SettingsDep) -> dict:
    return public_user(user, settings)


@router.get("/me/security")
async def security_status(user: Annotated[User, Depends(require_user)]) -> dict:
    mfa_enabled, _ = await admin_db.get_user_security(UUID(str(user.id)))
    return {"password_enabled": bool(user.password_hash), "mfa_enabled": mfa_enabled}


@router.patch("/me/password")
async def change_password(payload: PasswordChangeRequest, user: Annotated[User, Depends(require_user)]) -> dict:
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")
    if user.password_hash and not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    await data_api.update_user(user.id, password_hash=hash_password(payload.new_password))
    return {"ok": True}


@router.post("/me/mfa/setup")
async def setup_mfa(user: Annotated[User, Depends(require_user)]) -> dict:
    enabled, _ = await admin_db.get_user_security(UUID(str(user.id)))
    if enabled:
        raise HTTPException(status_code=409, detail="Multi-factor authentication is already enabled.")
    secret = generate_totp_secret()
    await admin_db.set_mfa_secret(UUID(str(user.id)), secret)
    return {"secret": secret, "otpauth_url": otpauth_uri(secret, user.email or str(user.id))}


@router.post("/me/mfa/verify")
async def verify_mfa_setup(payload: MfaCodeRequest, user: Annotated[User, Depends(require_user)]) -> dict:
    _, secret = await admin_db.get_user_security(UUID(str(user.id)))
    if not secret or not verify_totp(secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code.")
    if not await admin_db.enable_mfa(UUID(str(user.id))):
        raise HTTPException(status_code=400, detail="MFA setup has expired. Start again.")
    return {"ok": True, "mfa_enabled": True}


@router.post("/me/mfa/disable")
async def disable_mfa(payload: MfaCodeRequest, user: Annotated[User, Depends(require_user)]) -> dict:
    enabled, secret = await admin_db.get_user_security(UUID(str(user.id)))
    if not enabled or not secret or not verify_totp(secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code.")
    await admin_db.disable_mfa(UUID(str(user.id)))
    return {"ok": True, "mfa_enabled": False}


@router.get("/me/sessions")
async def sessions(request: Request, user: Annotated[User, Depends(require_user)]) -> dict:
    return {"sessions": await list_user_sessions(user.id, request.cookies.get(get_settings().session_cookie_name))}


@router.delete("/me/sessions/{session_id}")
async def revoke_session(session_id: str, user: Annotated[User, Depends(require_user)]) -> dict:
    if not await revoke_user_session(user.id, session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"ok": True}


@router.post("/me/delete")
async def delete_account(payload: DeleteAccountRequest, request: Request, user: Annotated[User, Depends(require_user)], settings: SettingsDep) -> Response:
    if payload.confirmation.strip().lower() != (user.email or "").lower():
        raise HTTPException(status_code=400, detail="Confirmation does not match your account email.")
    if user.password_hash and not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if not await data_api.delete_user(user.id):
        raise HTTPException(status_code=404, detail="Account not found.")
    await revoke_all_user_sessions(user.id)
    await destroy_session(request.cookies.get(settings.session_cookie_name))
    response = JSONResponse({"ok": True, "redirect": "/"})
    clear_session_cookie(response, request, settings)
    return response


@router.patch("/me/username")
async def set_username(
    payload: UsernameRequest,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    try:
        username = validate_username(payload.username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    if await admin_db.is_reserved(username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is reserved.")
    try:
        updated = await data_api.update_user(user.id, username=username)
    except DataConflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is taken.") from None
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return public_user(updated, settings)


@router.patch("/me")
async def update_me(
    payload: DisplayNameRequest,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    updated = await data_api.update_user(user.id, display_name=payload.display_name.strip())
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return public_user(updated, settings)
