import asyncio
import hashlib
import json
import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.core.config import get_settings
from app.core.network_safety import safe_public_url
from app.core.profile_sanitize import sanitize_widgets, sanitize_sections
from app.db.dragonfly import get_dragonfly

WIDGET_TYPES = ("youtube", "spotify", "discord", "telegram", "roblox", "github", "lastfm", "timezone", "weather")
CACHE_TTL = 600
TIME_TTL = 30
HANDLE = re.compile(r"^[A-Za-z0-9_.-]{2,64}$")
INVITE = re.compile(r"^[A-Za-z0-9-]{2,32}$")
CITY = re.compile(r"^[A-Za-z0-9 .,'-]{2,80}$")
WEATHER_LABELS = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Drizzle",
    61: "Rain",
    71: "Snow",
    80: "Showers",
    95: "Thunderstorm",
}


def _https(url: Any) -> str | None:
    text = str(url or "").strip()
    if len(text) > 500:
        return None
    return safe_public_url(text, https_only=True)


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _cache_key(kind: str, value: str) -> str:
    digest = hashlib.sha256(f"{kind}:{value.lower()}".encode()).hexdigest()[:32]
    return f"widget:{kind}:{digest}"


async def _cached(kind: str, value: str, ttl: int, loader) -> dict[str, Any]:
    key = _cache_key(kind, value)
    redis = None
    try:
        redis = get_dragonfly()
        raw = await redis.get(key)
        if raw:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data
    except Exception:
        redis = None
    data = await loader()
    keep_for = 120 if data.get("status") == "error" else ttl
    if redis is not None and data.get("status") != "empty":
        try:
            await redis.set(key, json.dumps(data), ex=keep_for)
        except Exception:
            pass
    return data


def safe_widget_url(url: Any) -> str | None:
    return _https(url)


def profile_widget_inputs(config):
    items = sanitize_widgets(config.get("widgets"))
    for section in sanitize_sections(config.get("sections")):
        if not section.get("enabled"):
            continue
        for side, suffix in (("leftCard", "l"), ("rightCard", "r")):
            card = section.get(side)
            if card and card.get("enabled") and card.get("type") != "presence":
                items.append({**card, "id": str(section["id"])[:38] + "-" + suffix})
    return items


async def resolve_profile_widgets(config: dict[str, Any], include_empty: bool = False) -> list[dict[str, Any]]:
    pending: list[dict[str, Any]] = []
    for item in profile_widget_inputs(config):
        if not item.get("enabled"):
            continue
        if not include_empty and not str(item.get("value") or "").strip():
            continue
        pending.append(item)
    if not pending:
        return []
    # Repeated left/right cards can share a provider input; resolve it once.
    unique = {(item["type"], item["value"]): item for item in pending}
    values = await asyncio.gather(*(resolve_widget(item) for item in unique.values()))
    resolved = dict(zip(unique, values))
    return [{**resolved[(item["type"], item["value"])], "id": item["id"]} for item in pending]


async def resolve_widget(item: dict[str, Any]) -> dict[str, Any]:
    kind = str(item.get("type") or "")
    value = str(item.get("value") or "").strip()
    base = {"id": item.get("id"), "type": kind, "value": value, "status": "empty", "title": "", "subtitle": "", "image": None, "href": None, "meta": {}}
    if not value:
        return {**base, "status": "empty", "subtitle": "Add a value in Customize."}
    try:
        if kind == "timezone":
            data = await _cached(kind, value, TIME_TTL, lambda: _timezone(value))
        else:
            data = await _cached(kind, value, CACHE_TTL, lambda: _fetch(kind, value))
    except Exception:
        return {**base, "status": "error", "title": kind.title(), "subtitle": "Could not load this widget."}
    return {**base, **data}


async def _fetch(kind: str, value: str) -> dict[str, Any]:
    if kind == "youtube":
        return await _youtube(value)
    if kind == "spotify":
        return await _spotify(value)
    if kind == "discord":
        return await _discord(value)
    if kind == "telegram":
        return await _telegram(value)
    if kind == "roblox":
        return await _roblox(value)
    if kind == "github":
        return await _github(value)
    if kind == "lastfm":
        return await _lastfm(value)
    if kind == "weather":
        return await _weather(value)
    return {"status": "error", "title": "Widget", "subtitle": "Unknown widget."}


