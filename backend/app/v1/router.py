from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.profile import router as profile_router
from app.api.v1.admin import router as admin_router
from app.api.v1.admin_auth import router as admin_auth_router
from app.core.config import Settings, get_settings

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(profile_router)
api_router.include_router(admin_router)
api_router.include_router(admin_auth_router)


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
