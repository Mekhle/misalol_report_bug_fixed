from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.discord_live import can_unlink_discord, invalidate_discord_cache, live_discord_state, public_presence_for_user
from app.core.oauth import revoke_discord_token
from app.core.rate_limit import limit_auth
from app.core.sessions import get_user_from_request
from app.db import data_api
from app.models import User

router = APIRouter(prefix="/discord", tags=["discord"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


class DiscordPrefsRequest(BaseModel):
    showAvatar: bool | None = None
    showDecoration: bool | None = None
    showGuildTag: bool | None = None
    showStatus: bool | None = None


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


@router.get("")
async def discord_state(user: Annotated[User, Depends(require_user)]) -> dict:
    return await live_discord_state(user)


@router.get("/status")
async def discord_presence(user: Annotated[User, Depends(require_user)]) -> dict:
    return {"status": await public_presence_for_user(user)}


@router.patch("")
async def update_discord_prefs(
    payload: DiscordPrefsRequest,
    user: Annotated[User, Depends(require_user)],
) -> dict:
    if not user.discord_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Discord first.")
    prefs = {}
    if payload.showAvatar is not None:
        prefs["show_avatar"] = payload.showAvatar
    if payload.showDecoration is not None:
        prefs["show_decoration"] = payload.showDecoration
    if payload.showGuildTag is not None:
        prefs["show_guild_tag"] = payload.showGuildTag
    if payload.showStatus is not None:
        prefs["show_status"] = payload.showStatus
    if prefs:
        updated = await data_api.update_discord_prefs(user.id, **prefs)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect Discord to change what appears on your card.")
        await invalidate_discord_cache(user.id)
    return await live_discord_state(user)


@router.post("/disconnect")
async def disconnect_discord(
    request: Request,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict:
    await limit_auth(request, "discord-disconnect", limit=8, window_seconds=60)
    if not user.discord_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discord is not connected.")
    if not can_unlink_discord(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add a password or another login method before disconnecting Discord.",
        )
    link = await data_api.get_discord_link(user.id)
    if link:
        from app.core.discord_live import decrypt_secret
        refresh = decrypt_secret(str(link.get("refresh_token") or ""), settings)
        try:
            await revoke_discord_token(settings, refresh or "")
        except Exception:
            pass
    await data_api.delete_discord_link(user.id)
    await data_api.clear_user_discord_id(user.id)
    await invalidate_discord_cache(user.id)
    return {"ok": True, "connected": False}
