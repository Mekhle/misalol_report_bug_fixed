from fastapi import Request

from app.core.config import get_settings

PRODUCTION_HOSTS = {"misa.lol", "www.misa.lol"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}


def public_origin_for(request: Request | None = None) -> str:
    configured = (get_settings().public_base_url or "https://misa.lol").rstrip("/")
    if request is None:
        return configured
    host = _request_host(request)
    hostname = host.split(":")[0].lower().strip("[]")
    if hostname in PRODUCTION_HOSTS or hostname.endswith(".misa.lol"):
        return "https://misa.lol"
    if hostname in LOCAL_HOSTS and host:
        return f"{_request_proto(request)}://{host}"
    return configured or "https://misa.lol"


def _request_host(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    raw = forwarded or (request.headers.get("host") or "").strip() or (request.url.netloc or "")
    return raw.split("@")[-1].strip()


def _request_proto(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded in {"http", "https"}:
        return forwarded
    if "https" in (request.headers.get("cf-visitor") or ""):
        return "https"
    scheme = (request.url.scheme or "http").lower()
    return scheme if scheme in {"http", "https"} else "http"