async def _get(url: str, **kwargs: Any) -> httpx.Response:
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=False, trust_env=False, headers={"User-Agent": "misa.lol profile widgets"}) as client:
        return await client.get(url, **kwargs)


async def _post(url: str, **kwargs: Any) -> httpx.Response:
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=False, trust_env=False, headers={"User-Agent": "misa.lol profile widgets"}) as client:
        return await client.post(url, **kwargs)


async def _oembed(endpoint: str, url: str) -> dict[str, Any] | None:
    response = await _get(endpoint, params={"url": url, "format": "json"})
    if response.status_code >= 400:
        return None
    data = response.json()
    return data if isinstance(data, dict) else None


def _youtube_url(value: str) -> str | None:
    text = value if "://" in value else f"https://{value}"
    host = _host(text)
    if host in {"youtu.be", "www.youtu.be"}:
        return text
    if host in {"youtube.com", "youtube-nocookie.com"} or host.endswith((".youtube.com", ".youtube-nocookie.com")):
        return text
    return None


async def _youtube(value: str) -> dict[str, Any]:
    url = _youtube_url(value)
    if not url:
        return {"status": "error", "title": "YouTube", "subtitle": "Use a YouTube video or channel URL."}
    data = await _oembed("https://www.youtube.com/oembed", url)
    if not data:
        path = urlparse(url).path
        if path.startswith(("/@", "/channel/", "/c/", "/user/")) and _https(url):
            return {"status": "ok", "title": path.rstrip("/").split("/")[-1][:80], "subtitle": "YouTube channel · open profile", "image": None, "href": _https(url), "meta": {"provider": "YouTube"}}
        return {"status": "error", "title": "YouTube", "subtitle": "YouTube did not return that page."}
    href = _https(url)
    return {
        "status": "ok",
        "title": str(data.get("title") or "YouTube")[:80],
        "subtitle": str(data.get("author_name") or "YouTube")[:80],
        "image": _https(data.get("thumbnail_url")),
        "href": href,
        "meta": {"provider": "YouTube"},
    }


def _spotify_url(value: str) -> str | None:
    text = value if "://" in value else f"https://{value}"
    if _host(text) != "open.spotify.com":
        return None
    return text


async def _spotify(value: str) -> dict[str, Any]:
    url = _spotify_url(value)
    if not url:
        return {"status": "error", "title": "Spotify", "subtitle": "Use an open.spotify.com link."}
    data = await _oembed("https://open.spotify.com/oembed", url)
    if not data:
        return {"status": "error", "title": "Spotify", "subtitle": "Spotify did not return that link."}
    return {
        "status": "ok",
        "title": str(data.get("title") or "Spotify")[:80],
        "subtitle": "Spotify",
        "image": _https(data.get("thumbnail_url")),
        "href": _https(url),
        "meta": {"provider": "Spotify"},
    }


def _invite_code(value: str) -> str | None:
    text = value.strip()
    if INVITE.fullmatch(text):
        return text
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]
    if host in {"discord.gg", "www.discord.gg"} and parts:
        return parts[0] if INVITE.fullmatch(parts[0]) else None
    if host in {"discord.com", "www.discord.com"} and len(parts) >= 2 and parts[0] == "invite":
        return parts[1] if INVITE.fullmatch(parts[1]) else None
    return None


async def _discord(value: str) -> dict[str, Any]:
    code = _invite_code(value)
    if not code:
        return {"status": "error", "title": "Discord", "subtitle": "Use a discord.gg invite."}
    response = await _get(f"https://discord.com/api/v10/invites/{code}", params={"with_counts": "true"})
    if response.status_code >= 400:
        return {"status": "error", "title": "Discord", "subtitle": "That invite is invalid or expired."}
    data = response.json()
    guild = data.get("guild") if isinstance(data.get("guild"), dict) else {}
    icon = None
    if guild.get("id") and guild.get("icon"):
        icon = _https(f"https://cdn.discordapp.com/icons/{guild['id']}/{guild['icon']}.png?size=128")
    members = data.get("approximate_member_count")
    subtitle = f"{int(members):,} members" if isinstance(members, int) else "Discord server"
    return {
        "status": "ok",
        "title": str(guild.get("name") or "Discord server")[:80],
        "subtitle": subtitle,
        "image": icon,
        "href": _https(f"https://discord.gg/{code}"),
        "meta": {"provider": "Discord"},
    }


