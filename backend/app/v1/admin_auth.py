import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.config import Settings, get_settings
from app.core.email import send_transactional_email
from app.core.rate_limit import client_ip, limit_auth, rate_limit
from app.core.turnstile import verify_turnstile
from app.db import admin_db

router = APIRouter(prefix="/admin-auth", tags=["admin-auth"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
ADMIN_COOKIE = "misa_admin_session"


class AdminAccount(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    permissions: dict = Field(default_factory=dict)
    status: str
    suspended: bool

    @field_validator("permissions", mode="before")
    @classmethod
    def normalize_permissions(cls, value: object) -> dict:
        # Some existing Supabase connections return JSONB as text. Decode it
        # before authorization checks while keeping malformed values empty.
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                return {}
        return value if isinstance(value, dict) else {}

    def can(self, permission: str) -> bool:
        return self.role == "super_admin" or bool(self.permissions.get("*") or self.permissions.get(permission) or self.permissions.get("admin"))


class OtpRequest(BaseModel):
    email: EmailStr
    turnstile_token: str | None = Field(default=None, max_length=4096)


class OtpVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")
    turnstile_token: str | None = Field(default=None, max_length=4096)


class InviteRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=128)
    role: str = Field(default="admin", pattern=r"^admin$")
    permissions: dict[str, bool] = Field(default_factory=lambda: {"admin": True, "users": True, "badges": True, "reports": True})


class InviteAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)


def _secret(settings: Settings) -> bytes:
    if not settings.admin_token_secret:
        raise HTTPException(status_code=503, detail="Admin security secret is not configured.")
    return settings.admin_token_secret.encode()


def _digest(value: str, settings: Settings) -> str:
    return hmac.new(_secret(settings), value.encode(), hashlib.sha256).hexdigest()


async def require_admin_session(request: Request, settings: SettingsDep) -> AdminAccount:
    raw = request.cookies.get(ADMIN_COOKIE)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin authentication required.")
    account = await admin_db.admin_from_session(_digest(raw, settings))
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin authentication required.")
    return AdminAccount(**account)


AdminSession = Annotated[AdminAccount, Depends(require_admin_session)]


async def require_super_admin(admin: AdminSession) -> AdminAccount:
    if admin.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super Administrator access is required.")
    return admin


@router.post("/request-otp")
async def request_otp(payload: OtpRequest, request: Request, settings: SettingsDep) -> dict:
    await limit_auth(request, "admin-otp-ip", limit=5, window_seconds=900)
    await verify_turnstile(request, payload.turnstile_token, settings)
    email = str(payload.email).strip().lower()
    await rate_limit(f"rl:admin-otp-email:{hashlib.sha256(email.encode()).hexdigest()}", 5, 900)
    fingerprint = request.headers.get("x-device-fingerprint")
    if fingerprint:
        await rate_limit(f"rl:admin-otp-device:{hashlib.sha256(fingerprint.encode()).hexdigest()}", 5, 900)
    account = await admin_db.admin_by_email(email)
    # Always return the same public response to prevent account enumeration.
    if account and account["status"] == "active" and not account["suspended"]:
        code = f"{secrets.randbelow(1_000_000):06d}"
        await admin_db.create_admin_otp(account["id"], _digest(code, settings), datetime.now(timezone.utc) + timedelta(minutes=5))
        ip = client_ip(request)
        user_agent = request.headers.get("user-agent", "unknown")
        try:
            await send_transactional_email(settings, to=email, subject="Your misa.lol admin verification code", text=f"Your misa.lol admin verification code is {code}. It expires in 5 minutes. IP: {ip}. Browser: {user_agent}")
            await admin_db.log_admin_event(account["id"], "admin.otp.sent", {"ip": ip, "user_agent": user_agent})
        except Exception:
            await admin_db.log_admin_event(account["id"], "admin.otp.send_failed", {"ip": ip})
            raise HTTPException(status_code=503, detail="The verification email could not be sent.") from None
    return {"ok": True, "message": "If that address is authorized, a verification code has been sent."}


@router.post("/verify-otp")
async def verify_otp(payload: OtpVerifyRequest, request: Request, response: Response, settings: SettingsDep) -> dict:
    await limit_auth(request, "admin-otp-verify-ip", limit=20, window_seconds=900)
    await verify_turnstile(request, payload.turnstile_token, settings)
    email = str(payload.email).strip().lower()
    account = await admin_db.admin_by_email(email)
    if account is None or account["status"] != "active" or account["suspended"]:
        raise HTTPException(status_code=401, detail="Invalid or expired verification code.")
    ok, result = await admin_db.verify_admin_otp(account["id"], _digest(payload.code, settings))
    if not ok:
        await admin_db.log_admin_event(account["id"], "admin.otp.failed", {"ip": client_ip(request), "result": result})
        raise HTTPException(status_code=401, detail="Invalid or expired verification code.")
    raw = secrets.token_urlsafe(48)
    await admin_db.create_admin_session(account["id"], _digest(raw, settings), client_ip(request), request.headers.get("user-agent", "unknown"), request.headers.get("x-device-fingerprint", ""))
    await admin_db.log_admin_event(account["id"], "admin.otp.verified", {"ip": client_ip(request), "user_agent": request.headers.get("user-agent", "unknown")})
    response.set_cookie(
        ADMIN_COOKIE,
        raw,
        max_age=8 * 60 * 60,
        path="/",
        secure=settings.is_production,
        httponly=True,
        samesite="strict",
    )
    return {"ok": True, "admin": account}


@router.get("/session")
async def session(admin: AdminSession) -> dict:
    return {"admin": admin.model_dump(mode="json")}


@router.post("/logout")
async def logout(request: Request, response: Response, settings: SettingsDep) -> dict:
    raw = request.cookies.get(ADMIN_COOKIE)
    if raw:
        await admin_db.revoke_admin_session(_digest(raw, settings))
    response.delete_cookie(ADMIN_COOKIE, path="/", secure=settings.is_production, httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/staff")
async def staff(admin: AdminSession) -> dict:
    if not admin.can("staff"):
        raise HTTPException(status_code=403, detail="Staff permission is required.")
    return {"staff": await admin_db.list_admin_staff()}


@router.post("/staff/invites", status_code=201)
async def invite(payload: InviteRequest, request: Request, admin: AdminAccount = Depends(require_super_admin), settings: Settings = Depends(get_settings)) -> dict:
    email = str(payload.email).strip().lower()
    if email == settings.admin_root_email.lower():
        raise HTTPException(status_code=409, detail="The root administrator cannot be invited.")
    if await admin_db.admin_by_email(email):
        raise HTTPException(status_code=409, detail="That address is already staff.")
    raw = secrets.token_urlsafe(48)
    invite_id = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    await admin_db.create_admin_invite(invite_id, email, payload.name, _digest(raw, settings), payload.role, payload.permissions, expires, admin.id)
    link = f"{settings.admin_public_url.rstrip('/')}/invite?token={raw}"
    try:
        await send_transactional_email(settings, to=email, subject="You are invited to misa.lol admin", text=f"You have been invited to misa.lol administration. Accept within 24 hours: {link}")
    except Exception:
        await admin_db.log_admin_event(admin.id, "admin.invite.send_failed", {"email": email})
        raise HTTPException(status_code=503, detail="The invitation email could not be sent.") from None
    await admin_db.log_admin_event(admin.id, "admin.invite.sent", {"email": email, "expires_at": expires.isoformat()}, str(invite_id))
    return {"ok": True}


@router.get("/staff/invites")
async def invites(admin: AdminSession) -> dict:
    if not admin.can("staff"):
        raise HTTPException(status_code=403, detail="Staff permission is required.")
    return {"invites": await admin_db.list_admin_invites()}


@router.delete("/staff/invites/{invite_id}")
async def revoke_invite(invite_id: UUID, admin: AdminAccount = Depends(require_super_admin)) -> dict:
    if not await admin_db.revoke_admin_invite(admin.id, invite_id):
        raise HTTPException(status_code=404, detail="Invite not found.")
    return {"ok": True}


@router.get("/staff/sessions")
async def sessions(admin: AdminAccount = Depends(require_super_admin)) -> dict:
    return {"sessions": await admin_db.list_admin_sessions()}


@router.delete("/staff/sessions/{session_id}")
async def revoke_session(session_id: UUID, admin: AdminAccount = Depends(require_super_admin)) -> dict:
    if not await admin_db.revoke_admin_session_by_id(admin.id, session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"ok": True}


@router.post("/staff/{admin_id}/revoke-sessions")
async def revoke_all_sessions(admin_id: UUID, admin: AdminAccount = Depends(require_super_admin)) -> dict:
    if not await admin_db.admin_by_id(admin_id):
        raise HTTPException(status_code=404, detail="Administrator not found.")
    return {"revoked": await admin_db.revoke_admin_sessions_for_admin(admin.id, admin_id)}


@router.post("/invites/accept")
async def accept_invite(payload: InviteAcceptRequest, settings: SettingsDep) -> dict:
    account = await admin_db.accept_admin_invite(_digest(payload.token, settings))
    if account is None:
        raise HTTPException(status_code=400, detail="This invitation is invalid or expired.")
    await admin_db.log_admin_event(account["id"], "admin.invite.accepted", {"email": account["email"]})
    return {"ok": True, "email": account["email"]}
