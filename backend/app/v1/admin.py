from datetime import datetime
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.v1.admin_auth import AdminSession
from app.db import admin_db

router = APIRouter(prefix="/admin", tags=["admin"])
AdminUser = AdminSession


class SuspensionRequest(BaseModel):
    suspended: bool
    reason: str | None = Field(default=None, max_length=500)
    until: datetime | None = None


class ReservedUsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    reason: str | None = Field(default=None, max_length=500)


class BadgeRequest(BaseModel):
    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=500)
    color: str = Field(default="#9b87f5", max_length=32)
    badge_type: str = Field(default="custom", pattern=r"^(official|verification|custom|purchased)$")
    icon_url: str | None = Field(default=None, max_length=2048)
    active: bool = True


class UserBadgeRequest(BaseModel):
    enabled: bool = True
    reason: str | None = Field(default=None, max_length=500)


class ProfileActionRequest(BaseModel):
    disabled: bool
    reason: str | None = Field(default=None, max_length=500)


class UsernameChangeRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-z][a-z0-9_]{2,23}$")
    reason: str = Field(min_length=1, max_length=500)


class BadgeRevokeRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class EntitlementRequest(BaseModel):
    user_id: UUID
    plan: str = Field(min_length=1, max_length=64)
    active: bool = True
    expires_at: datetime | None = None


class ReportRequest(BaseModel):
    status: str = Field(pattern=r"^(open|reviewed|resolved|dismissed)$")


class FeatureFlagRequest(BaseModel):
    enabled: bool
    description: str = Field(default="", max_length=500)


class ThemeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    config: dict = Field(default_factory=dict)
    active: bool = True


