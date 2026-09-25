from app.core.element_layout import normalize_layouts

import base64
import re
from typing import Any
from urllib.parse import urlparse

from app.core.network_safety import safe_media_url, safe_public_url
from app.core.social_prefixes import compose_social_value, host_allowed

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
SAFE_ICON = re.compile(r"^data:image/(?:png|jpeg|jpg|webp|gif|ico|x-icon|vnd\.microsoft\.icon);base64,", re.I)
SAFE_VIDEO = re.compile(r"^data:video/(?:mp4|webm|quicktime|x-m4v);base64,", re.I)
SAFE_AUDIO = re.compile(r"^data:audio/(?:mpeg|mp3|wav|ogg|webm|mp4|x-m4a|m4a|aac|x-wav);base64,", re.I)
SAFE_FONT = re.compile(
    r"^data:(?:font/(?:woff2?|ttf|otf|opentype|sfnt)|application/(?:font-woff2?|x-font-ttf|x-font-otf|x-font-woff|vnd\.ms-opentype));base64,",
    re.I,
)
DATA_URL = re.compile(r"^data:([^;,]+);base64,(.+)$", re.I | re.S)
MAX_SOCIALS = 40
MAX_BADGES = 40
MAX_WIDGETS = 8
MAX_SECTIONS = 12
SECTION_TYPES = ("about", "project", "skills", "text", "lyrics", "integration")
SECTION_ID = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")
MAX_SECTION_BODY = {
    "about": 4000,
    "project": 400,
    "skills": 200,
    "text": 2000,
    "lyrics": 8000,
}
MAX_VALUE = 500
WIDGET_TYPES = ("youtube", "spotify", "discord", "telegram", "roblox", "github", "lastfm", "timezone", "weather")
WIDGET_ID = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")
WIDGET_HANDLE = re.compile(r"^[A-Za-z0-9_.-]{2,64}$")
WIDGET_INVITE = re.compile(r"^[A-Za-z0-9-]{2,32}$")
WIDGET_CITY = re.compile(r"^[A-Za-z0-9 .,'-]{2,80}$")
MAX_ICON = 1_100_000
# R2 keeps the original bytes; these limits only protect the API from abusive uploads.
MAX_ASSET = 40_000_000
# Legacy data URLs need base64 headroom. New uploads are stored as untouched R2 objects.
MAX_VIDEO_ASSET = 145_000_000
MAX_FONT = 2_800_000
KEEP_ASSET_URL = "misa:keep"
REMOVE_ASSET_URL = "misa:remove"
ASSET_KINDS = ("avatar", "banner", "background", "cursor", "backgroundVideo", "backgroundEffectVideo", "audio", "audioArtwork", "ogImage", "favicon", "customFont", "clickSound", "entryIcon")
ASSET_KEYS = ("avatar", "banner", "background", "backgroundVideo", "backgroundEffectVideo", "audio", "audioArtwork", "cursor", "ogImage", "favicon", "customFont", "clickSound", "entryIcon")
BACKGROUND_EFFECTS = {"None", "Snowflakes", "Snow", "Sakura", "Rain", "Fireflies"}
USERNAME_EFFECTS = {"None", "Glow", "Gradient", "Shimmer", "Rainbow", "Fuzzy", "Shuffle", "Sparkle", "Glitch", "Pulse", "Wave", "Shadow"}
PROFILE_FONTS = {"Inter", "font-2", "font-3", "font-4", "font-5", "font-6", "font-7", "font-8", "font-9", "font-10", "font-11"}
PAGE_ENTERS = {"None", "Fade", "Unfold", "Pop"}
ASSET_KIND_TYPES = {
    "avatar": "image",
    "banner": "image",
    "background": "image",
    "cursor": "image",
    "backgroundVideo": "video",
    "backgroundEffectVideo": "video",
    "audio": "audio",
    "audioArtwork": "image",
    "ogImage": "image",
    "favicon": "image",
    "customFont": "font",
    "clickSound": "audio",
    "entryIcon": "image",
}


