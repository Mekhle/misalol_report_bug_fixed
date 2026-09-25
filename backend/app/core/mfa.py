import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _secret_bytes(secret: str) -> bytes:
    return base64.b32decode(secret.upper() + "=" * (-len(secret) % 8), casefold=True)


def _totp(secret: str, counter: int) -> str:
    digest = hmac.new(_secret_bytes(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    normalized = "".join(character for character in code if character.isdigit())
    if len(normalized) != 6:
        return False
    counter = int(time.time() // 30)
    return any(hmac.compare_digest(_totp(secret, counter + offset), normalized) for offset in range(-window, window + 1))


def otpauth_uri(secret: str, email: str) -> str:
    label = quote(f"Misa.lol:{email}", safe="")
    return f"otpauth://totp/{label}?secret={quote(secret)}&issuer=Misa.lol&algorithm=SHA1&digits=6&period=30"