@router.get("/users")
async def users(
    _admin: AdminUser,
    search: str = Query(default="", max_length=128),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return {"users": await admin_db.search_users(search, limit, offset), "limit": limit, "offset": offset}


@router.get("/overview")
async def overview(_admin: AdminUser) -> dict:
    return await admin_db.overview()


@router.get("/users/{user_id}")
async def user_detail(user_id: UUID, _admin: AdminUser) -> dict:
    result = await admin_db.user_detail(user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return result


@router.patch("/users/{user_id}/suspension")
async def suspension(user_id: UUID, payload: SuspensionRequest, admin: AdminUser) -> dict:
    changed = await admin_db.set_suspension(admin.id, user_id, payload.suspended, payload.reason, payload.until)
    if not changed:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"ok": True}


@router.patch("/users/{user_id}/profile")
async def profile_state(user_id: UUID, payload: ProfileActionRequest, admin: AdminUser) -> dict:
    if not await admin_db.disable_profile(admin.id, user_id, payload.disabled, payload.reason):
        raise HTTPException(status_code=404, detail="Profile not found.")
    return {"ok": True}


@router.get("/reserved-usernames")
async def reserved_usernames(_admin: AdminUser) -> dict:
    return {"reserved": await admin_db.list_reserved()}


@router.post("/reserved-usernames", status_code=201)
async def add_reserved_username(payload: ReservedUsernameRequest, admin: AdminUser) -> dict:
    try:
        await admin_db.add_reserved(admin.id, payload.username.strip().lower(), payload.reason)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That username is already reserved.") from None
    return {"ok": True}


@router.delete("/reserved-usernames/{username}")
async def remove_reserved_username(username: str, admin: AdminUser) -> dict:
    if not await admin_db.remove_reserved(admin.id, username):
        raise HTTPException(status_code=404, detail="Reserved username not found.")
    return {"ok": True}


@router.get("/username-history")
async def all_username_history(_admin: AdminUser) -> dict:
    return {"history": await admin_db.username_history()}


@router.post("/users/{user_id}/username")
async def force_username(user_id: UUID, payload: UsernameChangeRequest, admin: AdminUser) -> dict:
    try:
        changed = await admin_db.force_change_username(admin.id, user_id, payload.username.lower(), payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not changed:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"ok": True}


@router.get("/badges")
async def badges(_admin: AdminUser) -> dict:
    return {"badges": await admin_db.list_badges()}


@router.post("/badges", status_code=201)
async def add_badge(payload: BadgeRequest, admin: AdminUser) -> dict:
    try:
        await admin_db.add_badge(admin.id, payload.id, payload.name, payload.description, payload.color, payload.badge_type, payload.icon_url)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That badge ID already exists.") from None
    return {"ok": True}


@router.patch("/badges/{badge_id}")
async def edit_badge(badge_id: str, payload: BadgeRequest, admin: AdminUser) -> dict:
    if payload.id != badge_id:
        raise HTTPException(status_code=400, detail="Badge ID cannot be changed.")
    if not await admin_db.update_badge(admin.id, badge_id, payload.name, payload.description, payload.color, payload.badge_type, payload.icon_url, payload.active):
        raise HTTPException(status_code=404, detail="Badge not found.")
    return {"ok": True}


@router.delete("/badges/{badge_id}")
async def remove_badge(badge_id: str, admin: AdminUser) -> dict:
    try:
        removed = await admin_db.delete_badge(admin.id, badge_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not removed:
        raise HTTPException(status_code=404, detail="Badge not found.")
    return {"ok": True}


@router.get("/users/{user_id}/badges")
async def user_badges(user_id: UUID, _admin: AdminUser) -> dict:
    return {"badges": await admin_db.list_user_badges(user_id, include_revoked=True)}


@router.put("/users/{user_id}/badges/{badge_id}")
async def assign_badge(user_id: UUID, badge_id: str, payload: UserBadgeRequest, admin: AdminUser) -> dict:
    try:
        await admin_db.assign_badge(admin.id, user_id, badge_id, payload.enabled, payload.reason)
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="User or badge not found.") from None
    return {"ok": True}


@router.delete("/users/{user_id}/badges/{badge_id}")
async def remove_user_badge(user_id: UUID, badge_id: str, payload: BadgeRevokeRequest, admin: AdminUser) -> dict:
    if not await admin_db.revoke_badge(admin.id, user_id, badge_id, payload.reason):
        raise HTTPException(status_code=404, detail="Active badge assignment not found.")
    return {"ok": True}


@router.get("/entitlements")
async def entitlements(_admin: AdminUser) -> dict:
    return {"entitlements": await admin_db.list_entitlements()}


@router.post("/entitlements", status_code=201)
async def add_entitlement(payload: EntitlementRequest, admin: AdminUser) -> dict:
    try:
        entitlement_id = await admin_db.add_entitlement(admin.id, payload.user_id, payload.plan, payload.active, payload.expires_at)
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    return {"id": entitlement_id}


@router.get("/reports")
async def reports(_admin: AdminUser) -> dict:
    return {"reports": await admin_db.list_reports()}


@router.patch("/reports/{report_id}")
async def update_report(report_id: UUID, payload: ReportRequest, admin: AdminUser) -> dict:
    if not await admin_db.update_report(admin.id, report_id, payload.status):
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"ok": True}


@router.get("/feature-flags")
async def feature_flags(_admin: AdminUser) -> dict:
    return {"flags": await admin_db.list_flags()}


@router.put("/feature-flags/{key}")
async def update_feature_flag(key: str, payload: FeatureFlagRequest, admin: AdminUser) -> dict:
    await admin_db.update_flag(admin.id, key, payload.enabled, payload.description)
    return {"ok": True}


@router.get("/audit-logs")
async def audit_logs(_admin: AdminUser) -> dict:
    return {"logs": await admin_db.list_audit_logs()}


@router.get("/bakaboost")
async def bakaboost(_admin: AdminUser) -> dict:
    return {"connections": await admin_db.list_bakaboost_connections()}


@router.get("/themes")
async def themes(_admin: AdminUser) -> dict:
    return {"themes": await admin_db.list_themes()}


@router.post("/themes", status_code=201)
async def save_theme(payload: ThemeRequest, admin: AdminUser) -> dict:
    try:
        theme_id = await admin_db.save_theme(admin.id, payload.name, payload.config, payload.active)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That theme name already exists.") from None
    return {"id": theme_id}