def sanitize_profile_config(payload: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(payload)
    cleaned.pop("discord", None)
    cleaned.pop("rank", None)
    settings = cleaned.get("settings")
    cleaned["settings"] = _sanitize_settings(settings if isinstance(settings, dict) else {})
    profile = cleaned.get("profile")
    if isinstance(profile, dict):
        identity = dict(profile)
        joined = str(identity.get("joinedAt") or "").strip()[:40]
        identity["joinedAt"] = joined if joined else ""
        cleaned["profile"] = identity
    assets = cleaned.get("assets")
    if isinstance(assets, dict):
        cleaned["assets"] = _sanitize_assets(assets)
    socials = cleaned.get("socials")
    if isinstance(socials, list):
        seen: set[str] = set()
        next_socials: list[dict[str, Any]] = []
        for index, item in enumerate(socials):
            if not isinstance(item, dict):
                continue
            social = _sanitize_social(item, index)
            if social["id"] in seen:
                social["id"] = f"{social['id']}-{index}"[:80]
            seen.add(social["id"])
            next_socials.append(social)
            if len(next_socials) >= MAX_SOCIALS:
                break
        cleaned["socials"] = next_socials
    cleaned["badges"] = _sanitize_badges(cleaned.get("badges"))
    cleaned["widgets"] = sanitize_widgets(cleaned.get("widgets"))
    cleaned["sections"] = sanitize_sections(cleaned.get("sections"))
    return cleaned


def _sanitize_settings(settings: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(settings)
    from app.core.premium import normalize_premium
    premium = normalize_premium(cleaned.get("premium"))
    if premium is not None:
        cleaned["premium"] = premium
    else:
        cleaned.pop("premium", None)
    if "elementLayouts" in cleaned:
        layouts = normalize_layouts(cleaned["elementLayouts"])
        if layouts is None:
            cleaned.pop("elementLayouts", None)
        else:
            cleaned["elementLayouts"] = layouts
    align = cleaned.get("socialAlign")
    cleaned["socialAlign"] = align if align in {"left", "center", "right"} else "center"
    card_align = cleaned.get("cardAlign")
    cleaned["cardAlign"] = card_align if card_align in {"left", "center", "right"} else "center"
    cleaned["layout"] = cleaned.get("layout") if cleaned.get("layout") in {"Default", "Modern", "Simplistic", "Sleek", "Portfolio"} else "Modern"
    cleaned["avatarShape"] = cleaned.get("avatarShape") if cleaned.get("avatarShape") in {"circle", "rounded", "square"} else "circle"
    cleaned["bannerShape"] = cleaned.get("bannerShape") if cleaned.get("bannerShape") in {"rounded", "square", "pill"} else "rounded"
    cleaned["buttonStyle"] = cleaned.get("buttonStyle") if cleaned.get("buttonStyle") in {"glass", "solid", "outline"} else "glass"
    cleaned["profileFont"] = cleaned.get("profileFont") if cleaned.get("profileFont") in PROFILE_FONTS else "Inter"
    # Kept for backwards-compatible stored data, but custom/default fonts are now display-name only.
    cleaned["profileFontScope"] = "all" if cleaned.get("profileFontScope") == "all" else "name"
    cleaned["pageEnter"] = cleaned.get("pageEnter") if cleaned.get("pageEnter") in PAGE_ENTERS else "Fade"
    for key, default in (
        ("accentColor", "#9b87f5"),
        ("usernameColor", "#ffffff"),
        ("usernameEffectColor", "#e11d48"),
        ("textColor", "#ffffff"),
        ("backgroundColor", "#08080d"),
        ("iconColor", "#d8d3ff"),
        ("borderColor", "#ffffff"),
    ):
        value = cleaned.get(key)
        cleaned[key] = value if isinstance(value, str) and HEX_COLOR.match(value) else default
    cleaned["backgroundEffect"] = cleaned.get("backgroundEffect") if cleaned.get("backgroundEffect") in BACKGROUND_EFFECTS else "None"
    cleaned["usernameEffect"] = cleaned.get("usernameEffect") if cleaned.get("usernameEffect") in USERNAME_EFFECTS else "Glow"
    for key, default in (
        ("usernameGlow", True),
        ("socialGlow", True),
        ("badgeGlow", True),
        ("profileGradient", True),
        ("showViews", True),
        ("showBadges", True),
        ("showSocials", True),
        ("showJoinDate", False),
        ("showDiscordStatus", True),
        ("showUsername", True),
        ("showProfileFrame", True),
        ("showAvatar", True),
        ("showAvatarBorder", True),
        ("showDisplayName", True),
        ("cardTilt", False),
        ("entryScreen", True),
        ("bioTypewriter", False),
        ("tabTitleAnimate", False),
        ("clickSound", False),
        ("monochromeIcons", False),
        ("widgetColorSwap", False),
        ("ogOverlayAvatar", True),
        ("ogOverlayName", True),
        ("ogOverlayAddress", True),
    ):
        cleaned[key] = bool(cleaned[key]) if key in cleaned else default
    cleaned["profileOpacity"] = _clamp_int(cleaned.get("profileOpacity"), 10, 0, 80)
    cleaned["backgroundOpacity"] = _clamp_int(cleaned.get("backgroundOpacity"), 88, 20, 100)
    cleaned["profileBlur"] = _clamp_int(cleaned.get("profileBlur"), 24, 0, 40)
    cleaned["profileRadius"] = _clamp_int(cleaned.get("profileRadius"), 24, 0, 80)
    cleaned["profileFrameOpacity"] = _clamp_int(cleaned.get("profileFrameOpacity"), 100, 0, 100)
    cleaned["profileFrameScale"] = _clamp_int(cleaned.get("profileFrameScale"), 100, 50, 150)
    cleaned["profileFrameWidth"] = _clamp_int(cleaned.get("profileFrameWidth"), 430, 260, 800)
    frame_height = _clamp_int(cleaned.get("profileFrameHeight"), 0, 0, 1000)
    cleaned["profileFrameHeight"] = frame_height if frame_height >= 200 else 0
    cleaned["profileFrameX"] = _clamp_int(cleaned.get("profileFrameX"), 0, -45, 45)
    cleaned["profileFrameY"] = _clamp_int(cleaned.get("profileFrameY"), 0, -45, 45)
    cleaned["borderWidth"] = _clamp_int(cleaned.get("borderWidth"), 1, 0, 8)
    cleaned["fontSize"] = _clamp_int(cleaned.get("fontSize"), 16, 12, 22)
    cleaned["letterSpacing"] = _clamp_int(cleaned.get("letterSpacing"), 0, -2, 8)
    cleaned["bioTypeMs"] = _clamp_int(cleaned.get("bioTypeMs"), 55, 20, 160)
    cleaned["bioDeleteMs"] = _clamp_int(cleaned.get("bioDeleteMs"), 35, 20, 160)
    cleaned["bioPauseMs"] = _clamp_int(cleaned.get("bioPauseMs"), 1200, 400, 4000)
    cleaned["entryText"] = str(cleaned.get("entryText") or "click to enter...")[:160]
    cleaned["ogTitle"] = _plain_text(cleaned.get("ogTitle"), 70)
    cleaned["ogDescription"] = _plain_text(cleaned.get("ogDescription"), 200)
    return cleaned


def _sanitize_assets(assets: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(assets)
    for key, kind in (
        ("avatar", "image"),
        ("banner", "image"),
        ("background", "image"),
        ("cursor", "image"),
        ("ogImage", "image"),
        ("favicon", "image"),
        ("customFont", "font"),
        ("clickSound", "audio"),
        ("entryIcon", "image"),
        ("backgroundVideo", "video"),
        ("backgroundEffectVideo", "video"),
        ("audio", "audio"),
        ("audioArtwork", "image"),
    ):
        item = cleaned.get(key)
        if not isinstance(item, dict):
            if key in {"audioArtwork", "ogImage", "favicon", "customFont", "clickSound", "backgroundEffectVideo"}:
                cleaned[key] = {"url": None, "name": "", "type": ""}
            continue
        cleaned[key] = {
            "url": _safe_asset_url(item.get("url"), kind),
            "name": str(item.get("name") or "")[:80],
            "type": str(item.get("type") or "")[:40],
        }
    cleaned["audioTitle"] = str(cleaned.get("audioTitle") or "")[:80]
    if "audioEnabled" in cleaned:
        cleaned["audioEnabled"] = bool(cleaned["audioEnabled"])
    if "volume" in cleaned:
        cleaned["volume"] = _clamp_int(cleaned.get("volume"), 65, 0, 100)
    cleaned["tracks"] = _sanitize_tracks(cleaned)
    source = str(cleaned.get("audioSource") or "").strip().lower()
    if source not in {"video", "standalone", "tracks"}:
        source = "tracks" if cleaned["tracks"] else "standalone" if (cleaned.get("audio") or {}).get("url") else "video"
    cleaned["audioSource"] = source
    if cleaned["tracks"] and source == "tracks":
        first = cleaned["tracks"][0]
        cleaned["audio"] = {
            "url": None,
            "name": str(first["audio"].get("name") or "")[:80],
            "type": str(first["audio"].get("type") or "")[:40],
        }
        cleaned["audioArtwork"] = {
            "url": None,
            "name": str(first["artwork"].get("name") or "")[:80],
            "type": str(first["artwork"].get("type") or "")[:40],
        }
        cleaned["audioTitle"] = first["title"]
        cleaned["audioSource"] = "tracks"
    return cleaned


def merge_kept_profile(incoming: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(incoming, dict) or not isinstance(stored, dict):
        return incoming
    merged = dict(incoming)
    incoming_assets = incoming.get("assets") if isinstance(incoming.get("assets"), dict) else {}
    stored_assets = stored.get("assets") if isinstance(stored.get("assets"), dict) else {}
    # A partial save may omit an asset key entirely. Start from the stored
    # assets so an omitted key cannot accidentally delete previously uploaded media.
    assets = dict(stored_assets)
    assets.update(incoming_assets)
    for key in ASSET_KEYS:
        if key in incoming_assets:
            assets[key] = _merge_asset(incoming_assets.get(key), stored_assets.get(key))
    stored_tracks = {
        str(track.get("id")): track
        for track in stored_assets.get("tracks") or []
        if isinstance(track, dict) and track.get("id")
    }
    if "tracks" in incoming_assets:
        tracks: list[dict[str, Any]] = []
        for track in incoming_assets.get("tracks") or []:
            if not isinstance(track, dict):
                continue
            previous = stored_tracks.get(str(track.get("id") or ""))
            if previous is None and not stored_tracks:
                previous = {"audio": stored_assets.get("audio"), "artwork": stored_assets.get("audioArtwork")}
            item = dict(track)
            item["audio"] = _merge_asset(track.get("audio"), (previous or {}).get("audio"))
            item["artwork"] = _merge_asset(track.get("artwork"), (previous or {}).get("artwork"))
            tracks.append(item)
        assets["tracks"] = tracks
    elif "tracks" in stored_assets:
        assets["tracks"] = list(stored_assets.get("tracks") or [])
    merged["assets"] = assets

    if "sections" not in incoming:
        merged["sections"] = list(stored.get("sections") or [])
        return merged
    stored_sections = {
        str(item.get("id")): item
        for item in stored.get("sections") or []
        if isinstance(item, dict) and item.get("id")
    }
    sections: list[dict[str, Any]] = []
    for item in incoming.get("sections") or []:
        if not isinstance(item, dict):
            continue
        previous = stored_sections.get(str(item.get("id") or ""))
        next_item = dict(item)
        next_item["cover"] = _merge_asset(item.get("cover"), (previous or {}).get("cover"))
        sections.append(next_item)
    merged["sections"] = sections
    return merged

def _merge_asset(incoming: Any, stored: Any) -> dict[str, Any]:
    current = dict(incoming) if isinstance(incoming, dict) else {"url": None}
    previous = stored if isinstance(stored, dict) else {}
    if current.get("remove") is True or current.get("url") == REMOVE_ASSET_URL:
        current["url"] = None
        current.pop("remove", None)
        return current
    if current.get("url") in {KEEP_ASSET_URL, None, ""} and previous.get("url"):
        current["url"] = previous.get("url")
        for field in ("name", "type"):
            if not current.get(field) and previous.get(field):
                current[field] = previous[field]
    current.pop("remove", None)
    return current

def safe_asset_url(url: Any, kind: str) -> str | None:
    return _safe_asset_url(url, kind)


def _safe_asset_url(url: Any, kind: str) -> str | None:
    text = str(url or "").strip()
    if not text:
        return None
    from app.core.config import get_settings
    from app.core.r2_storage import get_r2_storage
    settings = get_settings()
    storage = get_r2_storage(settings)
    if not storage.r2_configured or settings.environment == "development" or settings.debug:
        if text.startswith("/api/v1/profile/uploads/") or ("/api/v1/profile/uploads/" in text):
            return text
    if text.startswith("data:"):
        pattern = {"image": SAFE_ICON, "video": SAFE_VIDEO, "audio": SAFE_AUDIO, "font": SAFE_FONT}.get(kind)
        if pattern is None:
            return None
        limit = MAX_FONT if kind == "font" else MAX_VIDEO_ASSET if kind == "video" else MAX_ASSET
        return text if pattern.match(text) and len(text) <= limit else None
    return safe_media_url(text)


def _clamp_int(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def _plain_text(value: Any, limit: int) -> str:
    text = re.sub(r"<[^>]*>", "", str(value or ""))
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or (ch >= " " and ch != "\x7f"))
    return " ".join(text.split())[:limit]


def is_safe_social_icon(url: str | None) -> bool:
    if not url:
        return False
    from app.core.config import get_settings
    from app.core.r2_storage import get_r2_storage
    settings = get_settings()
    storage = get_r2_storage(settings)
    if not storage.r2_configured or settings.environment == "development" or settings.debug:
        if "/api/v1/profile/uploads/" in url or url.startswith("/api/v1/profile/uploads/"):
            return True
    return bool(url and SAFE_ICON.match(url) and len(url) <= MAX_ICON)


def has_public_asset(assets: dict[str, Any] | None, key: str, kind: str) -> bool:
    item = (assets or {}).get(key)
    url = str((item or {}).get("url") or "") if isinstance(item, dict) else ""
    return bool(_safe_asset_url(url, kind))


TRACK_ID = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")


def _max_tracks() -> int:
    try:
        from app.core.config import get_settings
        return max(1, min(20, int(get_settings().max_profile_tracks)))
    except Exception:
        return 8


def _sanitize_tracks(assets: dict[str, Any]) -> list[dict[str, Any]]:
    raw = assets.get("tracks")
    tracks: list[dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(raw, list):
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            audio = item.get("audio") if isinstance(item.get("audio"), dict) else item
            artwork = item.get("artwork") if isinstance(item.get("artwork"), dict) else {}
            audio_url = _safe_asset_url((audio or {}).get("url"), "audio")
            if not audio_url:
                continue
            raw_id = str(item.get("id") or "").strip()
            track_id = raw_id if TRACK_ID.fullmatch(raw_id) else f"track-{index + 1}"
            if track_id in seen:
                track_id = f"{track_id}-{index + 1}"[:40]
            seen.add(track_id)
            title = str(item.get("title") or (audio or {}).get("name") or "").replace("\\", "").strip()[:80]
            if not title:
                title = str((audio or {}).get("name") or "Track").rsplit(".", 1)[0][:80] or "Track"
            tracks.append({
                "id": track_id,
                "title": title,
                "recording": sanitize_recording(item.get("recording")),
                "audio": {
                    "url": audio_url,
                    "name": str((audio or {}).get("name") or "")[:80],
                    "type": str((audio or {}).get("type") or "")[:40],
                },
                "artwork": {
                    "url": _safe_asset_url(artwork.get("url"), "image"),
                    "name": str(artwork.get("name") or "")[:80],
                    "type": str(artwork.get("type") or "")[:40],
                },
            })
            if len(tracks) >= _max_tracks():
                break
    if not tracks:
        audio_url = _safe_asset_url((assets.get("audio") or {}).get("url") if isinstance(assets.get("audio"), dict) else None, "audio")
        if audio_url:
            audio = assets.get("audio") if isinstance(assets.get("audio"), dict) else {}
            artwork = assets.get("audioArtwork") if isinstance(assets.get("audioArtwork"), dict) else {}
            title = str(assets.get("audioTitle") or audio.get("name") or "Track").rsplit(".", 1)[0][:80] or "Track"
            tracks.append({
                "id": "track-1",
                "title": title,
                "audio": {"url": audio_url, "name": str(audio.get("name") or "")[:80], "type": str(audio.get("type") or "")[:40]},
                "artwork": {"url": _safe_asset_url(artwork.get("url"), "image"), "name": str(artwork.get("name") or "")[:80], "type": str(artwork.get("type") or "")[:40]},
            })
    return tracks


def public_playlist(username: str, assets: dict[str, Any] | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for track in (assets or {}).get("tracks") or []:
        if not isinstance(track, dict) or not track.get("id"):
            continue
        track_id = str(track["id"])
        items.append({
            "id": track_id,
            "title": str(track.get("title") or "Track")[:80],
            "recording": sanitize_recording(track.get("recording")),
            "audio": f"/api/v1/profile/{username}/tracks/{track_id}/audio",
            "artwork": f"/api/v1/profile/{username}/tracks/{track_id}/artwork",
        })
    return items


def decode_data_url(url: str) -> tuple[bytes, str] | None:
    match = DATA_URL.match((url or "").strip())
    if not match:
        return None
    try:
        return base64.b64decode(match.group(2), validate=False), match.group(1).lower()
    except Exception:
        return None


def css_hex_color(value: Any, fallback: str) -> str:
    text = str(value or "")
    return text if HEX_COLOR.match(text) else fallback


def public_badge_icon_path(badge_id: str) -> str:
    return f"/api/v1/badges/{badge_id}/icon"


def public_badge_icon(badge_id: str, value: Any = "") -> str:
    text = str(value or "")
    path = public_badge_icon_path(badge_id)
    if text == path or is_safe_social_icon(text):
        return path
    return ""


def _sanitize_badges(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        badge_id = str(item.get("id") or "").strip()[:80] or f"badge-{index}"
        if badge_id in seen:
            continue
        seen.add(badge_id)
        color = item.get("color")
        cleaned.append({
            "id": badge_id,
            "name": str(item.get("name") or "Badge")[:40],
            "description": str(item.get("description") or "")[:160],
            "owned": bool(item.get("owned")),
            "enabled": bool(item.get("enabled")),
            "color": color if isinstance(color, str) and HEX_COLOR.match(color) else "#d8d3ff",
            "monochrome": bool(item.get("monochrome")),
            "icon": public_badge_icon(badge_id, item.get("icon")),
        })
        if len(cleaned) >= MAX_BADGES:
            break
    return cleaned


def apply_badge_ownership(
    config: dict[str, Any],
    stored: dict[str, Any] | None = None,
    grants: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Replace client badge data with authoritative active awards and definitions."""
    del stored
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in grants or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        badge_id = str(item["id"])
        if badge_id in seen:
            continue
        seen.add(badge_id)
        preview_url = str(item.get("preview_url") or "")
        asset_url = str(item.get("asset_url") or "")
        result.append({
            "id": badge_id,
            "name": str(item.get("name") or badge_id)[:40],
            "description": str(item.get("description") or "")[:160],
            "owned": True,
            "enabled": bool(item.get("enabled")),
            "color": css_hex_color(item.get("color"), "#d8d3ff"),
            "monochrome": False,
            "icon": public_badge_icon(badge_id, preview_url or item.get("icon")),
            "previewUrl": public_badge_icon_path(badge_id),
            "assetUrl": asset_url if asset_url.startswith("https://") else "",
            "animated": bool(item.get("animated")),
            "rarity": str(item.get("rarity") or "COMMON")[:32],
        })
        if len(result) >= MAX_BADGES:
            break
    config["badges"] = result
    return config

def _sanitize_social(item: dict[str, Any], index: int) -> dict[str, Any]:
    platform = str(item.get("platform") or "Custom URL")[:32]
    raw_id = str(item.get("id") or "").strip()
    social_id = raw_id[:80] if raw_id else f"social-{index}"
    display_mode = "text" if item.get("displayMode") == "text" else "link"
    action = item.get("action")
    icon = item.get("customIcon") if isinstance(item.get("customIcon"), dict) else None
    icon_url = str((icon or {}).get("url") or "")
    if not is_safe_social_icon(icon_url):
        icon = None
        icon_url = ""
    color = item.get("iconColor")
    glow = item.get("iconGlow")
    return {
        "id": social_id,
        "platform": platform,
        "label": str(item.get("label") or platform)[:64],
        "value": _sanitize_stored_value(item.get("value"), platform, display_mode),
        "enabled": bool(item.get("enabled")),
        "displayMode": display_mode,
        "clicks": _safe_clicks(item.get("clicks")),
        "action": action if action in {"open", "copy"} else None,
        "iconColor": color if isinstance(color, str) and HEX_COLOR.match(color) else None,
        "iconGlow": glow if isinstance(glow, bool) else None,
        "customIcon": {
            "url": icon_url,
            "name": str((icon or {}).get("name") or "")[:80],
            "type": str((icon or {}).get("type") or "")[:40],
        } if icon and icon_url else None,
    }


def _sanitize_stored_value(value: Any, platform: str, display_mode: str) -> str:
    raw = _sanitize_value(value)
    if display_mode == "link":
        composed = compose_social_value(platform, raw)
        return composed or raw
    return raw


def sanitize_widgets(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind not in WIDGET_TYPES:
            continue
        raw_id = str(item.get("id") or "").strip()
        widget_id = raw_id if WIDGET_ID.fullmatch(raw_id) else f"{kind}-{index + 1}"
        if widget_id in seen:
            widget_id = f"{widget_id}-{index + 1}"[:40]
        seen.add(widget_id)
        cleaned.append({
            "id": widget_id,
            "type": kind,
            "enabled": bool(item.get("enabled")),
            "value": _sanitize_widget_value(kind, item.get("value")),
        })
        if len(cleaned) >= MAX_WIDGETS:
            break
    return cleaned


def sanitize_sections(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind not in SECTION_TYPES:
            continue
        raw_id = str(item.get("id") or "").strip()
        section_id = raw_id if SECTION_ID.fullmatch(raw_id) else f"{kind}-{index + 1}"
        if section_id in seen:
            section_id = f"{section_id}-{index + 1}"[:40]
        seen.add(section_id)
        tags = []
        if isinstance(item.get("tags"), list):
            for tag in item["tags"]:
                label = _plain_text(tag, 24)
                if label and label not in tags:
                    tags.append(label)
                if len(tags) >= 16:
                    break
        href = ""
        if kind == "project":
            candidate = _sanitize_value(item.get("href"))
            if candidate and public_social_href(candidate, "Custom URL"):
                href = public_social_href(candidate, "Custom URL") or ""
        cover = item.get("cover") if isinstance(item.get("cover"), dict) else {}
        cleaned.append({
            "id": section_id,
            "type": kind,
            "enabled": bool(item.get("enabled")),
            "title": _plain_text(item.get("title"), 80),
            "body": _plain_multiline(item.get("body"), MAX_SECTION_BODY.get(kind, 2000)),
            "href": href,
            "tags": tags if kind in {"about", "project", "skills"} else [],
            "subtitle": _plain_text(item.get("subtitle"), 160),
            **{side: sanitize_side_card(item.get(side), section_id + ("-l" if side == "leftCard" else "-r")) for side in ("leftCard", "rightCard") if isinstance(item.get(side), dict)},
            "cover": {
                "url": _safe_asset_url(cover.get("url"), "image") if kind == "project" else None,
                "name": str(cover.get("name") or "")[:80],
                "type": str(cover.get("type") or "")[:40],
            } if kind == "project" else {"url": None, "name": "", "type": ""},
        })
        if len(cleaned) >= MAX_SECTIONS:
            break
    return cleaned


def sanitize_side_card(raw, card_id):
    if raw.get("type") == "presence":
        return {"enabled": raw.get("enabled") is True, "type": "presence", "value": ""}
    cards = sanitize_widgets([{**raw, "id": card_id[:40]}])
    return {key: cards[0][key] for key in ("enabled", "type", "value")} if cards else {"enabled": False, "type": "timezone", "value": "UTC"}


def _plain_multiline(value: Any, limit: int) -> str:
    text = re.sub(r"<[^>]*>", "", str(value or ""))
    text = "".join(ch for ch in text if ch in {"\n", "\t"} or (ch >= " " and ch != "\x7f"))
    lower = text.lower()
    if "javascript:" in lower or "vbscript:" in lower or "data:text/html" in lower:
        text = re.sub(r"(?i)javascript:|vbscript:|data:text/html", "", text)
    return text[:limit]


def _sanitize_widget_value(kind: str, value: Any) -> str:
    text = _sanitize_value(value)
    if not text:
        return ""
    if kind == "youtube":
        return text if _widget_host(text, ("youtube.com", "youtu.be", "youtube-nocookie.com")) else ""
    if kind == "spotify":
        return text if _widget_host(text, ("open.spotify.com",)) else ""
    if kind == "discord":
        if WIDGET_INVITE.fullmatch(text):
            return text
        parsed = _widget_parsed(text)
        parts = [part for part in parsed.path.split("/") if part]
        host = (parsed.hostname or "").lower()
        if host in {"discord.gg", "www.discord.gg"} and parts and WIDGET_INVITE.fullmatch(parts[0]):
            return parts[0]
        if host in {"discord.com", "www.discord.com"} and len(parts) >= 2 and parts[0] == "invite" and WIDGET_INVITE.fullmatch(parts[1]):
            return parts[1]
        return ""
    if kind == "telegram":
        handle = text.lstrip("@")
        parsed = _widget_parsed(handle)
        if parsed.hostname in {"t.me", "www.t.me", "telegram.me"}:
            parts = [part for part in parsed.path.split("/") if part and part not in {"s", "joinchat"}]
            handle = parts[0] if parts else ""
        return handle if WIDGET_HANDLE.fullmatch(handle) else ""
    if kind == "roblox":
        parsed = _widget_parsed(text)
        if "roblox.com" in (parsed.hostname or "") and "/users/" in parsed.path:
            return text[:MAX_VALUE]
        handle = text.split("/")[-1]
        return handle if WIDGET_HANDLE.fullmatch(handle) else ""
    if kind == "github":
        parsed = _widget_parsed(text)
        if "github.com" in (parsed.hostname or ""):
            parts = [part for part in parsed.path.split("/") if part]
            text = parts[0] if parts else ""
        return text if WIDGET_HANDLE.fullmatch(text) else ""
    if kind == "lastfm":
        parsed = _widget_parsed(text)
        if "last.fm" in (parsed.hostname or ""):
            parts = [part for part in parsed.path.split("/") if part]
            text = parts[1] if len(parts) >= 2 and parts[0] == "user" else (parts[0] if parts else "")
        return text if WIDGET_HANDLE.fullmatch(text) else ""
    if kind == "timezone":
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(text)
        except Exception:
            return ""
        return text[:80]
    if kind == "weather":
        return text if WIDGET_CITY.fullmatch(text) else ""
    return ""


def _widget_parsed(value: str):
    return urlparse(value if "://" in value else f"https://{value}")


def _widget_host(value: str, allowed: tuple[str, ...]) -> bool:
    host = (_widget_parsed(value).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return any(host == item or host.endswith(f".{item}") for item in allowed)


def _sanitize_value(value: Any) -> str:
    trimmed = str(value or "")[:MAX_VALUE]
    if not trimmed:
        return ""
    lower = trimmed.lower()
    if lower.startswith(("javascript:", "data:", "vbscript:", "file:")):
        return ""
    if lower.startswith("mailto:"):
        address = re.sub(r"^mailto:", "", trimmed, flags=re.I).strip()
        return f"mailto:{address}" if re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", address) else ""
    if "://" in trimmed:
        return safe_public_url(trimmed) or ""
    return trimmed


def _safe_clicks(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def public_social_href(value: str, platform: str) -> str | None:
    trimmed = compose_social_value(platform, value) or (value or "").strip()[:MAX_VALUE]
    if not trimmed:
        return None
    if platform == "Email" or trimmed.lower().startswith("mailto:"):
        address = re.sub(r"^mailto:", "", trimmed, flags=re.I).strip()
        if re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", address):
            return f"mailto:{address}"
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*:", trimmed, flags=re.I) and not trimmed.lower().startswith(("http://", "https://")):
        return None
    candidate = trimmed if "://" in trimmed else f"https://{trimmed}"
    safe = safe_public_url(candidate)
    if not safe:
        return None
    parsed = urlparse(safe)
    if not host_allowed(platform, parsed.hostname or ""):
        return None
    return safe


def sanitize_recording(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        identity, duration = int(raw.get("id", 0)), float(raw.get("duration", 0))
    except (TypeError, ValueError, OverflowError):
        return None
    if identity <= 0 or identity > 2147483647 or not 0 < duration < 86400:
        return None
    return {"id": identity, "duration": duration, **{key: _plain_text(raw.get(key), 200) for key in ("title", "artist", "album")}}
