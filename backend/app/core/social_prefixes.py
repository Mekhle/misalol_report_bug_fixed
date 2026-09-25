from __future__ import annotations

import re
from typing import Any
PLATFORM_URL_PREFIXES: dict[str, dict[str, Any]] = {
    "YouTube": {"display": "youtube.com/@", "hosts": ("youtube.com", "m.youtube.com")},
    "Discord": {"display": "discord.gg/", "hosts": ("discord.gg", "discord.com")},
    "Instagram": {"display": "instagram.com/", "hosts": ("instagram.com",)},
    "X": {"display": "x.com/", "hosts": ("x.com", "twitter.com")},
    "TikTok": {"display": "tiktok.com/@", "hosts": ("tiktok.com",)},
    "Telegram": {"display": "t.me/", "hosts": ("t.me", "telegram.me", "telegram.dog")},
    "Spotify": {"display": "open.spotify.com/", "hosts": ("open.spotify.com",)},
    "SoundCloud": {"display": "soundcloud.com/", "hosts": ("soundcloud.com",)},
    "GitHub": {"display": "github.com/", "hosts": ("github.com",)},
    "Reddit": {"display": "reddit.com/u/", "hosts": ("reddit.com",)},
    "Twitch": {"display": "twitch.tv/", "hosts": ("twitch.tv",)},
    "Snapchat": {"display": "snapchat.com/add/", "hosts": ("snapchat.com",)},
    "Facebook": {"display": "facebook.com/", "hosts": ("facebook.com", "fb.com")},
    "LinkedIn": {"display": "linkedin.com/in/", "hosts": ("linkedin.com",)},
    "Steam": {"display": "steamcommunity.com/id/", "hosts": ("steamcommunity.com",)},
    "Roblox": {"display": "roblox.com/users/", "hosts": ("roblox.com",)},
    "PayPal": {"display": "paypal.me/", "hosts": ("paypal.me", "paypal.com")},
    "Pinterest": {"display": "pinterest.com/", "hosts": ("pinterest.com",)},
    "Patreon": {"display": "patreon.com/", "hosts": ("patreon.com",)},
    "Threads": {"display": "threads.net/@", "hosts": ("threads.net",)},
    "Kick": {"display": "kick.com/", "hosts": ("kick.com",)},
}


def extract_social_handle(platform: str, value: str) -> str:
    spec = PLATFORM_URL_PREFIXES.get(platform)
    handle = (value or "").strip()
    if not spec or not handle:
        return handle
    handle = re.sub(r"^https?://", "", handle, flags=re.I)
    handle = re.sub(r"^www\.", "", handle, flags=re.I)
    prefixes = [spec["display"], *(f"{host}/" for host in spec["hosts"])]
    for prefix in prefixes:
        if handle.lower().startswith(prefix.lower()):
            handle = handle[len(prefix):]
            break
    handle = handle.lstrip("/")
    if spec["display"].endswith("@") and handle.startswith("@"):
        handle = handle[1:]
    return handle


def compose_social_value(platform: str, value: str) -> str:
    spec = PLATFORM_URL_PREFIXES.get(platform)
    if not spec:
        return (value or "").strip()
    handle = extract_social_handle(platform, value)
    return f"{spec['display']}{handle}" if handle else ""


PLATFORM_ICON_COLORS: dict[str, str] = {
    "YouTube": "#ff6b68",
    "Discord": "#8d9bff",
    "Instagram": "#ef9cbb",
    "X": "#f5f5f5",
    "TikTok": "#8ee8e0",
    "Telegram": "#73c5ea",
    "Spotify": "#7edb9a",
    "SoundCloud": "#ff8c4b",
    "GitHub": "#d6d6df",
    "Reddit": "#ff8b6b",
    "Twitch": "#c59bff",
    "Snapchat": "#ffe566",
    "Facebook": "#8bb4ff",
    "LinkedIn": "#6eb0ff",
    "Steam": "#b7c7d9",
    "Roblox": "#ffb4b4",
    "PayPal": "#7ec8ff",
    "Pinterest": "#ff8a9b",
    "Patreon": "#ff8f7a",
    "Threads": "#f0f0f0",
    "Kick": "#7dff6b",
    "Bitcoin": "#f7931a",
    "Ethereum": "#8c8cff",
    "Litecoin": "#b8b8b8",
    "Solana": "#c084fc",
    "Email": "#d8d3ff",
    "Custom URL": "#b5aaff",
}


DEFAULT_ICON_COLOR = "#d8d3ff"


def _hex_color(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith("#") and len(text) in {4, 7, 9}:
        return text
    return None


def platform_icon_color(platform: str, override: Any = None, fallback: str = DEFAULT_ICON_COLOR) -> str:
    return resolve_icon_color(platform, override, fallback)


def resolve_icon_color(platform: str, override: Any = None, global_color: Any = None, monochrome: bool = False) -> str:
    if monochrome:
        return _hex_color(global_color) or DEFAULT_ICON_COLOR
    per_link = _hex_color(override)
    if per_link:
        return per_link
    palette = _hex_color(global_color)
    if palette and palette.lower() != DEFAULT_ICON_COLOR:
        return palette
    return PLATFORM_ICON_COLORS.get(platform, palette or DEFAULT_ICON_COLOR)


def host_allowed(platform: str, hostname: str) -> bool:
    spec = PLATFORM_URL_PREFIXES.get(platform)
    if not spec:
        return True
    host = hostname.lower().removeprefix("www.")
    return host in {item.removeprefix("www.") for item in spec["hosts"]}
