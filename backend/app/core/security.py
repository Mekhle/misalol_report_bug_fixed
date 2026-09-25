import hashlib
import hmac
import ipaddress
import re
import time
from urllib.parse import unquote, urlparse

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from starlette.requests import Request

from app.core.config import Settings

_hasher = PasswordHasher()

USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,23}$")
BANNED_WORD_RE = re.compile(r"^[a-z0-9_]{2,24}$")
RESERVED_USERNAMES = {
    "about",
    "account",
    "admin",
    "analytics",
    "api",
    "auth",
    "badges",
    "css",
    "customize",
    "dashboard",
    "discord",
    "explore",
    "forgot-password",
    "google",
    "help",
    "host",
    "icons",
    "images",
    "index",
    "js",
    "links",
    "login",
    "logout",
    "me",
    "misa",
    "plus",
    "premium",
    "pricing",
    "privacy",
    "reset-password",
    "root",
    "settings",
    "signup",
    "static",
    "status",
    "support",
    "telegram",
    "templates",
    "terms",
    "www",
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def validate_username(username: str) -> str:
    value = normalize_username(username)
    if not USERNAME_RE.fullmatch(value):
        raise ValueError("Username must be 3-24 characters, start with a letter, and use only letters, numbers, or underscores.")
    if value in RESERVED_USERNAMES:
        raise ValueError("That username is reserved.")
    return value


def normalize_banned_word(word: str) -> str:
    value = (word or "").strip().lower()
    if not BANNED_WORD_RE.fullmatch(value):
        raise ValueError("Use 2-24 letters, numbers, or underscores.")
    return value


def normalize_ip(value: str) -> str:
    raw = (value or "").strip()
    if not raw or raw.lower() in {"unknown", "*"}:
        raise ValueError("Enter a valid IP address.")
    try:
        parsed = ipaddress.ip_address(raw)
    except ValueError as exc:
        raise ValueError("Enter a valid IP address.") from exc
    mapped = getattr(parsed, "ipv4_mapped", None)
    if mapped is not None:
        parsed = mapped
    return str(parsed)


def username_hits_banned_word(username: str, words: list[str]) -> bool:
    handle = normalize_username(username)
    if not handle:
        return False
    for raw in words:
        word = (raw or "").strip().lower()
        if not word:
            continue
        if handle == word:
            return True
        if len(word) >= 4 and word in handle:
            return True
    return False


TELEGRAM_AUTH_KEYS = ("id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash")


def parse_telegram_auth_payload(raw: dict) -> dict[str, str]:
    payload: dict[str, str] = {}
    for key in TELEGRAM_AUTH_KEYS:
        value = raw.get(key)
        if value is None or value == "":
            continue
        payload[key] = str(value)
    return payload


def verify_telegram_auth(payload: dict[str, str], bot_token: str, max_age_seconds: int = 86400) -> bool:
    check_hash = payload.get("hash")
    if not check_hash:
        return False
    pairs = [f"{key}={value}" for key, value in sorted(payload.items()) if key != "hash" and value is not None]
    data_check_string = "\n".join(pairs)
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    digest = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, check_hash):
        return False
    try:
        auth_date = int(payload.get("auth_date", "0"))
    except ValueError:
        return False
    return (time.time() - auth_date) <= max_age_seconds


def cookie_should_be_secure(request: Request, settings: Settings) -> bool:
    host = (request.headers.get("host") or request.url.hostname or "").split(":")[0].lower()
    if host in {"localhost", "127.0.0.1"}:
        return False
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded:
        return forwarded == "https"
    visitor = request.headers.get("cf-visitor") or ""
    if "https" in visitor:
        return True
    if settings.is_production:
        return True
    return request.url.scheme == "https"


def safe_next_path(value: str | None) -> str:
    if not value or not isinstance(value, str):
        return "/dashboard"
    raw = value.strip()
    if not raw.startswith("/") or raw.startswith("//"):
        return "/dashboard"
    if any(ord(c) < 32 or ord(c) == 127 or c in "\\:\r\n\t" for c in raw):
        return "/dashboard"
    unquoted = unquote(raw)
    if unquoted.startswith("//") or unquoted.startswith("/\\") or any(ord(c) < 32 or ord(c) == 127 or c in "\\:\r\n\t" for c in unquoted):
        return "/dashboard"
    try:
        parsed = urlparse(raw)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith("/") or parsed.path.startswith("//"):
            return "/dashboard"
    except Exception:
        return "/dashboard"
    return raw