def _telegram_handle(value: str) -> str | None:
    text = value.strip().lstrip("@")
    parsed = urlparse(text if "://" in text else f"https://{text}")
    if parsed.hostname in {"t.me", "www.t.me", "telegram.me"}:
        parts = [part for part in parsed.path.split("/") if part and part not in {"s", "joinchat"}]
        text = parts[0] if parts else ""
    return text if HANDLE.fullmatch(text) else None


async def _telegram(value: str) -> dict[str, Any]:
    handle = _telegram_handle(value)
    if not handle:
        return {"status": "error", "title": "Telegram", "subtitle": "Use a @username or t.me link."}
    href = _https(f"https://t.me/{handle}")
    token = get_settings().telegram_bot_token
    if token:
        try:
            response = await _get(f"https://api.telegram.org/bot{token}/getChat", params={"chat_id": f"@{handle}"})
            payload = response.json() if response.status_code < 500 else {}
            chat = payload.get("result") if isinstance(payload, dict) and payload.get("ok") else None
            if isinstance(chat, dict):
                title = str(chat.get("title") or chat.get("username") or handle)[:80]
                subtitle = str(chat.get("type") or "Telegram")[:40]
                return {"status": "ok", "title": title, "subtitle": subtitle, "image": None, "href": href, "meta": {"provider": "Telegram"}}
        except httpx.HTTPError:
            pass
    return {"status": "ok", "title": f"@{handle}", "subtitle": "Telegram", "image": None, "href": href, "meta": {"provider": "Telegram"}}


async def _roblox(value: str) -> dict[str, Any]:
    text = value.strip()
    parsed = urlparse(text if "://" in text else f"https://{text}")
    user_id = None
    username = text
    if "roblox.com" in (parsed.hostname or "") and "/users/" in parsed.path:
        parts = parsed.path.split("/")
        if "users" in parts:
            idx = parts.index("users")
            if idx + 1 < len(parts) and parts[idx + 1].isdigit():
                user_id = parts[idx + 1]
    if user_id is None:
        if not HANDLE.fullmatch(username.split("/")[-1]):
            return {"status": "error", "title": "Roblox", "subtitle": "Use a Roblox username."}
        response = await _post("https://users.roblox.com/v1/usernames/users", json={"usernames": [username.split("/")[-1]], "excludeBannedUsers": True})
        rows = (response.json() or {}).get("data") if response.status_code < 400 else None
        if not rows:
            return {"status": "error", "title": "Roblox", "subtitle": "That Roblox user was not found."}
        user_id = str(rows[0].get("id") or "")
        username = str(rows[0].get("name") or username)
    profile = await _get(f"https://users.roblox.com/v1/users/{user_id}")
    if profile.status_code >= 400:
        return {"status": "error", "title": "Roblox", "subtitle": "That Roblox user was not found."}
    info = profile.json()
    thumb = await _get("https://thumbnails.roblox.com/v1/users/avatar-headshot", params={"userIds": user_id, "size": "150x150", "format": "Png", "isCircular": "false"})
    image = None
    if thumb.status_code < 400:
        rows = (thumb.json() or {}).get("data") or []
        if rows:
            image = _https(rows[0].get("imageUrl"))
    return {
        "status": "ok",
        "title": str(info.get("displayName") or info.get("name") or username)[:80],
        "subtitle": f"@{info.get('name') or username}",
        "image": image,
        "href": _https(f"https://www.roblox.com/users/{user_id}/profile"),
        "meta": {"provider": "Roblox"},
    }


async def _github(value: str) -> dict[str, Any]:
    login = value.strip().rstrip("/")
    parsed = urlparse(login if "://" in login else f"https://{login}")
    if "github.com" in (parsed.hostname or ""):
        parts = [part for part in parsed.path.split("/") if part]
        login = parts[0] if parts else ""
    if not HANDLE.fullmatch(login):
        return {"status": "error", "title": "GitHub", "subtitle": "Use a GitHub username."}
    response = await _get(f"https://api.github.com/users/{login}")
    if response.status_code >= 400:
        return {"status": "error", "title": "GitHub", "subtitle": "That GitHub user was not found."}
    data = response.json()
    return {
        "status": "ok",
        "title": str(data.get("name") or data.get("login") or login)[:80],
        "subtitle": f"{int(data.get('public_repos') or 0)} repos · {int(data.get('followers') or 0)} followers",
        "image": _https(data.get("avatar_url")),
        "href": _https(data.get("html_url") or f"https://github.com/{login}"),
        "meta": {"provider": "GitHub"},
    }


