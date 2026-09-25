"""Constellations request security shared by dashboard and public routes."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings


class ConstellationWebMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, origins: list[str]):
        super().__init__(app)
        self.origins = {origin.rstrip("/") for origin in origins}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        belongs = path == "/api/constellations" or path.startswith("/api/constellations/")
        if belongs and request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("origin", "").rstrip("/") not in self.origins:
                return JSONResponse({"detail": "Please make this change from your Misa dashboard."}, status_code=403)
        response = await call_next(request)
        if belongs:
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "same-origin"
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response


def install_constellation_web(application: FastAPI) -> None:
    application.add_middleware(
        ConstellationWebMiddleware,
        origins=get_settings().cors_origin_list,
    )
