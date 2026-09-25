import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import Request

from app.core.config import get_settings
from app.core.rate_limit import client_ip
from app.core.security import USERNAME_RE
from app.core.sessions import load_session
from app.db import data_api
from app.db.dragonfly import get_dragonfly

RANGES = {"3D": 3, "7D": 7, "30D": 30, "90D": 90}
BOT_UA = re.compile(
    r"bot|crawl|spider|slurp|facebookexternalhit|facebot|discordbot|twitterbot|linkedinbot|"
    r"telegrambot|whatsapp|slackbot|embedly|preview|bingpreview|googlebot|yandex|baidu|duckduck",
    re.I,
)
REFERRER_LABELS = (
    (("instagram.com", "cdninstagram.com"), "Instagram"),
    (("discord.com", "discordapp.com"), "Discord"),
    (("youtube.com", "youtu.be"), "YouTube"),
    (("t.me", "telegram.org", "telegram.me"), "Telegram"),
    (("twitter.com", "x.com", "t.co"), "X"),
    (("tiktok.com",), "TikTok"),
    (("facebook.com", "fb.com", "fb.me"), "Facebook"),
    (("google.",), "Google"),
    (("reddit.com",), "Reddit"),
    (("linkedin.com",), "LinkedIn"),
    (("snapchat.com",), "Snapchat"),
    (("twitch.tv",), "Twitch"),
)
COUNTRY_NAMES = {
    "US": "United States",
    "GB": "United Kingdom",
    "DE": "Germany",
    "FR": "France",
    "RO": "Romania",
    "IT": "Italy",
    "ES": "Spain",
    "NL": "Netherlands",
    "PL": "Poland",
    "CA": "Canada",
    "AU": "Australia",
    "BR": "Brazil",
    "IN": "India",
    "JP": "Japan",
    "KR": "South Korea",
    "TR": "Turkey",
    "UA": "Ukraine",
    "SE": "Sweden",
    "NO": "Norway",
    "FI": "Finland",
    "DK": "Denmark",
    "AT": "Austria",
    "CH": "Switzerland",
    "BE": "Belgium",
    "CZ": "Czechia",
    "HU": "Hungary",
    "PT": "Portugal",
    "IE": "Ireland",
    "MX": "Mexico",
    "AR": "Argentina",
}


async def ingest_event(request: Request, payload: dict[str, Any]) -> None:
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in {"view", "click"}:
        return
    username = str(payload.get("username") or "").strip().lower()
    if not USERNAME_RE.fullmatch(username):
        return
    if _is_bot(request.headers.get("user-agent") or ""):
        return
    if _from_dashboard(request):
        return
    user_id = await data_api.get_user_id_by_username(username)
    if not user_id:
        return
    viewer_id = await _session_user_id(request)
    if viewer_id and viewer_id == user_id:
        return
    visitor = _visitor_hash(request)
    social_id = str(payload.get("socialId") or "")[:40] if kind == "click" else ""
    social_label = re.sub(r"[^a-zA-Z0-9 _-]", "", str(payload.get("socialLabel") or ""))[:40] if kind == "click" else ""
    if kind == "click" and not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", social_id):
        return
    dedupe_key = f"analytics:{kind}:{user_id}:{visitor}:{social_id or '-'}"
    ttl = 12 * 60 * 60 if kind == "view" else 20
    if not await _first_time(dedupe_key, ttl):
        return
    await data_api.record_profile_event(
        user_id,
        kind,
        social_id=social_id,
        social_label=social_label,
        referrer_host=_referrer_host(str(payload.get("referrer") or ""), request),
        country=_country(request),
        device=_device(str(payload.get("device") or ""), request.headers.get("user-agent") or ""),
        visitor_hash=visitor,
    )


