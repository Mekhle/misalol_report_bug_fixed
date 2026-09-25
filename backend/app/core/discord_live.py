import base64
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from html import escape

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import Settings, get_settings
from app.db import data_api
from app.db.dragonfly import get_dragonfly
from app.models import User

DISCORD_API = "https://discord.com/api/v10"
DISCORD_CDN = "https://cdn.discordapp.com"
SNOWFLAKE = re.compile(r"^\d{16,22}$")
ASSET = re.compile(r"^[a-zA-Z0-9_]{8,80}$")
CACHE_TTL = 60
PRESENCE_KEY_PREFIX = "discord:presence:"
PRESENCE_STATUSES = {"online", "idle", "dnd", "offline"}


def _fernet(settings: Settings | None = None) -> Fernet:
    settings = settings or get_settings()
    material = (settings.data_api_key or settings.discord_client_secret or settings.app_name).encode()
    digest = hashlib.sha256(b"misa-discord-link:" + material).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str, settings: Settings | None = None) -> str:
    return _fernet(settings).encrypt(value.encode()).decode()


def decrypt_secret(value: str, settings: Settings | None = None) -> str | None:
    if not value:
        return None
    try:
        return _fernet(settings).decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return None


def can_unlink_discord(user: User) -> bool:
    return bool(user.password_hash or user.google_id or user.telegram_id)


def discord_avatar_cdn(user_id: str, avatar: str) -> str | None:
    if not SNOWFLAKE.fullmatch(user_id):
        return None
    if avatar and ASSET.fullmatch(avatar):
        ext = "gif" if avatar.startswith("a_") else "png"
        return f"{DISCORD_CDN}/avatars/{user_id}/{avatar}.{ext}?size=256"
    try:
        index = (int(user_id) >> 22) % 6
    except ValueError:
        return None
    return f"{DISCORD_CDN}/embed/avatars/{index}.png"


def discord_decoration_cdn(asset: str) -> str | None:
    if not ASSET.fullmatch(asset):
        return None
    return f"{DISCORD_CDN}/avatar-decoration-presets/{asset}.png?size=240&passthrough=true"


def discord_guild_badge_cdn(guild_id: str, badge: str) -> str | None:
    if not SNOWFLAKE.fullmatch(guild_id) or not ASSET.fullmatch(badge):
        return None
    return f"{DISCORD_CDN}/clan-badges/{guild_id}/{badge}.png?size=64"


def parse_discord_card(user: dict[str, Any]) -> dict[str, Any]:
    user_id = str(user.get("id") or "")
    avatar = discord_avatar_cdn(user_id, str(user.get("avatar") or ""))
    decoration_raw = user.get("avatar_decoration_data") if isinstance(user.get("avatar_decoration_data"), dict) else {}
    decoration = discord_decoration_cdn(str((decoration_raw or {}).get("asset") or ""))
    clan = user.get("primary_guild") if isinstance(user.get("primary_guild"), dict) else user.get("clan")
    clan = clan if isinstance(clan, dict) else {}
    tag = str(clan.get("tag") or "").strip()[:4]
    guild = None
    if clan.get("identity_enabled") and tag and all(ch not in tag for ch in '<>&"\''):
        badge = discord_guild_badge_cdn(str(clan.get("identity_guild_id") or ""), str(clan.get("badge") or ""))
        guild = {"tag": tag, "badge": badge}
    return {
        "username": str(user.get("username") or "")[:32],
        "globalName": str(user.get("global_name") or "")[:32],
        "avatar": avatar,
        "decoration": decoration,
        "guildTag": guild,
    }


def apply_discord_prefs(card: dict[str, Any], prefs: dict[str, Any]) -> dict[str, Any]:
    return {
        "username": card.get("username") or "",
        "globalName": card.get("globalName") or "",
        "avatar": card.get("avatar") if prefs.get("show_avatar") else None,
        "accountAvatar": card.get("avatar"),
        "decoration": card.get("decoration") if prefs.get("show_decoration") else None,
        "guildTag": card.get("guildTag") if prefs.get("show_guild_tag") else None,
    }


def normalize_presence_status(value: object) -> str | None:
    status = str(value or "").strip().lower()
    if status == "invisible":
        status = "offline"
    return status if status in PRESENCE_STATUSES else None


