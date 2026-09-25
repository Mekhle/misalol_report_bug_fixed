from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.profile import router as profile_router
from app.api.v1.widgets import router as widgets_router
from app.api.v1.discord import router as discord_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.templates import router as templates_router
from app.api.v1.verification import router as verification_router
from app.api.v1.badges import router as badges_router
from app.api.v1.community import router as community_router
from app.api.v1.admin_auth import router as admin_auth_router
from app.api.v1.admin import router as admin_router
from app.api.v1.fonts import router as fonts_router
from app.api.v1.feature_flags import router as feature_flags_router
from app.api.v1.features import router as features_router
from app.api.v1.dashboard import router as dashboard_router
from app.core.config import Settings, get_settings

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(profile_router)
api_router.include_router(widgets_router)
api_router.include_router(discord_router)
api_router.include_router(analytics_router)
api_router.include_router(templates_router)
api_router.include_router(verification_router)
api_router.include_router(badges_router)
api_router.include_router(community_router)
api_router.include_router(admin_auth_router)
api_router.include_router(admin_router)
api_router.include_router(fonts_router)
api_router.include_router(feature_flags_router)
api_router.include_router(features_router)
api_router.include_router(dashboard_router)


class RootResponse(BaseModel):
    service: str
    version: str


class InfoResponse(BaseModel):
    app: str
    version: str
    time: datetime


@api_router.get("/", response_model=RootResponse, tags=["info"])
async def root(settings: Settings = Depends(get_settings)) -> RootResponse:
    return RootResponse(
        service=settings.app_name,
        version=settings.app_version,
    )


@api_router.get("/info", response_model=InfoResponse, tags=["info"])
async def info(settings: Settings = Depends(get_settings)) -> InfoResponse:
    return InfoResponse(
        app=settings.app_name,
        version=settings.app_version,
        time=datetime.now(timezone.utc),
    )
