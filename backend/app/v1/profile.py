import re
from pathlib import Path
from typing import Any, Annotated
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status

from app.core.config import Settings, get_settings
from app.core.sessions import get_user_from_request
from app.db import admin_db, data_api
from app.models import User

router = APIRouter(prefix="/profile", tags=["profiles"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def _with_real_badges(user_id, profile: dict[str, Any]) -> dict[str, Any]:
    badges = await admin_db.list_user_badges(user_id)
    profile["badges"] = [
        {
            "id": item["id"],
            "name": item["name"],
            "description": item["description"],
            "color": item["color"],
            "owned": True,
            "enabled": item["enabled"],
            "type": item.get("badge_type") or "custom",
            "iconUrl": item.get("icon_url"),
        }
        for item in badges
    ]
    return profile


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


@router.get("")
async def public_profile(username: Annotated[str, Query(min_length=3, max_length=24)]) -> dict[str, Any]:
    user = await data_api.find_user(username=username.strip().lower())
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    profile = await data_api.get_profile(user.id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    details = await admin_db.user_detail(user.id)
    if details and (details.get("profile") or {}).get("disabled_at"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return {"profile": await _with_real_badges(user.id, profile)}


@router.get("/me")
async def my_profile(user: User = Depends(require_user)) -> dict[str, Any]:
    profile = await data_api.get_profile(user.id)
    if profile is None:
        return {"profile": None}
    return {"profile": await _with_real_badges(user.id, profile)}


@router.put("/me")
async def save_my_profile(payload: dict[str, Any], user: User = Depends(require_user)) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("profile"), dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile payload.")
    if not user.username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a username before saving your profile.")
    profile = payload["profile"]
    if str(profile.get("username", "")).strip().lower() != user.username.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile username does not match the signed-in account.")
    profile["username"] = user.username
    profile["uid"] = user.id
    display_name = str(profile.get("displayName", "")).strip()
    if not display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Display name cannot be empty.")
    try:
        await admin_db.sync_badge_visibility(user.id, profile.get("badges") if isinstance(profile.get("badges"), list) else [])
        payload["badges"] = [
            {"id": item["id"], "name": item["name"], "description": item["description"], "color": item["color"], "owned": True, "enabled": item["enabled"], "type": item.get("badge_type") or "custom", "iconUrl": item.get("icon_url")}
            for item in await admin_db.list_user_badges(user.id)
        ]
        updated = await data_api.update_user(user.id, display_name=display_name)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
        saved = await data_api.save_profile(user.id, payload)
    except HTTPException:
        raise
    except (httpx.HTTPError, RuntimeError, ValueError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Profile storage is temporarily unavailable. Please try again.") from None
    return {"profile": saved}


ASSET_LIMITS = {
    "avatar": 3_000_000,
    "background": 3_000_000,
    "cursor": 3_000_000,
    "backgroundVideo": 20_000_000,
    "audio": 8_000_000,
}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _asset_content_allowed(kind: str, content_type: str) -> bool:
    if kind in {"avatar", "background"}:
        return content_type in IMAGE_TYPES
    if kind == "cursor":
        return content_type in IMAGE_TYPES | {"image/gif", "image/x-icon", "image/vnd.microsoft.icon"}
    if kind == "backgroundVideo":
        return content_type in {"video/mp4", "video/webm"}
    return kind == "audio" and content_type.startswith("audio/")


def _safe_filename(filename: str | None) -> str:
    value = Path(filename or "upload").name
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-")
    return value[:120] or "upload"


async def _ensure_public_bucket(settings: Settings, client: httpx.AsyncClient) -> None:
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": "application/json",
    }
    response = await client.post(
        f"{settings.supabase_url.rstrip('/')}/storage/v1/bucket",
        headers=headers,
        json={"id": settings.storage_bucket, "name": settings.storage_bucket, "public": True},
    )
    if response.status_code not in {200, 201, 400, 409}:
        raise HTTPException(status_code=502, detail="Object storage bucket could not be prepared.")


@router.post("/assets")
async def upload_asset(
    kind: Annotated[str, Form(...)],
    file: Annotated[UploadFile, File(...)],
    settings: SettingsDep,
    user: User = Depends(require_user),
) -> dict[str, Any]:
    if kind not in ASSET_LIMITS:
        raise HTTPException(status_code=400, detail="Unsupported asset type.")
    content_type = (file.content_type or "application/octet-stream").lower()
    if not _asset_content_allowed(kind, content_type):
        raise HTTPException(status_code=400, detail="That file type is not supported for this asset.")
    data = await file.read(ASSET_LIMITS[kind] + 1)
    if len(data) > ASSET_LIMITS[kind]:
        raise HTTPException(status_code=413, detail="That file is too large.")
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(status_code=503, detail="Object storage is not configured.")

    original_name = _safe_filename(file.filename)
    object_path = f"profiles/{user.id}/{uuid4().hex}-{original_name}"
    base_url = settings.supabase_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": content_type,
        "Cache-Control": "31536000",
        "x-upsert": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            await _ensure_public_bucket(settings, client)
            response = await client.post(
                f"{base_url}/storage/v1/object/{quote(settings.storage_bucket, safe='')}/{quote(object_path, safe='/')}",
                headers=headers,
                content=data,
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Object storage is temporarily unavailable.") from None
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Object storage rejected the upload.")

    public_url = f"{base_url}/storage/v1/object/public/{quote(settings.storage_bucket, safe='')}/{quote(object_path, safe='/')}"
    return {"asset": {"url": public_url, "name": original_name, "type": content_type}}