def discord_server_invite_url(settings: Settings | None = None) -> str:
    text = str((settings or get_settings()).discord_server_invite or "").strip()
    if text.startswith("https://discord.gg/") or text.startswith("https://discord.com/invite/"):
        return text[:160]
    return ""


def empty_discord_state(user: User) -> dict[str, Any]:
    return {
        "connected": False,
        "needsReconnect": False,
        "canDisconnect": False,
        "username": "",
        "status": None,
        "serverInvite": discord_server_invite_url(),
        "prefs": {"showAvatar": False, "showDecoration": False, "showGuildTag": False, "showStatus": False},
        "card": {"username": "", "globalName": "", "avatar": None, "accountAvatar": None, "decoration": None, "guildTag": None, "status": None},
    }


async def get_discord_presence(discord_id: str | None) -> str | None:
    user_id = str(discord_id or "").strip()
    if not SNOWFLAKE.fullmatch(user_id):
        return None
    try:
        raw = await get_dragonfly().get(f"{PRESENCE_KEY_PREFIX}{user_id}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return normalize_presence_status(data.get("status"))


async def _with_presence(user: User, state: dict[str, Any]) -> dict[str, Any]:
    prefs = state.get("prefs") if isinstance(state.get("prefs"), dict) else {}
    show = bool(prefs.get("showStatus", True))
    presence = await get_discord_presence(user.discord_id) if show else None
    next_state = dict(state)
    next_state["status"] = presence
    next_state["serverInvite"] = discord_server_invite_url()
    card = dict(next_state.get("card") or {})
    if presence:
        card["status"] = presence
    else:
        card.pop("status", None)
    next_state["card"] = card
    return next_state


async def _cache_get(user_id: str) -> dict[str, Any] | None:
    try:
        raw = await get_dragonfly().get(f"discord:live:{user_id}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def _cache_set(user_id: str, payload: dict[str, Any]) -> None:
    try:
        await get_dragonfly().set(f"discord:live:{user_id}", json.dumps(payload), ex=CACHE_TTL)
    except Exception:
        return


async def invalidate_discord_cache(user_id: str) -> None:
    try:
        await get_dragonfly().delete(f"discord:live:{user_id}")
    except Exception:
        return


async def _refresh_access(settings: Settings, refresh_token: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "misa.lol (https://misa.lol)"}) as client:
        response = await client.post(
            f"{DISCORD_API}/oauth2/token",
            data={
                "client_id": settings.discord_client_id,
                "client_secret": settings.discord_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code >= 400:
            return None
        payload = response.json()
    if not payload.get("access_token"):
        return None
    return payload


async def _fetch_me(access_token: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "misa.lol (https://misa.lol)"}) as client:
        response = await client.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if response.status_code >= 400:
            return None
        payload = response.json()
    return payload if isinstance(payload, dict) else None


def _access_valid(link: dict[str, Any]) -> bool:
    raw = link.get("access_expires_at")
    if not raw:
        return False
    try:
        stamp = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp > datetime.now(timezone.utc) + timedelta(seconds=30)


async def live_discord_state(user: User) -> dict[str, Any]:
    if not user.discord_id:
        user.discord_id = await data_api.get_user_discord_id(user.id)
    if not user.discord_id:
        return empty_discord_state(user)
    cached = await _cache_get(user.id)
    cached_card = cached.get("card") if isinstance(cached, dict) else None
    if cached and not cached.get("needsReconnect") and isinstance(cached_card, dict) and ("username" not in cached_card or not cached_card.get("accountAvatar")):
        cached = None
    if cached:
        cached["canDisconnect"] = can_unlink_discord(user)
        return await _with_presence(user, cached)
    link = await data_api.get_discord_link(user.id)
    prefs = {
        "showAvatar": True if not link else bool(link.get("show_avatar", True)),
        "showDecoration": True if not link else bool(link.get("show_decoration", True)),
        "showGuildTag": True if not link else bool(link.get("show_guild_tag", True)),
        "showStatus": True if not link else bool(link.get("show_status", True)),
    }
    if link is None:
        state = {
            "connected": True,
            "needsReconnect": True,
            "canDisconnect": can_unlink_discord(user),
            "username": "",
            "prefs": prefs,
            "card": {"username": "", "globalName": "", "avatar": None, "accountAvatar": None, "decoration": None, "guildTag": None},
        }
        await _cache_set(user.id, state)
        return await _with_presence(user, state)
    settings = get_settings()
    refresh = decrypt_secret(str(link.get("refresh_token") or ""), settings)
    access = decrypt_secret(str(link.get("access_token") or ""), settings) if _access_valid(link) else None
    tokens = None
    if not access and refresh:
        try:
            tokens = await _refresh_access(settings, refresh)
        except httpx.HTTPError:
            tokens = None
        if tokens:
            access = str(tokens.get("access_token") or "")
            new_refresh = str(tokens.get("refresh_token") or refresh)
            expires = int(tokens.get("expires_in") or 604800)
            await data_api.save_discord_link(
                user.id,
                discord_id=str(link.get("discord_id") or user.discord_id),
                refresh_token=encrypt_secret(new_refresh, settings),
                access_token=encrypt_secret(access, settings) if access else None,
                access_expires_at=datetime.now(timezone.utc) + timedelta(seconds=max(60, expires - 60)),
                show_avatar=bool(link.get("show_avatar", True)),
                show_decoration=bool(link.get("show_decoration", True)),
                show_guild_tag=bool(link.get("show_guild_tag", True)),
                show_status=bool(link.get("show_status", True)),
            )
    me = await _fetch_me(access) if access else None
    if me is None:
        state = {
            "connected": True,
            "needsReconnect": True,
            "canDisconnect": can_unlink_discord(user),
            "username": "",
            "prefs": prefs,
            "card": {"username": "", "globalName": "", "avatar": None, "accountAvatar": None, "decoration": None, "guildTag": None},
        }
        await _cache_set(user.id, state)
        return await _with_presence(user, state)
    card = parse_discord_card(me)
    state = {
        "connected": True,
        "needsReconnect": False,
        "canDisconnect": can_unlink_discord(user),
        "username": card.get("username") or "",
        "prefs": prefs,
        "card": apply_discord_prefs(card, {
            "show_avatar": prefs["showAvatar"],
            "show_decoration": prefs["showDecoration"],
            "show_guild_tag": prefs["showGuildTag"],
        }),
    }
    await _cache_set(user.id, state)
    return await _with_presence(user, state)


async def store_discord_session(user_id: str, discord_id: str, tokens: dict[str, Any], settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    refresh = str(tokens.get("refresh_token") or "")
    access = str(tokens.get("access_token") or "")
    if not refresh:
        return
    existing = await data_api.get_discord_link(user_id)
    expires = int(tokens.get("expires_in") or 604800)
    await data_api.save_discord_link(
        user_id,
        discord_id=discord_id,
        refresh_token=encrypt_secret(refresh, settings),
        access_token=encrypt_secret(access, settings) if access else None,
        access_expires_at=datetime.now(timezone.utc) + timedelta(seconds=max(60, expires - 60)),
        show_avatar=False if existing is None else bool(existing.get("show_avatar", True)),
        show_decoration=False if existing is None else bool(existing.get("show_decoration", True)),
        show_guild_tag=False if existing is None else bool(existing.get("show_guild_tag", True)),
        show_status=True if existing is None else bool(existing.get("show_status", True)),
    )
    await invalidate_discord_cache(user_id)


async def public_card_discord(user: User) -> dict[str, Any]:
    state = await live_discord_state(user)
    if not state.get("connected"):
        return {}
    card = state.get("card") if isinstance(state.get("card"), dict) else {}
    payload = {key: value for key, value in card.items() if value}
    return payload


async def public_presence_for_user(user: User) -> str | None:
    if not user.discord_id:
        user.discord_id = await data_api.get_user_discord_id(user.id)
    if not user.discord_id:
        return None
    link = await data_api.get_discord_link(user.id)
    if link is not None and not bool(link.get("show_status", True)):
        return None
    return await get_discord_presence(user.discord_id)


def safe_discord_img(url: object) -> str:
    text = str(url or "").strip()
    if text.startswith(f"{DISCORD_CDN}/") and " " not in text and len(text) <= 300:
        return escape(text, quote=True)
    return ""
