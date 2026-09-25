import secrets
from typing import Annotated
from uuid import UUID

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.config import Settings, get_settings
from app.core.oauth import (
    apple_authorize_url,
    discord_authorize_url,
    discord_avatar_url,
    exchange_apple_code,
    exchange_google_code,
    fetch_discord_user,
    google_authorize_url,
    pop_oauth_state,
    save_oauth_state,
    telegram_authorize_url,
    verify_apple_id_token,
)
from app.core.rate_limit import limit_auth
from app.core.turnstile import verify_turnstile
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
    consume_mfa_challenge,
    create_mfa_challenge,
    clear_session_cookie,
    create_session,
    destroy_session,
    get_user_from_request,
)
from app.core.mfa import verify_totp
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
    turnstile_token: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False
    turnstile_token: str = Field(min_length=1)


class MfaLoginRequest(BaseModel):
    challenge: str = Field(min_length=20, max_length=256)
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")
    remember: bool = False


def _oauth_error(next_path: str, error: str) -> RedirectResponse:
    separator = "&" if "?" in next_path else "?"
    return RedirectResponse(f"{next_path}{separator}error={error}", status_code=302)


async def _issue_session(
    response: JSONResponse | RedirectResponse,
    request: Request,
    user: User,
    settings: Settings,
    remember: bool = False,
) -> None:
    existing = request.cookies.get(settings.session_cookie_name)
    await destroy_session(existing)
    await data_api.touch_login(user.id)
    token, ttl = await create_session(
        user.id,
        remember,
        ip=request.client.host if request.client else "",
        user_agent=request.headers.get("user-agent", "unknown"),
    )
    attach_session_cookie(response, request, token, ttl, settings)


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
) -> RedirectResponse:
    current_user = await get_user_from_request(request)
    if link and current_user is None:
        return _oauth_error("/login", "not_authenticated")
    destination = next_path if link else ("/dashboard" if current_user else next_path)
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
        bounce = "/dashboard" if current_user else "/login"
        return _oauth_error(bounce, exc.code)
    if user.currently_suspended:
        return _oauth_error("/login", "account_suspended")
    if link:
        return RedirectResponse(destination, status_code=302)
    response = RedirectResponse(destination, status_code=302)
    await _issue_session(response, request, user, settings, remember=True)
    return response


@router.get("/providers")
async def providers(settings: SettingsDep) -> dict:
    return {
        "email": True,
        "google": settings.google_enabled,
        "discord": settings.discord_enabled,
        "telegram": settings.telegram_enabled,
        "apple": settings.apple_enabled,
        "turnstile_site_key": settings.turnstile_site_key,
    }


@router.post("/signup")
async def signup(payload: SignupRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "signup", limit=8, window_seconds=60)
    await verify_turnstile(request, payload.turnstile_token, settings)
    if not payload.tos:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You must accept the Terms of Service.")
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")

    email = normalize_email(str(payload.email))
    if email == settings.admin_root_email.lower():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That address is reserved for administration.")
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

    response = JSONResponse({"ok": True, "redirect": "/dashboard"})
    await _issue_session(response, request, user, settings, remember=False)
    return response


@router.post("/login")
async def login(payload: LoginRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "login", limit=12, window_seconds=60)
    await verify_turnstile(request, payload.turnstile_token, settings)
    email = normalize_email(str(payload.email))
    user = await data_api.find_user(email=email)
    if user is None or not user.password_hash or not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if user.currently_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is currently suspended.")
    mfa_enabled, _ = await admin_db.get_user_security(UUID(str(user.id)))
    if mfa_enabled:
        challenge = await create_mfa_challenge(user.id, payload.remember)
        return JSONResponse({"ok": False, "mfa_required": True, "challenge": challenge})
    response = JSONResponse({"ok": True, "redirect": "/dashboard"})
    await _issue_session(response, request, user, settings, remember=payload.remember)
    return response


