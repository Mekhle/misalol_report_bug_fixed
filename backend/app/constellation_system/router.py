from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Awaitable, Callable, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings
from app.core.profile_sanitize import apply_badge_ownership, sanitize_profile_config
from app.core.profiles import stamp_join_date
from app.db import data_api
from app.core.r2_storage import get_r2_storage
from app.models import User
from .repository import ConstellationRepository, DomainError


class Input(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class Create(Input):
    name: str = Field(min_length=1, max_length=60)
    slug: str = Field(min_length=2, max_length=32)
    capacity: int = Field(default=3, ge=2, le=4)
    assignment_mode: Literal["owner", "self"] = Field(default="owner", alias="assignmentMode")


class Update(Input):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    slug: str | None = Field(default=None, min_length=2, max_length=32)
    description: str | None = Field(default=None, max_length=500)
    capacity: int | None = Field(default=None, ge=2, le=4)
    assignment_mode: Literal["owner", "self"] | None = Field(default=None, alias="assignmentMode")
    global_font: str | None = Field(default=None, min_length=1, max_length=120, alias="globalFont")
    allow_member_fonts: bool | None = Field(default=None, alias="allowMemberFonts")
    allow_member_move: bool | None = Field(default=None, alias="allowMemberMove")
    allow_member_resize: bool | None = Field(default=None, alias="allowMemberResize")
    frame_mode: Literal["member", "framed", "frameless"] | None = Field(default=None, alias="frameMode")


class BackgroundColor(Input):
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class EffectChoice(Input):
    effect: Literal["None", "Snowflakes", "Snow", "Sakura", "Rain", "Fireflies"]


class Invite(Input):
    username: str | None = Field(default=None, max_length=32)


class Respond(Input):
    accept: bool


class Transfer(Input):
    user_id: str = Field(alias="userId")


class Position(Input):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)


class MemberPatch(Input):
    slot: int | None = Field(default=None, ge=1, le=4)
    position: Position | None = None
    scale: float | None = Field(default=None, ge=.4, le=1.8)
    frame_override: Literal["inherit", "framed", "frameless"] | None = Field(default=None, alias="frameOverride")


async def denied() -> User:
    raise HTTPException(status_code=401, detail="Sign in to manage Constellations.")


async def run(operation: Awaitable[Any]) -> Any:
    try:
        return await operation
    except DomainError as error:
        raise HTTPException(status_code=error.status, detail=error.message) from error


