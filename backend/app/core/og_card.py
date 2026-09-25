from io import BytesIO
from pathlib import Path
from typing import Any
from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.core.config import get_settings
from app.core.network_safety import fetch_public_image_bytes
from app.core.profile_sanitize import decode_data_url, safe_asset_url

OG_WIDTH = 1200
OG_HEIGHT = 630
MAX_IMAGE_BYTES = 8_000_000
_FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def public_host() -> str:
    host = (get_settings().domain or "misa.lol").strip().lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return "misa.lol"
    return host or "misa.lol"


def share_copy(identity: dict[str, Any], settings: dict[str, Any], username: str) -> dict[str, str]:
    display = str(identity.get("displayName") or username).strip() or username
    title = str(settings.get("ogTitle") or "").strip() or f"{display} · misa.lol"
    description = str(settings.get("ogDescription") or "").strip() or str(identity.get("description") or "").strip()
    if not description:
        description = f"{display} on misa.lol"
    return {
        "title": title[:70],
        "description": description[:200],
        "display_name": display[:70],
        "address": f"{public_host()}/{username}",
    }


def share_flag(settings: dict[str, Any], key: str, default: bool = True) -> bool:
    if key not in settings:
        return default
    return bool(settings.get(key))


async def render_og_png(bits: dict[str, Any]) -> bytes:
    import base64
    import hashlib
    import json
    from app.db.dragonfly import get_dragonfly
    key = "profile-og:v2:" + hashlib.sha256(json.dumps(bits, sort_keys=True, default=str).encode()).hexdigest()
    redis = None
    try:
        redis = get_dragonfly()
        cached = await redis.get(key)
        if cached:
            return base64.b64decode(cached)
    except Exception:
        pass
    result = await _render_og_png(bits)
    if redis:
        try:
            await redis.set(key, base64.b64encode(result).decode(), ex=3600)
        except Exception:
            pass
    return result


async def _render_og_png(bits: dict[str, Any]) -> bytes:
    settings = bits.get("settings") if isinstance(bits.get("settings"), dict) else {}
    identity = bits.get("identity") if isinstance(bits.get("identity"), dict) else {}
    username = str(bits.get("username") or "user")
    copy = share_copy(identity, settings, username)
    overlay_avatar = share_flag(settings, "ogOverlayAvatar")
    overlay_name = share_flag(settings, "ogOverlayName")
    overlay_address = share_flag(settings, "ogOverlayAddress")
    cover = await load_image_bytes(bits.get("og_image")) or await load_image_bytes(bits.get("background"))
    avatar = await load_image_bytes(bits.get("avatar")) if overlay_avatar else None
    return compose_og_png(
        cover=cover,
        avatar=avatar,
        display_name=copy["display_name"],
        address=copy["address"],
        overlay_name=overlay_name,
        overlay_address=overlay_address,
        background=str(settings.get("backgroundColor") or "#08080d"),
        accent=str(settings.get("accentColor") or "#9b87f5"),
    )


def compose_og_png(
    *,
    cover: bytes | None,
    avatar: bytes | None,
    display_name: str,
    address: str,
    overlay_name: bool,
    overlay_address: bool,
    background: str,
    accent: str,
) -> bytes:
    canvas = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), _rgb(background, (8, 8, 13)))
    cover_image = _open_image(cover)
    if cover_image is not None:
        canvas.paste(ImageOps.fit(cover_image.convert("RGB"), (OG_WIDTH, OG_HEIGHT), method=Image.Resampling.LANCZOS), (0, 0))
    else:
        _paint_wash(canvas, _rgb(accent, (155, 135, 245)))
    overlay_needed = bool(avatar) or overlay_name or overlay_address
    if overlay_needed:
        canvas = _with_bottom_fade(canvas)
        draw = ImageDraw.Draw(canvas)
        name_font = _font(52)
        address_font = _font(28)
        left = 56
        if avatar:
            badge = _circle(_open_image(avatar), 128)
            if badge is not None:
                canvas.paste(badge, (56, OG_HEIGHT - 184), badge)
                left = 208
        text_width = OG_WIDTH - left - 56
        text_top = OG_HEIGHT - 168
        if overlay_name:
            draw.text((left, text_top), _fit(draw, display_name, name_font, text_width), font=name_font, fill=(255, 255, 255))
            text_top += 64
        if overlay_address:
            draw.text((left, text_top + 6), _fit(draw, address, address_font, text_width), font=address_font, fill=(210, 210, 220))
    output = BytesIO()
    canvas.convert("RGB").save(output, format="JPEG", quality=86, optimize=True, progressive=True)
    return output.getvalue()


def fallback_favicon_png(initial: str, accent: str) -> bytes:
    size = 64
    image = Image.new("RGB", (size, size), _rgb(accent, (155, 135, 245)))
    draw = ImageDraw.Draw(image)
    glyph = (initial or "?").strip()[:1].upper() or "?"
    font = _font(36)
    box = draw.textbbox((0, 0), glyph, font=font)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), glyph, font=font, fill=(255, 255, 255))
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


async def load_image_bytes(url: Any) -> bytes | None:
    text = str(url or "").strip()
    if not text:
        return None
    decoded = decode_data_url(text)
    if decoded:
        body, _mime = decoded
        return body if body and len(body) <= MAX_IMAGE_BYTES else None
    safe = safe_asset_url(text, "image")
    if not safe:
        return None
    return await fetch_public_image_bytes(safe, max_bytes=MAX_IMAGE_BYTES)


def _open_image(data: bytes | None) -> Image.Image | None:
    if not data:
        return None
    try:
        image = Image.open(BytesIO(data))
        image = ImageOps.exif_transpose(image)
        return image.convert("RGBA")
    except Exception:
        return None


def _circle(image: Image.Image | None, size: int) -> Image.Image | None:
    if image is None:
        return None
    fitted = ImageOps.fit(image.convert("RGBA"), (size, size), method=Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size - 2, size - 2), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(fitted, (0, 0), mask)
    return out


def _with_bottom_fade(canvas: Image.Image) -> Image.Image:
    base = canvas.convert("RGBA")
    fade = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(fade)
    top = OG_HEIGHT - 230
    for index in range(230):
        draw.line([(0, top + index), (OG_WIDTH, top + index)], fill=(8, 8, 13, int(200 * (index / 230))))
    return Image.alpha_composite(base, fade)


def _paint_wash(canvas: Image.Image, accent: tuple[int, int, int]) -> None:
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, OG_WIDTH, OG_HEIGHT), fill=(8, 8, 13))
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    paint = ImageDraw.Draw(overlay)
    paint.ellipse((-80, -120, 520, 480), fill=(*accent, 90))
    paint.ellipse((760, 220, 1380, 820), fill=(*accent, 60))
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB"))


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _fit(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    value = text or ""
    if draw.textlength(value, font=font) <= max_width:
        return value
    while value and draw.textlength(value + "…", font=font) > max_width:
        value = value[:-1]
    return f"{value}…" if value else ""


def _rgb(value: str, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    text = str(value or "").lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) < 6:
        return fallback
    try:
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
    except ValueError:
        return fallback
