from typing import Annotated, Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.profile_sanitize import apply_badge_ownership, decode_data_url, sanitize_profile_config
from app.core.profiles import default_public_profile, stamp_join_date, unwrap_profile_config
from app.core.rate_limit import rate_limit
from app.core.sessions import get_user_from_request
from app.core.templates import (
    CREATOR_ROLE,
    DESCRIPTION_MAX,
    MAX_TEMPLATES_PER_CREATOR,
    NAME_MAX,
    PREVIEW_IMAGE_MAX_CHARS,
    VISIBILITIES,
    apply_template_snapshot,
    preview_from_snapshot,
    public_template_card,
    slugify,
    snapshot_template_config,
    unique_slug_candidate,
)
from app.db import admin_db, data_api
from app.models import User

router = APIRouter(prefix="/templates", tags=["templates"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _require_store() -> None:
    if not admin_db.has_pool():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Templates are temporarily unavailable.")


def _clean_tags(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        tag = "".join(char for char in str(value).strip().lower() if char.isalnum() or char in " _-").strip()
        if tag and tag not in result:
            result.append(tag[:24])
    return result[:8]


def _clean_visibility(value: str | None, default: str = "public") -> str:
    normalized = str(value or default).strip().lower()
    if normalized not in VISIBILITIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a valid template visibility.")
    return normalized


def _clean_preview_image(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    decoded = decode_data_url(text)
    if not decoded or decoded[1] not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template preview must be a JPEG, PNG, or WebP image.")
    if len(text) > PREVIEW_IMAGE_MAX_CHARS:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Template preview is too large.")
    return text


class PublishRequest(BaseModel):
    name: str = Field(min_length=2, max_length=NAME_MAX)
    description: str = Field(default="", max_length=DESCRIPTION_MAX)
    tags: list[str] = Field(default_factory=list, max_length=8)
    visibility: str = Field(default="public", max_length=16)
    preview_image_url: str | None = Field(default=None, max_length=PREVIEW_IMAGE_MAX_CHARS)


class PreviewImageRequest(BaseModel):
    preview_image_url: str | None = Field(default=None, max_length=PREVIEW_IMAGE_MAX_CHARS)


class ApplyRequest(BaseModel):
    id: str = Field(min_length=8, max_length=64)


class TemplateMetaRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=NAME_MAX)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    published: bool | None = None
    tags: list[str] | None = Field(default=None, max_length=8)
    visibility: str | None = Field(default=None, max_length=16)


async def require_user(request: Request) -> User:
    user = await get_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return user


async def _is_admin(user: User, settings: Settings) -> bool:
    return await admin_db.is_admin_user(user.id, user.is_admin, settings.admin_user_id_list)


async def can_create_templates(user: User, settings: Settings) -> bool:
    if await _is_admin(user, settings):
        return True
    return await admin_db.user_has_role(user.id, CREATOR_ROLE)


async def require_creator(request: Request, settings: SettingsDep) -> User:
    user = await require_user(request)
    if not await can_create_templates(user, settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Template creator access is required.")
    return user


async def _optional_limit(key: str, limit: int, window: int) -> None:
    try:
        await rate_limit(key, limit, window)
    except HTTPException:
        raise
    except (RuntimeError, OSError):
        return


async def _owns_or_admin(row: dict[str, Any], user: User, settings: Settings) -> bool:
    return await _is_admin(user, settings) or str(row.get("created_by") or "") == user.id


async def _saved_snapshot(user: User) -> dict[str, Any]:
    stored = unwrap_profile_config(await data_api.get_profile(user.id))
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Save your look in Customize first, then publish it as a template.",
        )
    return snapshot_template_config(stored)


@router.get("")
async def list_templates(
    user: Annotated[User, Depends(require_user)],
    q: str = Query(default="", max_length=80),
    tag: str = Query(default="", max_length=32),
    sort: str = Query(default="latest", max_length=16),
) -> dict[str, Any]:
    _require_store()
    sort_key = sort.strip().lower()
    if sort_key not in {"latest", "popular", "week", "month", "all_time"}:
        sort_key = "latest"
    rows = await admin_db.list_published_templates(sort_key)
    favorite_ids = await admin_db.template_favorite_ids(user.id)
    needle = q.strip().lower()
    wanted_tag = tag.strip().lower()
    cards = []
    for row in rows:
        card = public_template_card(row)
        card["is_favorite"] = card["id"] in favorite_ids
        preview = card["preview"]
        haystack = " ".join([
            card["name"],
            card["description"],
            *card["tags"],
            str(preview.get("layout") or ""),
            str(preview.get("backgroundEffect") or ""),
        ]).lower()
        if needle and needle not in haystack:
            continue
        if wanted_tag and wanted_tag not in card["tags"]:
            continue
        cards.append(card)
    return {"templates": cards}


@router.get("/me")
async def my_templates(user: Annotated[User, Depends(require_creator)]) -> dict[str, Any]:
    _require_store()
    rows = await admin_db.list_templates_by_creator(user.id)
    return {"templates": [public_template_card(row) for row in rows]}


@router.post("", status_code=201)
async def publish_template(
    payload: PublishRequest,
    user: Annotated[User, Depends(require_creator)],
) -> dict[str, Any]:
    _require_store()
    await _optional_limit(f"rl:tpl-create:{user.id}", 8, 3600)
    if await admin_db.count_templates_for_creator(user.id) >= MAX_TEMPLATES_PER_CREATOR:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You already have the maximum number of templates.")
    snapshot = await _saved_snapshot(user)
    name = payload.name.strip()
    slug = slugify(name)
    tags = _clean_tags(payload.tags)
    visibility = _clean_visibility(payload.visibility)
    preview_image_url = _clean_preview_image(payload.preview_image_url)
    try:
        row = await admin_db.insert_template(
            user.id,
            slug,
            name,
            payload.description.strip(),
            snapshot,
            preview_from_snapshot(snapshot),
            tags,
            visibility,
            preview_image_url,
        )
    except asyncpg.UniqueViolationError:
        row = await admin_db.insert_template(
            user.id,
            unique_slug_candidate(name),
            name,
            payload.description.strip(),
            snapshot,
            preview_from_snapshot(snapshot),
            tags,
            visibility,
            preview_image_url,
        )
    return {"template": public_template_card(row)}


@router.post("/apply")
async def apply_template(
    payload: ApplyRequest,
    user: Annotated[User, Depends(require_user)],
    settings: SettingsDep,
) -> dict[str, Any]:
    _require_store()
    if not user.username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a username before applying a template.")
    try:
        UUID(payload.id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.") from None
    await _optional_limit(f"rl:tpl-apply:{user.id}", 10, 60)
    template = await admin_db.get_template(payload.id)
    owner = str(template.get("created_by") or "") == user.id if template else False
    visible = bool(template and template.get("published")) and str(template.get("visibility") or "public") in {"public", "unlisted"}
    if template is None or (not visible and not owner and not await _is_admin(user, settings)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    snapshot = template.get("config") if isinstance(template.get("config"), dict) else {}
    existing = unwrap_profile_config(await data_api.get_profile(user.id)) or default_public_profile(user)
    merged = apply_template_snapshot(existing, snapshot)
    identity = merged.get("profile") if isinstance(merged.get("profile"), dict) else {}
    identity["username"] = user.username
    identity["uid"] = user.id
    if not str(identity.get("displayName") or "").strip():
        identity["displayName"] = user.display_name or user.username
    merged["profile"] = identity
    saved = await data_api.save_profile(
        user.id,
        apply_badge_ownership(
            sanitize_profile_config(stamp_join_date(merged, user)),
            existing,
            await data_api.list_user_badge_grants(user.id),
        ),
    )
    cleaned = sanitize_profile_config(saved) if isinstance(saved, dict) else saved
    identity = cleaned.get("profile") if isinstance(cleaned, dict) and isinstance(cleaned.get("profile"), dict) else None
    if identity is not None:
        identity["views"] = await data_api.get_profile_view_count(user.id)
    return {"profile": cleaned}


@router.get("/slug/{slug}")
async def template_by_slug(
    slug: str,
    request: Request,
    settings: SettingsDep,
) -> dict[str, Any]:
    _require_store()
    user = await get_user_from_request(request)
    template = await admin_db.get_template_by_slug(slug.strip().lower())
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    owner = bool(user and str(template.get("created_by") or "") == user.id)
    visible = bool(template.get("published")) and str(template.get("visibility") or "public") in {"public", "unlisted"}
    is_admin = bool(user and await _is_admin(user, settings))
    if not visible and not owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    favorite_ids = await admin_db.template_favorite_ids(user.id) if user else set()
    card = public_template_card(template)
    card["is_favorite"] = card["id"] in favorite_ids
    return {"template": card}


class FavoriteRequest(BaseModel):
    favorite: bool = True


@router.post("/{template_id}/favorite")
async def favorite_template(
    template_id: str,
    payload: FavoriteRequest,
    user: Annotated[User, Depends(require_user)],
) -> dict[str, bool]:
    _require_store()
    try:
        UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.") from None
    template = await admin_db.get_template(template_id)
    if template is None or not template.get("published") or str(template.get("visibility") or "public") != "public":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    await admin_db.set_template_favorite(user.id, template_id, payload.favorite)
    return {"favorite": payload.favorite}


@router.post("/{template_id}/refresh")
async def refresh_template(
    template_id: str,
    user: Annotated[User, Depends(require_creator)],
    settings: SettingsDep,
    payload: PreviewImageRequest | None = None,
) -> dict[str, Any]:
    _require_store()
    await _optional_limit(f"rl:tpl-refresh:{user.id}", 8, 3600)
    template = await _require_owned_template(template_id, user, settings)
    snapshot = await _saved_snapshot(user)
    preview_image_url = _clean_preview_image(payload.preview_image_url) if payload else None
    updated = await admin_db.refresh_template_snapshot(str(template["id"]), snapshot, preview_from_snapshot(snapshot), preview_image_url)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    return {"template": public_template_card(updated)}


@router.patch("/{template_id}")
async def update_template(
    template_id: str,
    payload: TemplateMetaRequest,
    user: Annotated[User, Depends(require_creator)],
    settings: SettingsDep,
) -> dict[str, Any]:
    template = await _require_owned_template(template_id, user, settings)
    next_slug = slugify(payload.name) if payload.name else None
    try:
        updated = await admin_db.update_template_meta(
            str(template["id"]),
            name=payload.name.strip() if payload.name else None,
            description=payload.description.strip() if payload.description is not None else None,
            published=payload.published,
            slug=next_slug,
            tags=_clean_tags(payload.tags) if payload.tags is not None else None,
            visibility=_clean_visibility(payload.visibility) if payload.visibility is not None else None,
        )
    except asyncpg.UniqueViolationError:
        updated = await admin_db.update_template_meta(
            str(template["id"]),
            name=payload.name.strip() if payload.name else None,
            description=payload.description.strip() if payload.description is not None else None,
            published=payload.published,
            slug=unique_slug_candidate(payload.name or template["name"]),
            tags=_clean_tags(payload.tags) if payload.tags is not None else None,
            visibility=_clean_visibility(payload.visibility) if payload.visibility is not None else None,
        )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    return {"template": public_template_card(updated)}


@router.delete("/{template_id}")
async def remove_template(
    template_id: str,
    user: Annotated[User, Depends(require_creator)],
    settings: SettingsDep,
) -> dict[str, bool]:
    template = await _require_owned_template(template_id, user, settings)
    await admin_db.delete_template(str(template["id"]))
    return {"ok": True}


async def _require_owned_template(template_id: str, user: User, settings: Settings) -> dict[str, Any]:
    try:
        UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.") from None
    template = await admin_db.get_template(template_id)
    if template is None or not await _owns_or_admin(template, user, settings):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")
    return template
