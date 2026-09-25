import hmac
import secrets
from typing import Annotated

import httpx
import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.account_security import (
    add_switcher_id,
    attach_switcher_cookie,
    bump_mfa_ticket,
    hash_backup_code,
    load_mfa_ticket,
    peek_email_change,
    peek_password_reset,
    pop_email_change,
    pop_mfa_ticket,
    pop_password_reset,
    put_mfa_ticket,
    put_password_reset,
    read_switcher_ids,
    remember_switcher_user,
)
from app.core.config import Settings, get_settings
from app.core.discord_live import store_discord_session
from app.core.mailer import mailer_configured, send_password_reset
from app.core.oauth import (
    apple_authorize_url,
    discord_authorize_url,
    discord_avatar_url,
    exchange_apple_code,
    exchange_discord_code,
    exchange_google_code,
    google_authorize_url,
    pop_oauth_state,
    save_oauth_state,
    telegram_authorize_url,
    verify_apple_id_token,
)
from app.core.public_origin import public_origin_for
from app.core.rate_limit import client_ip, limit_auth, rate_limit
from app.core.turnstile import TURNSTILE_ENABLED, verify_turnstile
from app.core.security import (
    hash_password,
    normalize_email,
    safe_next_path,
    verify_password,
    parse_telegram_auth_payload,
    verify_telegram_auth,
)
from app.core.sessions import (
    attach_session_cookie,
    clear_session_cookie,
    create_session,
    destroy_session,
    get_user_from_request,
    revoke_all_sessions,
)
from app.db import admin_db, data_api
from app.db.data_api import DataConflict
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    tos: bool
    turnstile_token: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False
    turnstile_token: str = ""


class ForgotRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class MfaLoginRequest(BaseModel):
    ticket: str = Field(min_length=16, max_length=256)
    code: str = Field(min_length=6, max_length=32)


class SwitchRequest(BaseModel):
    user_id: str = Field(min_length=8, max_length=64)


class SwitcherForgetRequest(BaseModel):
    user_id: str = Field(min_length=8, max_length=64)


def _oauth_destination(settings: Settings, signed_in: bool, next_path: str) -> str:
    dashboard = settings.dashboard_url.rstrip("/")
    if next_path in {"/dashboard", "/dashboard/", ""}:
        return dashboard or "/dashboard"
    if next_path.startswith("/dashboard/"):
        extra = next_path[len("/dashboard"):]
        if dashboard.startswith("http"):
            return f"{dashboard}{extra}"
        return next_path
    # Provider linking starts from the authenticated Security page. Always return
    # through the dashboard base path so Next.js does not lose /dashboard.
    if signed_in and next_path in {"/security", "/settings"}:
        suffix = next_path
        if dashboard.startswith("http"):
            return f"{dashboard}{suffix}"
        return f"/dashboard{suffix}"
    return dashboard if signed_in else next_path


def _oauth_error(next_path: str, error: str) -> RedirectResponse:
    separator = "&" if "?" in next_path else "?"
    return RedirectResponse(f"{next_path}{separator}error={error}", status_code=302)


def _settings_url(settings: Settings) -> str:
    dashboard = settings.dashboard_url.rstrip("/")
    if dashboard.startswith("http"):
        return f"{dashboard}/settings"
    return f"{dashboard}/settings" if dashboard else "/dashboard/settings"


def _trusted_email_claim(value: object) -> bool:
    """Accept only an actual true provider claim, never a truthy string like false."""
    return value is True or (isinstance(value, str) and value.strip().lower() == "true")

async def _consume_backup_code(user_id: str, code: str) -> bool:
    if not admin_db.has_pool():
        return False
    digest = hash_backup_code(code)
    try:
        hashes = await admin_db.unused_backup_hashes(user_id)
    except Exception:
        return False
    matched = next((stored for stored in hashes if len(digest) == len(stored) and hmac.compare_digest(digest, stored)), None)
    if not matched:
        return False
    try:
        return await admin_db.consume_backup_code(user_id, matched)
    except Exception:
        return False