async def _lastfm(value: str) -> dict[str, Any]:
    key = get_settings().lastfm_api_key
    if not key:
        return {"status": "error", "title": "Last.fm", "subtitle": "Last.fm is not configured on the server."}
    user = value.strip().rstrip("/")
    parsed = urlparse(user if "://" in user else f"https://{user}")
    if "last.fm" in (parsed.hostname or ""):
        parts = [part for part in parsed.path.split("/") if part]
        user = parts[1] if len(parts) >= 2 and parts[0] == "user" else (parts[0] if parts else "")
    if not HANDLE.fullmatch(user):
        return {"status": "error", "title": "Last.fm", "subtitle": "Use a Last.fm username."}
    response = await _get(
        "https://ws.audioscrobbler.com/2.0/",
        params={"method": "user.getrecenttracks", "user": user, "api_key": key, "format": "json", "limit": "1"},
    )
    if response.status_code >= 400:
        return {"status": "error", "title": "Last.fm", "subtitle": "Last.fm did not return that user."}
    payload = response.json()
    tracks = (((payload.get("recenttracks") or {}).get("track")) or [])
    track = tracks[0] if tracks else None
    if not isinstance(track, dict):
        return {"status": "ok", "title": user, "subtitle": "No recent tracks", "image": None, "href": _https(f"https://www.last.fm/user/{user}"), "meta": {"provider": "Last.fm"}}
    image = None
    for item in track.get("image") or []:
        if item.get("size") == "large":
            image = _https(item.get("#text"))
    artist = track.get("artist")
    artist_name = artist.get("#text") if isinstance(artist, dict) else artist
    now = (track.get("@attr") or {}).get("nowplaying") == "true"
    return {
        "status": "ok",
        "title": str(track.get("name") or "Last.fm")[:80],
        "subtitle": f"{'Now playing' if now else 'Last played'} · {artist_name or user}"[:80],
        "image": image,
        "href": _https((track.get("url") or f"https://www.last.fm/user/{user}")),
        "meta": {"provider": "Last.fm"},
    }


async def _timezone(value: str) -> dict[str, Any]:
    try:
        zone = ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return {"status": "error", "title": "Time", "subtitle": "Use an IANA timezone like Europe/London."}
    now = datetime.now(zone)
    return {
        "status": "ok",
        "title": now.strftime("%H:%M"),
        "subtitle": value.replace("_", " "),
        "image": None,
        "href": None,
        "meta": {"provider": "Timezone", "iso": now.isoformat(), "timezone": value},
    }


async def _weather(value: str) -> dict[str, Any]:
    city = value.strip()
    if not CITY.fullmatch(city):
        return {"status": "error", "title": "Weather", "subtitle": "Use a city name."}
    geo = await _get("https://geocoding-api.open-meteo.com/v1/search", params={"name": city, "count": 1, "language": "en", "format": "json"})
    results = (geo.json() or {}).get("results") if geo.status_code < 400 else None
    if not results:
        return {"status": "error", "title": "Weather", "subtitle": "That city was not found."}
    place = results[0]
    forecast = await _get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": place.get("latitude"),
            "longitude": place.get("longitude"),
            "current": "temperature_2m,weather_code",
            "timezone": "auto",
        },
    )
    if forecast.status_code >= 400:
        return {"status": "error", "title": "Weather", "subtitle": "Weather is unavailable right now."}
    current = (forecast.json() or {}).get("current") or {}
    code = int(current.get("weather_code") or 0)
    temp = current.get("temperature_2m")
    label = WEATHER_LABELS.get(code, "Weather")
    name = ", ".join(part for part in [place.get("name"), place.get("country_code")] if part)
    return {
        "status": "ok",
        "title": f"{round(float(temp))}°" if temp is not None else label,
        "subtitle": f"{label} · {name}"[:80],
        "image": None,
        "href": None,
        "meta": {"provider": "Weather"},
    }