def create_router(
    repository: ConstellationRepository,
    authenticate: Callable[..., Awaitable[User]] = denied,
    user_lookup: Callable[[str], Awaitable[User | None]] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/constellations", tags=["constellations"])
    auth = Depends(authenticate)

    @router.get("/bootstrap")
    async def bootstrap(user: User = auth) -> dict[str, Any]:
        return {"me": {
            "id": user.id, "username": user.username or "", "displayName": user.display_name or user.username or "",
            "avatarUrl": user.avatar_url,
        }}

    @router.get("")
    async def groups(user: User = auth) -> dict[str, Any]:
        return await run(repository.list_for(user.id))

    @router.post("")
    async def create(payload: Create, user: User = auth) -> dict[str, Any]:
        group = await run(repository.create(user, **payload.model_dump()))
        return {"group": group}

    @router.get("/public/{slug}")
    async def public(slug: str) -> dict[str, Any]:
        return {"group": await run(repository.public(slug))}

    @router.post("/join/{token}")
    async def join(token: str, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.join(token, user))}

    @router.get("/{group_id}")
    async def detail(group_id: str, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.detail(group_id, user.id))}

    @router.patch("/{group_id}")
    async def update(group_id: str, payload: Update, user: User = auth) -> dict[str, Any]:
        patch = payload.model_dump(exclude_none=True, by_alias=True)
        return {"group": await run(repository.update(group_id, user.id, patch))}

    @router.post("/{group_id}/invite")
    async def invite(group_id: str, payload: Invite, user: User = auth) -> dict[str, Any]:
        target = None
        if payload.username:
            if user_lookup is None:
                raise HTTPException(status_code=503, detail="The account directory is unavailable.")
            target = await user_lookup(payload.username.strip().lower().removeprefix("@"))
            if target is None:
                raise HTTPException(status_code=404, detail="That Misa user was not found.")
            if target.id == user.id:
                raise HTTPException(status_code=409, detail="You are already in this Constellation.")
        return await run(repository.invite(group_id, user.id, target))

    @router.post("/{group_id}/invitations/{invitation_id}/respond")
    async def respond(group_id: str, invitation_id: str, payload: Respond, user: User = auth) -> dict[str, Any]:
        return await run(repository.respond(group_id, invitation_id, user, payload.accept))

    @router.delete("/{group_id}/invitations/{invitation_id}")
    async def revoke(group_id: str, invitation_id: str, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.revoke_invite(group_id, invitation_id, user.id))}

    @router.patch("/{group_id}/members/{member_id}")
    async def update_member(group_id: str, member_id: str, payload: MemberPatch, user: User = auth) -> dict[str, Any]:
        patch = payload.model_dump(exclude_none=True, by_alias=True)
        return {"group": await run(repository.update_member(group_id, user.id, member_id, patch))}

    @router.put("/{group_id}/profile")
    async def update_member_profile(group_id: str, payload: dict[str, Any], user: User = auth) -> dict[str, Any]:
        if not isinstance(payload, dict) or not isinstance(payload.get("profile"), dict):
            raise HTTPException(status_code=400, detail="Invalid Constellation profile payload.")
        if not user.username:
            raise HTTPException(status_code=400, detail="Choose a username before saving your Constellation design.")
        identity = dict(payload["profile"])
        if str(identity.get("username") or "").strip().lower() != user.username.lower():
            raise HTTPException(status_code=400, detail="Profile username does not match the signed-in member.")
        if not str(identity.get("displayName") or "").strip():
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        identity["username"], identity["uid"] = user.username, user.id
        payload = {**payload, "profile": identity}
        current = await run(repository.detail(group_id, user.id))
        member = next((item for item in current["members"] if item.get("userId") == user.id), None)
        existing = member.get("profile") if isinstance(member, dict) else None
        cleaned = apply_badge_ownership(
            sanitize_profile_config(stamp_join_date(payload, user)),
            existing if isinstance(existing, dict) else None,
            await data_api.list_user_badge_grants(user.id),
        )
        from app.db import achievements
        from app.core.premium import has_premium, protect_write
        cleaned = protect_write(cleaned, existing, await has_premium(user.id))
        cleaned["rank"] = await achievements.current_rank_for_user(user.id)
        return {"group": await run(repository.update_member_profile(group_id, user.id, cleaned))}

    @router.delete("/{group_id}/members/{member_id}")
    async def remove_member(group_id: str, member_id: str, user: User = auth) -> dict[str, Any]:
        return await run(repository.remove_member(group_id, user.id, member_id))

    @router.post("/{group_id}/transfer")
    async def transfer(group_id: str, payload: Transfer, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.transfer(group_id, user.id, payload.user_id))}

    @router.post("/{group_id}/publish")
    async def publish(group_id: str, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.publish(group_id, user.id))}

    @router.post("/{group_id}/unpublish")
    async def unpublish(group_id: str, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.unpublish(group_id, user.id))}

    @router.patch("/{group_id}/background")
    async def update_background_color(group_id: str, payload: BackgroundColor, user: User = auth) -> dict[str, Any]:
        current = await run(repository.detail(group_id, user.id))
        background = {**current["background"], "color": payload.color}
        group, _ = await run(repository.update_background(group_id, user.id, background))
        return {"group": group}

    @router.post("/{group_id}/background")
    async def upload_background(
        group_id: str,
        kind: Literal["image", "video"] = Form(...),
        color: str = Form("#08080d"),
        file: UploadFile = File(...),
        user: User = auth,
    ) -> dict[str, Any]:
        await run(repository.detail(group_id, user.id))
        content_type = (file.content_type or "").lower()
        if not content_type or content_type == "application/octet-stream":
            content_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac"}.get(Path(file.filename or "").suffix.lower(), content_type)
        allowed = {"image/png", "image/jpeg", "image/webp", "image/gif"} if kind == "image" else {"video/mp4", "video/webm", "video/quicktime"}
        limit = 40_000_000 if kind == "image" else 110_000_000
        if content_type not in allowed:
            raise HTTPException(status_code=400, detail="That background file type is not supported.")
        body = await file.read(limit + 1)
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="That background file is too large.")
        settings = get_settings()
        storage = get_r2_storage(settings)
        if not storage.enabled:
            raise HTTPException(status_code=503, detail="R2 object storage is not configured.")
        filename = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file.filename or "background").name).strip(".-")[:100] or "background"
        key = f"constellations/{group_id}/background/{uuid4().hex}-{filename}"
        try:
            await storage.put(key, body, content_type)
            group, old_key = await run(repository.update_background(group_id, user.id, {
                "type": kind, "color": color, "url": storage.public_url(key), "key": key,
                "name": filename, "contentType": content_type,
            }))
        except Exception:
            await storage.delete(key)
            raise
        if old_key and old_key != key:
            try:
                await storage.delete(old_key)
            except Exception:
                pass
        return {"group": group}

    @router.delete("/{group_id}/background")
    async def remove_background(group_id: str, user: User = auth) -> dict[str, Any]:
        current = await run(repository.detail(group_id, user.id))
        group, old_key = await run(repository.update_background(group_id, user.id, {"type": "color", "color": current["background"].get("color", "#08080d")}))
        if old_key:
            try:
                await get_r2_storage(get_settings()).delete(old_key)
            except Exception:
                pass
        return {"group": group}

    @router.patch("/{group_id}/shared/effect")
    async def set_shared_effect(group_id: str, payload: EffectChoice, user: User = auth) -> dict[str, Any]:
        return {"group": await run(repository.update_shared_effect(group_id, user.id, payload.effect))}

    @router.post("/{group_id}/shared/{kind}")
    async def upload_shared_asset(
        group_id: str,
        kind: Literal["cursor", "audio", "audioCover", "effectVideo"],
        file: UploadFile = File(...),
        title: str = Form(""),
        user: User = auth,
    ) -> dict[str, Any]:
        await run(repository.detail(group_id, user.id))
        content_type = (file.content_type or "").lower()
        if not content_type or content_type == "application/octet-stream":
            content_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac"}.get(Path(file.filename or "").suffix.lower(), content_type)
        if kind == "cursor":
            allowed, limit = {"image/png", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"}, 5_000_000
        elif kind == "audioCover":
            allowed, limit = {"image/png", "image/jpeg", "image/webp", "image/gif"}, 15_000_000
        elif kind == "effectVideo":
            allowed, limit = {"video/mp4", "video/webm", "video/quicktime"}, 110_000_000
        else:
            allowed, limit = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/webm"}, 40_000_000
        if content_type not in allowed:
            raise HTTPException(status_code=400, detail=f"That shared {kind} file type is not supported.")
        body = await file.read(limit + 1)
        if len(body) > limit:
            raise HTTPException(status_code=413, detail=f"That shared {kind} file is too large.")
        storage = get_r2_storage(get_settings())
        if not storage.enabled:
            raise HTTPException(status_code=503, detail="R2 object storage is not configured.")
        filename = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file.filename or kind).name).strip(".-")[:100] or kind
        key = f"constellations/{group_id}/shared/{kind}/{uuid4().hex}-{filename}"
        try:
            await storage.put(key, body, content_type)
            group, old_key = await run(repository.update_shared_asset(group_id, user.id, kind, {
                "url": storage.public_url(key), "key": key, "name": filename, "contentType": content_type,
                **({"title": title.strip()[:120]} if kind == "audio" else {}),
            }))
        except Exception:
            await storage.delete(key)
            raise
        if old_key and old_key != key:
            try:
                await storage.delete(old_key)
            except Exception:
                pass
        return {"group": group}

    @router.delete("/{group_id}/shared/{kind}")
    async def remove_shared_asset(group_id: str, kind: Literal["cursor", "audio", "audioCover", "effectVideo"], user: User = auth) -> dict[str, Any]:
        group, old_key = await run(repository.update_shared_asset(group_id, user.id, kind, None))
        if old_key:
            try:
                await get_r2_storage(get_settings()).delete(old_key)
            except Exception:
                pass
        return {"group": group}

    @router.delete("/{group_id}")
    async def delete(group_id: str, user: User = auth) -> dict[str, Any]:
        result = await run(repository.delete(group_id, user.id))
        if result.get("backgroundKey"):
            try:
                await get_r2_storage(get_settings()).delete(result["backgroundKey"])
            except Exception:
                pass
        for key in result.get("sharedKeys", []):
            try:
                await get_r2_storage(get_settings()).delete(key)
            except Exception:
                pass
        result.pop("backgroundKey", None)
        result.pop("sharedKeys", None)
        return result

    return router
