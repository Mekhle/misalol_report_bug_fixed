"""Premium presentation policy. Existing free customizations are grandfathered.

The first premium save keeps an immutable free presentation snapshot. Expiration
changes the public projection, never the stored customization. All profile write
paths (including templates) pass through the shared persistence boundary.
"""
from copy import deepcopy
import re
from fastapi import HTTPException

SHARED_SETTINGS = ("layout", "pageEnter", "profileFont", "profileFontScope", "entryScreen", "entryText", "clickSound", "bioTypewriter", "bioTypeMs", "bioDeleteMs", "bioPauseMs", "cardTilt", "showViews", "showAvatar", "showSocials", "borderColor", "borderWidth", "profileRadius", "ogTitle", "ogDescription", "ogOverlayAvatar", "ogOverlayName", "ogOverlayAddress")
PREMIUM_ASSETS = ("customFont", "clickSound", "entryIcon", "ogImage", "favicon")
DEFAULTS = {"version": 1, "cursorEffect": "None", "cursorColor": "#ffffff", "clickPreset": "None", "entrySubtitle": "", "typewriterTexts": [], "hero": "Classic", "borderType": "Static", "borderOpacity": 100, "borderEnabled": True}


async def has_premium(user_id: str) -> bool:
    from app.db import admin_db
    if not admin_db.has_pool():
        return False
    return await admin_db.has_active_premium(user_id)


def normalize_premium(raw):
    from app.core.profile_sanitize import css_hex_color, _plain_text, _clamp_int
    if not isinstance(raw, dict):
        return None
    result = dict(DEFAULTS)
    for key, allowed in {"cursorEffect": ("None", "Cursor Cat", "Snowflakes", "Ghost Cursor", "Following Dot", "Bubbles"), "clickPreset": ("None", "Crisp Click", "Pixel Click", "Bass Tick", "Mouse Click", "Custom"), "hero": ("Classic", "Centered"), "borderType": ("Static", "Dashed", "Shimmer", "Pulse")}.items():
        result[key] = raw.get(key) if raw.get(key) in allowed else DEFAULTS[key]
    result["cursorColor"] = css_hex_color(raw.get("cursorColor"), "#ffffff")
    result["entrySubtitle"] = _plain_text(raw.get("entrySubtitle"), 160)
    result["borderOpacity"] = _clamp_int(raw.get("borderOpacity"), 100, 0, 100)
    result["borderEnabled"] = raw.get("borderEnabled") is not False
    result["typewriterTexts"] = [_plain_text(s, 200) for s in raw.get("typewriterTexts", [])[:12] if isinstance(s, str) and s.strip()] if isinstance(raw.get("typewriterTexts"), list) else []
    colors = raw.get("effectColors")
    result["effectColors"] = {key: value.lower() if re.fullmatch(r"#[0-9a-fA-F]{6}", value) else default for key, default in {"Fireflies": "#fcd271", "Snowflakes": "#ffffff", "Snow": "#ffffff", "Sakura": "#ffb7c5"}.items() if isinstance(colors, dict) and isinstance((value := colors.get(key)), str)}
    return result


def _presentation(config):
    return {"settings": {key: config.get("settings", {}).get(key) for key in SHARED_SETTINGS}, "assets": {key: config.get("assets", {}).get(key) for key in PREMIUM_ASSETS}, "sections": deepcopy(config.get("sections", []))}


def protect_write(config, previous, entitled):
    from app.core.profile_sanitize import sanitize_profile_config
    incoming = sanitize_profile_config(config)
    previous = previous or {}
    old = sanitize_profile_config(previous)
    advanced = incoming["settings"].get("premium")
    base = previous.get("_premium_base")
    changed = advanced != old["settings"].get("premium")
    changed |= incoming["settings"].get("layout") in ("Default", "Portfolio") and incoming["settings"].get("layout") != old["settings"].get("layout")
    changed |= any(s.get("leftCard") or s.get("rightCard") or s.get("subtitle") or (s.get("type") == "about" and s.get("tags")) or s.get("type") == "integration" for s in incoming.get("sections", [])) and incoming.get("sections") != old.get("sections")
    changed |= (incoming.get("assets", {}).get("entryIcon") or {}).get("url") != (old.get("assets", {}).get("entryIcon") or {}).get("url")
    if base:
        changed |= _presentation(incoming) != _presentation(old)
    if changed and not entitled:
        raise HTTPException(403, "An active Premium entitlement is required to change premium settings. Your saved settings have been kept.")
    incoming.pop("_premium_base", None)
    if base:
        incoming["_premium_base"] = deepcopy(base)
    elif entitled and advanced:
        incoming["_premium_base"] = _presentation(old)
    return incoming


def public_projection(config, entitled):
    result = deepcopy(config)
    base = result.pop("_premium_base", None)
    if not entitled:
        result.setdefault("settings", {}).pop("premium", None)
        if base:
            for group in ("settings", "assets"):
                for key, value in base.get(group, {}).items():
                    if value is None:
                        result.setdefault(group, {}).pop(key, None)
                    else:
                        result.setdefault(group, {})[key] = value
            result["sections"] = base.get("sections", [])
        elif result["settings"].get("layout") in ("Default", "Portfolio"):
            result["settings"]["layout"] = "Modern"
    return result
