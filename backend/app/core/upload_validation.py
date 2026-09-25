from io import BytesIO
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError


def validate_upload(kind: str, body: bytes, mime: str) -> bytes:
    if not body:
        raise HTTPException(400, "The file is empty.")
    if mime.startswith("image/"):
        valid_img = (
            body.startswith(b"\xff\xd8\xff")
            or body.startswith(b"\x89PNG\r\n\x1a\n")
            or body.startswith(b"GIF87a")
            or body.startswith(b"GIF89a")
            or (body.startswith(b"RIFF") and len(body) >= 12 and body[8:12] == b"WEBP")
            or body.startswith(b"\x00\x00\x01\x00")
        )
        if not valid_img:
            raise HTTPException(400, "The file is not a valid image.")
        try:
            with Image.open(BytesIO(body)) as image:
                if image.width * image.height > 40_000_000:
                    raise HTTPException(400, "Image dimensions are too large.")
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(400, "The file is not a valid image.") from None

        if mime in {"image/jpeg", "image/jpg", "image/png"}:
            try:
                with Image.open(BytesIO(body)) as image:
                    if not getattr(image, "is_animated", False):
                        out = BytesIO()
                        fmt = "JPEG" if mime in {"image/jpeg", "image/jpg"} else "PNG"
                        clean_image = Image.new(image.mode, image.size)
                        clean_image.putdata(list(image.getdata()))
                        clean_image.save(out, format=fmt)
                        body = out.getvalue()
            except Exception:
                pass
        return body

    if kind == "customFont" or mime.startswith("font/"):
        if body[:4] not in (b"wOFF", b"wOF2", b"OTTO", b"\x00\x01\x00\x00", b"true"):
            raise HTTPException(400, "Use a valid WOFF, WOFF2, TTF or OTF font.")
        return body

    if kind in {"audio", "clickSound"} or mime.startswith("audio/"):
        valid = (
            body.startswith(b"ID3")
            or body.startswith(b"OggS")
            or body.startswith(b"fLaC")
            or (body[:4] == b"RIFF" and len(body) >= 12 and body[8:12] == b"WAVE")
            or (len(body) >= 8 and body[4:8] == b"ftyp")
            or (len(body) > 1 and body[0] == 255 and (body[1] & 224) == 224)
        )
        if not valid:
            raise HTTPException(400, "Use a valid MP3, WAV, OGG, FLAC or M4A audio file.")
        return body

    if kind in {"backgroundVideo", "backgroundEffectVideo"} or mime.startswith("video/"):
        valid = (
            body.startswith(b"\x1a\x45\xdf\xa3")
            or (len(body) >= 8 and body[4:8] in (b"ftyp", b"moov", b"wide", b"mdat"))
        )
        if not valid:
            raise HTTPException(400, "Use a valid MP4, WebM or MOV video file.")
        return body

    return body