@router.post("/mfa")
async def verify_login_mfa(payload: MfaLoginRequest, request: Request, settings: SettingsDep) -> JSONResponse:
    await limit_auth(request, "mfa-login", limit=5, window_seconds=300)
    challenge = await consume_mfa_challenge(payload.challenge)
    if not challenge or not challenge.get("user_id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The verification request has expired.")
    user = await data_api.get_user(str(challenge["user_id"]))
    if user is None or user.currently_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA verification failed.")
    enabled, secret = await admin_db.get_user_security(UUID(str(user.id)))
    if not enabled or not secret or not verify_totp(secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code.")
    response = JSONResponse({"ok": True, "redirect": "/dashboard"})
    await _issue_session(response, request, user, settings, remember=bool(challenge.get("remember")))
    return response


@router.post("/logout")
async def logout(request: Request, settings: SettingsDep) -> JSONResponse:
    await destroy_session(request.cookies.get(settings.session_cookie_name))
    response = JSONResponse({"ok": True, "redirect": "/"})
    clear_session_cookie(response, request, settings)
    return response


@router.get("/google")
async def google_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    if not settings.google_enabled:
        return _oauth_error("/login", "google_not_configured")
    nonce = secrets.token_urlsafe(24)
    link = mode == "link"
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    state = await save_oauth_state("google", safe_next_path(next_path), nonce, "link" if link else "login")
    return RedirectResponse(google_authorize_url(settings, state, nonce), status_code=302)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error or not code:
        return _oauth_error("/login", "oauth_denied")
    saved = await pop_oauth_state(state, "google")
    if not saved:
        return _oauth_error("/login", "oauth_failed")
    try:
        claims = await exchange_google_code(settings, code)
    except (httpx.HTTPError, ValueError, jwt.PyJWTError):
        return _oauth_error("/login", "oauth_failed")
    if saved.get("nonce") and claims.get("nonce") and claims.get("nonce") != saved["nonce"]:
        return _oauth_error("/login", "oauth_failed")
    sub = claims.get("sub")
    if not sub:
        return _oauth_error("/login", "oauth_failed")
    email = normalize_email(claims["email"]) if claims.get("email") else None
    return await _finish_oauth(
        request,
        settings,
        provider="google",
        provider_id=str(sub),
        email=email,
        email_verified=bool(claims.get("email_verified")) if email else False,
        display_name=claims.get("name"),
        avatar_url=claims.get("picture"),
        next_path=safe_next_path(saved.get("next")),
        link=saved.get("mode") == "link",
    )


@router.get("/discord")
async def discord_start(
    request: Request,
    settings: SettingsDep,
    next_path: str = Query("/dashboard", alias="next"),
    mode: str = Query("login"),
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    if not settings.discord_enabled:
        return _oauth_error("/login", "discord_not_configured")
    link = mode == "link"
    if link and await get_user_from_request(request) is None:
        return _oauth_error("/login", "not_authenticated")
    state = await save_oauth_state("discord", safe_next_path(next_path), mode="link" if link else "login")
    return RedirectResponse(discord_authorize_url(settings, state), status_code=302)


@router.get("/discord/callback")
async def discord_callback(
    request: Request,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error or not code:
        return _oauth_error("/login", "oauth_denied")
    saved = await pop_oauth_state(state, "discord")
    if not saved:
        return _oauth_error("/login", "oauth_failed")
    try:
        profile = await fetch_discord_user(settings, code)
    except (httpx.HTTPError, ValueError):
        return _oauth_error("/login", "oauth_failed")
    discord_id = profile.get("id")
    if not discord_id:
        return _oauth_error("/login", "oauth_failed")
    email = normalize_email(profile["email"]) if profile.get("email") else None
    return await _finish_oauth(
        request,
        settings,
        provider="discord",
        provider_id=str(discord_id),
        email=email,
        email_verified=bool(profile.get("verified")) if email else False,
        display_name=profile.get("global_name") or profile.get("username"),
        avatar_url=discord_avatar_url(profile),
        next_path=safe_next_path(saved.get("next")),
        link=saved.get("mode") == "link",
    )


@router.get("/telegram")
async def telegram_start(
    request: Request,
    settings: SettingsDep,
) -> RedirectResponse:
    await limit_auth(request, "oauth", limit=20, window_seconds=60)
    if not settings.telegram_enabled:
        return _oauth_error("/login", "telegram_not_configured")
    return RedirectResponse(telegram_authorize_url(settings), status_code=302)


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
    first_name = payload.get("first_name") or ""
    last_name = payload.get("last_name") or ""
    display_name = f"{first_name} {last_name}".strip() or payload.get("username")
    return await _finish_oauth(
        request,
        settings,
        provider="telegram",
        provider_id=str(telegram_id),
        email=None,
        email_verified=False,
        display_name=display_name,
        avatar_url=payload.get("photo_url"),
        telegram_username=payload.get("username"),
        next_path="/dashboard",
    )


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
    email_verified = bool(claims.get("email_verified")) if email else False

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

    return await _finish_oauth(
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