async def _require_mfa_ticket(user: User, remember: bool) -> JSONResponse | None:
    if not await admin_db.mfa_is_enabled(user.id):
        return None
    ticket = await put_mfa_ticket(user.id, remember)
    return JSONResponse({"ok": True, "mfa_required": True, "ticket": ticket})


async def _block_signup_ip(request: Request) -> None:
    if await admin_db.request_ip_is_banned(client_ip(request)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="New accounts cannot be created from this network.")


async def _reject_if_banned(user: User, request: Request) -> None:
    await admin_db.remember_signup_ip(user.id, client_ip(request))
    if await admin_db.user_is_banned(user.id):
        await revoke_all_sessions(user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is banned.")
    if user.currently_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is currently suspended.")


async def _issue_session(
    response: JSONResponse | RedirectResponse,
    request: Request,
    user: User,
    settings: Settings,
    remember: bool = False,
) -> None:
    await admin_db.remember_signup_ip(user.id, client_ip(request))
    existing = request.cookies.get(settings.session_cookie_name)
    await destroy_session(existing)
    await data_api.touch_login(user.id)
    token, ttl = await create_session(user.id, remember, request)
    attach_session_cookie(response, request, token, ttl, settings)
    remember_switcher_user(response, request, user.id, settings)


async def _finish_oauth(
    request: Request,
    settings: Settings,
    *,
    provider: str,
    provider_id: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None,
    avatar_url: str | None,
    telegram_username: str | None = None,
    next_path: str = "/dashboard",
    link: bool = False,
) -> tuple[RedirectResponse, User | None]:
    current_user = await get_user_from_request(request)
    if link and current_user is None:
        return _oauth_error("/login", "not_authenticated"), None
    destination = _oauth_destination(settings, current_user is not None, next_path)
    if current_user is None and await admin_db.request_ip_is_banned(client_ip(request)):
        return _oauth_error("/signup", "account_banned"), None
    try:
        user = await data_api.oauth_upsert(
            provider=provider,
            provider_id=provider_id,
            email=email,
            email_verified=email_verified,
            display_name=display_name,
            avatar_url=avatar_url,
            telegram_username=telegram_username,
            current_user_id=current_user.id if current_user else None,
        )
    except DataConflict as exc:
        bounce = destination if current_user else "/login"
        return _oauth_error(bounce, exc.code), None
    await admin_db.remember_signup_ip(user.id, client_ip(request))
    if await admin_db.user_is_banned(user.id):
        return _oauth_error("/login", "account_banned"), None
    if user.currently_suspended:
        return _oauth_error("/login", "account_suspended"), None
    linking = current_user is not None
    if linking:
        return RedirectResponse(destination, status_code=302), user
    if await admin_db.mfa_is_enabled(user.id):
        ticket = await put_mfa_ticket(user.id, True)
        return RedirectResponse(f"/login?mfa_ticket={ticket}", status_code=302), user
    response = RedirectResponse(destination, status_code=302)
    await _issue_session(response, request, user, settings, remember=True)
    return response, user


@router.get("/providers")
async def providers(settings: SettingsDep) -> dict:
    return {
        "email": True,
        "google": settings.google_enabled,
        "discord": settings.discord_enabled,
        "telegram": settings.telegram_enabled,
        "apple": settings.apple_enabled,
        "turnstile_site_key": settings.turnstile_site_key if TURNSTILE_ENABLED else "",
    }


async def require_authenticated_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


def _can_disconnect_provider(user: User, provider: str) -> bool:
    if user.password_hash:
        return True
    return any(
        bool(getattr(user, f"{other}_id", None))
        for other in ("google", "discord", "telegram", "apple")
        if other != provider
    )


@router.post("/{provider}/disconnect")
async def disconnect_provider(
    provider: str,
    request: Request,
    user: User = Depends(require_authenticated_user),
) -> dict[str, bool]:
    if provider not in {"google", "telegram"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported provider.")
    if not getattr(user, f"{provider}_id", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{provider.title()} is not connected.")
    if not _can_disconnect_provider(user, provider):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add a password or another login method before disconnecting this provider.",
        )
    await limit_auth(request, f"{provider}-disconnect", limit=8, window_seconds=60)
    await data_api.clear_user_provider(user.id, provider)
    return {"ok": True, "connected": False}


@router.post("/signup")
async def signup(payload: SignupRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "signup", limit=8, window_seconds=60)
    await verify_turnstile(request, payload.turnstile_token, settings)
    if not payload.tos:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You must accept the Terms of Service.")
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")
    await _block_signup_ip(request)

    email = normalize_email(str(payload.email))
    if await data_api.find_user(email=email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")

    try:
        user = await data_api.create_user(
            email=email,
            email_verified=False,
            password_hash=hash_password(payload.password),
            display_name=email.split("@", 1)[0],
        )
    except DataConflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.") from None

    response = JSONResponse({"ok": True, "redirect": settings.dashboard_url})
    await _issue_session(response, request, user, settings, remember=False)
    return response


_DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlsbDaYjhg5P0vaP0r2+BCekvBDST40"


@router.post("/login")
async def login(payload: LoginRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "login", limit=12, window_seconds=60)
    await verify_turnstile(request, payload.turnstile_token, settings)
    email = normalize_email(str(payload.email))
    await rate_limit(f"rl:login-email:{hash_backup_code(email)[:24]}", 10, 60)
    user = await data_api.find_user(email=email)
    if user is None or not user.password_hash:
        verify_password(_DUMMY_PASSWORD_HASH, payload.password)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    await _reject_if_banned(user, request)
    mfa = await _require_mfa_ticket(user, payload.remember)
    if mfa is not None:
        return mfa
    response = JSONResponse({"ok": True, "redirect": settings.dashboard_url})
    await _issue_session(response, request, user, settings, remember=payload.remember)
    return response


@router.post("/logout")
async def logout(request: Request, settings: SettingsDep) -> JSONResponse:
    await destroy_session(request.cookies.get(settings.session_cookie_name))
    response = JSONResponse({"ok": True, "redirect": "/"})
    clear_session_cookie(response, request, settings)
    return response


@router.post("/forgot")
async def forgot_password(
    payload: ForgotRequest,
    request: Request,
    settings: SettingsDep,
    background: BackgroundTasks,
) -> JSONResponse:
    await limit_auth(request, "forgot", limit=5, window_seconds=3600)
    email = normalize_email(str(payload.email))
    await rate_limit(f"rl:forgot-email:{hash_backup_code(email)[:24]}", 3, 3600)
    user = await data_api.find_user(email=email)
    if user and user.email and not user.currently_suspended and mailer_configured(settings):
        token = await put_password_reset(user.id)
        reset_url = f"{public_origin_for(request)}/reset-password?token={token}"
        background.add_task(send_password_reset, user.email, reset_url, settings)
    return JSONResponse({"ok": True})


@router.post("/reset")
async def reset_password(payload: ResetRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "reset", limit=10, window_seconds=3600)
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")
    saved = await pop_password_reset(payload.token)
    if not saved or not saved.get("user_id"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That reset link is invalid or expired.")
    user = await data_api.get_user(str(saved["user_id"]))
    if user is None or user.currently_suspended:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That reset link is invalid or expired.")
    updated = await data_api.update_user(user.id, password_hash=hash_password(payload.password))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not update that password.")
    await revoke_all_sessions(user.id)
    response = JSONResponse({"ok": True, "redirect": "/login"})
    clear_session_cookie(response, request, settings)
    return response


@router.get("/confirm-email")
async def confirm_email(request: Request, settings: SettingsDep, token: str = "") -> RedirectResponse:
    dest = _settings_url(settings)
    saved = await peek_email_change(token) if token else None
    if not saved or not saved.get("user_id") or not saved.get("email"):
        return RedirectResponse(f"{dest}?email=invalid", status_code=302)
    email = normalize_email(str(saved["email"]))
    existing = await data_api.find_user(email=email)
    if existing and existing.id != str(saved["user_id"]):
        await pop_email_change(token)
        return RedirectResponse(f"{dest}?email=taken", status_code=302)
    try:
        updated = await data_api.update_user(str(saved["user_id"]), email=email, email_verified=True)
    except DataConflict:
        await pop_email_change(token)
        return RedirectResponse(f"{dest}?email=taken", status_code=302)
    if updated is None:
        return RedirectResponse(f"{dest}?email=invalid", status_code=302)
    await pop_email_change(token)
    return RedirectResponse(f"{dest}?email=confirmed", status_code=302)


@router.post("/login/mfa")
async def login_mfa(payload: MfaLoginRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "mfa", limit=8, window_seconds=600)
    ticket = await load_mfa_ticket(payload.ticket)
    if not ticket or not ticket.get("user_id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That verification step expired. Sign in again.")
    attempts = int(ticket.get("attempts") or 0) + 1
    if attempts > 8:
        await pop_mfa_ticket(payload.ticket)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Too many backup-code attempts. Sign in again.")
    user = await data_api.get_user(str(ticket["user_id"]))
    if user is None or not await admin_db.mfa_is_enabled(user.id):
        await pop_mfa_ticket(payload.ticket)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That verification step expired. Sign in again.")
    try:
        await _reject_if_banned(user, request)
    except HTTPException:
        await pop_mfa_ticket(payload.ticket)
        raise
    if not await _consume_backup_code(user.id, payload.code):
        ticket["attempts"] = attempts
        await bump_mfa_ticket(payload.ticket, ticket)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That backup code is not valid.")
    await pop_mfa_ticket(payload.ticket)
    response = JSONResponse({"ok": True, "redirect": settings.dashboard_url})
    await _issue_session(response, request, user, settings, remember=bool(ticket.get("remember")))
    return response


@router.post("/switch")
async def switch_account(payload: SwitchRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "switch", limit=20, window_seconds=3600)
    current = await get_user_from_request(request)
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    allowed = read_switcher_ids(request, settings)
    if payload.user_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That account is not saved on this browser.")
    if payload.user_id == current.id:
        return JSONResponse({"ok": True, "redirect": settings.dashboard_url})
    target = await data_api.get_user(payload.user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That account is not available.")
    try:
        await _reject_if_banned(target, request)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That account is not available.") from None
    response = JSONResponse({"ok": True, "redirect": settings.dashboard_url})
    await _issue_session(response, request, target, settings, remember=True)
    return response


@router.post("/switcher/forget")
async def forget_switcher_account(payload: SwitcherForgetRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    current = await get_user_from_request(request)
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    remaining = [item for item in read_switcher_ids(request, settings) if item != payload.user_id]
    if current.id not in remaining:
        remaining = add_switcher_id(remaining, current.id)
    response = JSONResponse({"ok": True})
    attach_switcher_cookie(response, request, remaining, settings)
    return response


@router.get("/google")
async def google_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    safe_next = safe_next_path(next_path)
    link = mode == "link"
    error_target = _oauth_destination(settings, True, safe_next) if link else "/login"
    if not settings.google_enabled:
        return _oauth_error(error_target, "google_not_configured")
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    nonce = secrets.token_urlsafe(24)
    state = await save_oauth_state("google", safe_next, nonce, "link" if link else "login")
    return RedirectResponse(google_authorize_url(settings, state, nonce), status_code=302)

@router.get("/google/callback")
async def google_callback(
    request: Request,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    saved = await pop_oauth_state(state, "google")
    if not saved:
        return _oauth_error("/login", "oauth_failed")
    next_path = safe_next_path(saved.get("next"))
    link = saved.get("mode") == "link"
    error_target = _oauth_destination(settings, True, next_path) if link else "/login"
    if error or not code:
        return _oauth_error(error_target, "oauth_denied")
    try:
        claims = await exchange_google_code(settings, code)
    except (httpx.HTTPError, ValueError, jwt.PyJWTError):
        return _oauth_error(error_target, "oauth_failed")
    if saved.get("nonce") and claims.get("nonce") and claims.get("nonce") != saved["nonce"]:
        return _oauth_error(error_target, "oauth_failed")
    sub = claims.get("sub")
    if not sub:
        return _oauth_error(error_target, "oauth_failed")
    email = normalize_email(claims["email"]) if claims.get("email") else None
    response, _user = await _finish_oauth(
        request,
        settings,
        provider="google",
        provider_id=str(sub),
        email=email,
        email_verified=_trusted_email_claim(claims.get("email_verified")) if email else False,
        display_name=claims.get("name"),
        avatar_url=claims.get("picture"),
        next_path=next_path,
        link=link,
    )
    return response


@router.get("/discord")
async def discord_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    safe_next = safe_next_path(next_path)
    link = mode == "link"
    error_target = _oauth_destination(settings, True, safe_next) if link else "/login"
    if not settings.discord_enabled:
        return _oauth_error(error_target, "discord_not_configured")
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    state = await save_oauth_state("discord", safe_next, mode="link" if link else "login")
    return RedirectResponse(discord_authorize_url(settings, state), status_code=302)

@router.get("/discord/callback")
async def discord_callback(
    request: Request,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    saved = await pop_oauth_state(state, "discord")
    if not saved:
        return _oauth_error("/login", "oauth_failed")
    next_path = safe_next_path(saved.get("next"))
    link = saved.get("mode") == "link"
    error_target = _oauth_destination(settings, True, next_path) if link else "/login"
    if error or not code:
        return _oauth_error(error_target, "oauth_denied")
    try:
        profile, tokens = await exchange_discord_code(settings, code)
    except (httpx.HTTPError, ValueError):
        return _oauth_error(error_target, "oauth_failed")
    discord_id = profile.get("id")
    if not discord_id:
        return _oauth_error(error_target, "oauth_failed")
    email = normalize_email(profile["email"]) if profile.get("email") else None
    response, user = await _finish_oauth(
        request,
        settings,
        provider="discord",
        provider_id=str(discord_id),
        email=email,
        email_verified=bool(profile.get("verified")) if email else False,
        display_name=profile.get("global_name") or profile.get("username"),
        avatar_url=discord_avatar_url(profile),
        next_path=next_path,
        link=link,
    )
    if user:
        try:
            await store_discord_session(user.id, str(discord_id), tokens, settings)
        except Exception:
            pass
    return response


@router.get("/telegram")
async def telegram_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    safe_next = safe_next_path(next_path)
    link = mode == "link"
    error_target = _oauth_destination(settings, True, safe_next) if link else "/login"
    if not settings.telegram_enabled:
        return _oauth_error(error_target, "telegram_not_configured")
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    state = await save_oauth_state("telegram", safe_next, mode="link" if link else "login")
    return RedirectResponse(telegram_authorize_url(settings, state), status_code=302)


TELEGRAM_RESULT_BRIDGE = """<!DOCTYPE html>
<title>Signing in…</title>
<script>
(function () {
  var prefix = "#tgAuthResult=";
  var hash = location.hash || "";
  if (hash.indexOf(prefix) !== 0) {
    location.replace("/login?error=oauth_failed");
    return;
  }
  var data;
  try {
    var raw = hash.slice(prefix.length);
    data = JSON.parse(atob(raw + "=".repeat((4 - (raw.length % 4)) % 4)));
  } catch (e) {
    location.replace("/login?error=oauth_failed");
    return;
  }
  var params = new URLSearchParams();
  Object.keys(data).forEach(function (key) {
    var value = data[key];
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  var queryState = new URLSearchParams(location.search).get("state");
  if (queryState) params.set("state", queryState);
  if (!params.get("id") || !params.get("hash")) {
    location.replace("/login?error=oauth_failed");
    return;
  }
  location.replace("/api/v1/auth/telegram/callback?" + params.toString());
})();
</script>
"""


@router.get("/telegram/callback", response_model=None)
async def telegram_callback(request: Request, settings: SettingsDep) -> RedirectResponse | HTMLResponse:
    if not settings.telegram_enabled:
        return _oauth_error("/login", "telegram_not_configured")
    payload = parse_telegram_auth_payload(dict(request.query_params))
    if not payload.get("hash"):
        return HTMLResponse(TELEGRAM_RESULT_BRIDGE)
    if not verify_telegram_auth(payload, settings.telegram_bot_token):
        return _oauth_error("/login", "oauth_failed")
    telegram_id = payload.get("id")
    if not telegram_id:
        return _oauth_error("/login", "oauth_failed")
    saved = await pop_oauth_state(request.query_params.get("state"), "telegram")
    if not saved:
        return _oauth_error("/login", "oauth_failed")
    next_path = safe_next_path(saved.get("next"))
    link = saved.get("mode") == "link"
    first_name = payload.get("first_name") or ""
    last_name = payload.get("last_name") or ""
    display_name = f"{first_name} {last_name}".strip() or payload.get("username")
    response, _user = await _finish_oauth(
        request,
        settings,
        provider="telegram",
        provider_id=str(telegram_id),
        email=None,
        email_verified=False,
        display_name=display_name,
        avatar_url=payload.get("photo_url"),
        telegram_username=payload.get("username"),
        next_path=next_path,
        link=link,
    )
    return response


@router.get("/apple")
async def apple_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    if not settings.apple_enabled:
        return _oauth_error("/login", "apple_not_configured")
    nonce = secrets.token_urlsafe(24)
    link = mode == "link"
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    state = await save_oauth_state("apple", safe_next_path(next_path), nonce=nonce)
    return RedirectResponse(apple_authorize_url(settings, state, nonce), status_code=302)


@router.post("/apple/callback")
@router.get("/apple/callback")
async def apple_callback(
    request: Request,
    settings: SettingsDep,
) -> RedirectResponse:
    code = None
    id_token = None
    state = None
    user_json = None
    error = None

    if request.method == "POST":
        try:
            form = await request.form()
            code = form.get("code")
            id_token = form.get("id_token")
            state = form.get("state")
            user_json = form.get("user")
            error = form.get("error")
        except Exception:
            return _oauth_error("/login", "oauth_failed")
    else:
        code = request.query_params.get("code")
        id_token = request.query_params.get("id_token")
        state = request.query_params.get("state")
        error = request.query_params.get("error")

    if error or (not code and not id_token):
        return _oauth_error("/login", "oauth_denied")

    saved = await pop_oauth_state(state, "apple")
    if not saved:
        return _oauth_error("/login", "oauth_failed")

    claims = None
    if id_token:
        try:
            claims = verify_apple_id_token(settings, str(id_token))
        except Exception:
            claims = None

    if claims is None and code:
        try:
            tokens = await exchange_apple_code(settings, str(code))
            if tokens.get("id_token"):
                claims = verify_apple_id_token(settings, str(tokens["id_token"]))
        except Exception:
            claims = None

    if not claims:
        return _oauth_error("/login", "oauth_failed")

    if saved.get("nonce") and claims.get("nonce") and claims.get("nonce") != saved["nonce"]:
        return _oauth_error("/login", "oauth_failed")

    sub = claims.get("sub")
    if not sub:
        return _oauth_error("/login", "oauth_failed")

    email = normalize_email(claims["email"]) if claims.get("email") else None
    email_verified = _trusted_email_claim(claims.get("email_verified")) if email else False

    display_name = None
    if user_json:
        try:
            import json as _json
            user_data = _json.loads(user_json) if isinstance(user_json, str) else user_json
            name_obj = user_data.get("name") or {}
            first = name_obj.get("firstName") or ""
            last = name_obj.get("lastName") or ""
            display_name = f"{first} {last}".strip() or None
        except Exception:
            pass
    if not display_name and email:
        display_name = email.split("@", 1)[0]

    response, _user = await _finish_oauth(
        request,
        settings,
        provider="apple",
        provider_id=str(sub),
        email=email,
        email_verified=email_verified,
        display_name=display_name,
        avatar_url=None,
        next_path=safe_next_path(saved.get("next")),
    )
    return response