async def summary_for_user(user_id: str, range_key: str) -> dict[str, Any]:
    days = RANGES.get(range_key.upper(), 7)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)
    current = await data_api.analytics_window(user_id, start, now)
    previous = await data_api.analytics_window(user_id, prev_start, start)
    views = int(current.get("views") or 0)
    clicks = int(current.get("clicks") or 0)
    prev_views = int(previous.get("views") or 0)
    prev_clicks = int(previous.get("clicks") or 0)
    click_rate = (clicks / views * 100) if views else 0.0
    prev_rate = (prev_clicks / prev_views * 100) if prev_views else 0.0
    series_map: dict[date, int] = {}
    for row in current.get("series") or []:
        raw = row["day"]
        key = raw.date() if isinstance(raw, datetime) else raw
        series_map[key] = int(row["views"])
    series = []
    for offset in range(days):
        day = (now - timedelta(days=days - 1 - offset)).date()
        label = day.strftime("%a") if days <= 7 else day.strftime("%d %b")
        series.append({"label": label, "views": series_map.get(day, 0)})
    devices = current.get("devices") or {}
    return {
        "range": range_key.upper() if range_key.upper() in RANGES else "7D",
        "views": views,
        "clicks": clicks,
        "clickRate": round(click_rate, 1),
        "avgDailyViews": round(views / days, 1),
        "viewsChange": _change(views, prev_views),
        "clicksChange": _change(clicks, prev_clicks),
        "clickRateChange": _change(click_rate, prev_rate),
        "avgDailyViewsChange": _change(views / days, prev_views / days),
        "series": series,
        "devices": {
            "desktop": int(devices.get("desktop") or 0),
            "mobile": int(devices.get("mobile") or 0),
            "tablet": int(devices.get("tablet") or 0),
        },
        "referrers": [
            {"label": _referrer_label(item["host"]), "count": int(item["count"])}
            for item in current.get("referrers") or []
        ],
        "socials": [
            {"id": item["id"], "label": item["label"] or item["id"], "clicks": int(item["clicks"])}
            for item in current.get("socials") or []
        ],
        "countries": [
            {"label": COUNTRY_NAMES.get(item["country"], item["country"]), "count": int(item["count"])}
            for item in current.get("countries") or []
        ],
    }


def _change(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _visitor_hash(request: Request) -> str:
    material = f"{get_settings().data_api_key or get_settings().app_name}|{client_ip(request)}|{(request.headers.get('user-agent') or '')[:180]}"
    return hashlib.sha256(material.encode()).hexdigest()[:32]


async def _session_user_id(request: Request) -> str | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    data = await load_session(token)
    value = str((data or {}).get("user_id") or "").strip()
    return value or None


async def _first_time(key: str, ttl: int) -> bool:
    try:
        return bool(await get_dragonfly().set(key, "1", ex=ttl, nx=True))
    except (RuntimeError, OSError):
        return True


def _is_bot(ua: str) -> bool:
    return bool(ua) and bool(BOT_UA.search(ua))


def _from_dashboard(request: Request) -> bool:
    referer = (request.headers.get("referer") or "").lower()
    return "/dashboard" in referer


def _country(request: Request) -> str:
    code = (request.headers.get("cf-ipcountry") or "").strip().upper()
    if len(code) == 2 and code.isalpha() and code != "XX":
        return code
    return ""


def _device(hint: str, ua: str) -> str:
    value = hint.strip().lower()
    if value in {"desktop", "mobile", "tablet"}:
        return value
    if re.search(r"ipad|tablet", ua, re.I):
        return "tablet"
    if re.search(r"mobi|iphone|android", ua, re.I):
        return "mobile"
    return "desktop"


def _referrer_host(raw: str, request: Request) -> str:
    text = (raw or request.headers.get("referer") or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        return ""
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if not host or host in {"localhost", "127.0.0.1", "misa.lol"}:
        return ""
    return host[:80]


def _referrer_label(host: str) -> str:
    value = (host or "").lower()
    if not value or value == "direct":
        return "Direct / unknown"
    for hosts, label in REFERRER_LABELS:
        if any(value == item or value.endswith(item) or item.endswith(".") and item[:-1] in value for item in hosts):
            return label
    return value
