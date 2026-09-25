from datetime import datetime
from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.security import normalize_banned_word, normalize_ip
from app.core.profile_sanitize import HEX_COLOR, css_hex_color, decode_data_url, is_safe_social_icon
from app.core.sessions import revoke_all_sessions
from app.db import admin_db
from app.db.admin_db import STAFF_ROLES, STAFF_SECTIONS
from app.models import User
from app.api.v1.admin_auth import require_admin_session

router = APIRouter(prefix="/admin", tags=["admin"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _admin_path_tail(path: str) -> str:
    if "/admin/" in path:
        return "/" + path.split("/admin/", 1)[1]
    return path


def section_for_admin_path(path: str) -> str | None:
    tail = _admin_path_tail(path)
    if tail.startswith("/access") or tail.startswith("/staff"):
        return None
    if "/badges" in tail or tail.startswith("/verification") or tail.startswith("/badge-platform"):
        return "badges"
    prefixes = (
        ("/users", "users"),
        ("/constellations", "constellations"),
        ("/bans", "bans"),
        ("/reserved-usernames", "reserved"),
        ("/banned-words", "banned"),
        ("/entitlements", "premium"),
        ("/reports", "reports"),
        ("/feature-flags", "flags"),
        ("/bakaboost", "bakaboost"),
        ("/themes", "themes"),
        ("/templates", "templates"),
        ("/fonts", "fonts"),
        ("/audit-logs", "audit"),
    )
    for prefix, section in prefixes:
        if tail == prefix or tail.startswith(prefix + "/"):
            return section
    return None


async def require_admin(request: Request, settings: SettingsDep) -> User:
    account = await require_admin_session(request, settings)
    role = "owner" if account.role == "super_admin" else account.role
    user = User(id=str(account.id), email=account.email, display_name=account.name, is_admin=True)
    if role not in {"owner", "admin", "moderator"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required.")
    tail = _admin_path_tail(request.url.path)
    if tail.startswith("/access") and request.method not in {"GET", "HEAD"} and role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners can change role access.")
    if tail.startswith("/staff") and role not in {"owner", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot assign staff roles.")
    section = section_for_admin_path(request.url.path)
    if section and not await admin_db.section_enabled(role, section):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this section.")
    request.state.staff_role = role
    return user


AdminUser = Annotated[User, Depends(require_admin)]


class SuspensionRequest(BaseModel):
    suspended: bool
    reason: str | None = Field(default=None, max_length=500)
    until: datetime | None = None


class ReservedUsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    reason: str | None = Field(default=None, max_length=500)


class BannedWordRequest(BaseModel):
    word: str = Field(min_length=2, max_length=24)
    reason: str | None = Field(default=None, max_length=500)


class AccountBanRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    reason: str | None = Field(default=None, max_length=500)


class IpBanRequest(BaseModel):
    ip: str = Field(min_length=3, max_length=45)
    reason: str | None = Field(default=None, max_length=500)


class BadgeRequest(BaseModel):
    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=500)
    color: str = Field(default="#9b87f5", max_length=32)
    icon: str = Field(default="", max_length=1_100_000)


class UserBadgeRequest(BaseModel):
    enabled: bool = True


class BadgeGrantRequest(BaseModel):
    user: str = Field(default="", max_length=64)
    username: str = Field(default="", max_length=64)
    granted: bool = True


class VerificationReviewRequest(BaseModel):
    status: str = Field(pattern=r"^(approved|rejected)$")
    note: str = Field(default="", max_length=400)


class EntitlementRequest(BaseModel):
    user_id: UUID
    plan: str = Field(min_length=1, max_length=64)
    active: bool = True
    expires_at: datetime | None = None


class PremiumRankRequest(BaseModel):
    name: str = Field(min_length=2, max_length=64)


class PremiumRankGrantRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)


class ReportRequest(BaseModel):
    status: str = Field(pattern=r"^(open|reviewed|resolved|dismissed)$")


class FeatureFlagRequest(BaseModel):
    enabled: bool
    description: str = Field(default="", max_length=500)


class ThemeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    config: dict = Field(default_factory=dict)
    active: bool = True


class DefaultFontRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    data_url: str = Field(min_length=32, max_length=2_800_000)
    mime_type: str = Field(min_length=3, max_length=80)


class UserRoleRequest(BaseModel):
    role: str = Field(min_length=2, max_length=64)
    granted: bool = True


class StaffAccessRequest(BaseModel):
    role: str = Field(min_length=5, max_length=16)
    sections: dict[str, bool] = Field(default_factory=dict)


class StaffAssignRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    role: str = Field(min_length=5, max_length=16)
    granted: bool = True


@router.get("/users")
async def users(
    _admin: AdminUser,
    settings: SettingsDep,
    search: str = Query(default="", max_length=128),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return {"users": await admin_db.search_users(search, limit, offset, settings.admin_user_id_list), "limit": limit, "offset": offset}


@router.patch("/users/{user_id}/suspension")
async def suspension(user_id: UUID, payload: SuspensionRequest, admin: AdminUser) -> dict:
    changed = await admin_db.set_suspension(admin.id, user_id, payload.suspended, payload.reason, payload.until)
    if not changed:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"ok": True}


async def _assign_staff_role(actor: User, target_id: str, role: str, granted: bool, settings: Settings, request: Request) -> dict:
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="That role cannot be granted here.")
    actor_role = getattr(request.state, "staff_role", None) or await admin_db.staff_role(actor.id, actor.is_admin, settings.admin_user_id_list)
    target_role = await admin_db.staff_role(target_id, False, settings.admin_user_id_list)
    if target_role == "owner":
        raise HTTPException(status_code=400, detail="Owner roles cannot be changed here.")
    if role == "admin" and actor_role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can assign admin.")
    if role == "moderator" and actor_role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="You cannot assign moderator.")
    if actor_role == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot change other admins.")
    try:
        changed = await admin_db.set_staff_role(actor.id, UUID(target_id), role, granted)
    except ValueError:
        raise HTTPException(status_code=400, detail="That role cannot be granted here.") from None
    if not changed:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"ok": True, "role": role, "granted": granted, "user": target_id}


@router.patch("/users/{user_id}/roles")
async def set_user_role(user_id: UUID, payload: UserRoleRequest, admin: AdminUser, settings: SettingsDep, request: Request) -> dict:
    if payload.role == "template_creator":
        changed = await admin_db.set_user_role(admin.id, user_id, payload.role, payload.granted)
        if not changed:
            raise HTTPException(status_code=404, detail="User not found.")
        return {"ok": True, "role": payload.role, "granted": payload.granted}
    return await _assign_staff_role(admin, str(user_id), payload.role, payload.granted, settings, request)


@router.get("/staff")
async def staff_members(_admin: AdminUser) -> dict:
    return {"staff": await admin_db.list_staff()}


@router.post("/staff", status_code=201)
async def assign_staff(payload: StaffAssignRequest, admin: AdminUser, settings: SettingsDep, request: Request) -> dict:
    target = await admin_db.resolve_user_ref(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    return await _assign_staff_role(admin, target, payload.role, payload.granted, settings, request)


@router.delete("/staff/{username}")
async def remove_staff(username: str, admin: AdminUser, settings: SettingsDep, request: Request, role: str = Query(default="moderator", max_length=16)) -> dict:
    target = await admin_db.resolve_user_ref(username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    return await _assign_staff_role(admin, target, role, False, settings, request)


@router.get("/access")
async def staff_access(admin: AdminUser, settings: SettingsDep, request: Request) -> dict:
    role = getattr(request.state, "staff_role", None) or await admin_db.staff_role(admin.id, admin.is_admin, settings.admin_user_id_list)
    payload = {"role": role, "sections": await admin_db.allowed_sections(role)}
    if role == "owner":
        payload["access"] = await admin_db.list_section_access()
    return payload


@router.put("/access")
async def update_staff_access(payload: StaffAccessRequest, admin: AdminUser) -> dict:
    if payload.role not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Pick admin or moderator.")
    sections = {key: bool(value) for key, value in payload.sections.items() if key in STAFF_SECTIONS}
    updated = await admin_db.set_section_access(admin.id, payload.role, sections)
    return {"ok": True, "role": payload.role, "sections": updated}


class TemplatePublishRequest(BaseModel):
    published: bool


@router.get("/templates")
async def admin_templates(_admin: AdminUser) -> dict:
    from app.core.templates import public_template_card
    return {"templates": [public_template_card(row) for row in await admin_db.list_all_templates()]}


@router.patch("/templates/{template_id}")
async def admin_update_template(template_id: UUID, payload: TemplatePublishRequest, _admin: AdminUser) -> dict:
    from app.core.templates import public_template_card
    updated = await admin_db.update_template_meta(str(template_id), published=payload.published)
    if updated is None:
        raise HTTPException(status_code=404, detail="Template not found.")
    return {"template": public_template_card(updated)}


@router.delete("/templates/{template_id}")
async def admin_delete_template(template_id: UUID, _admin: AdminUser) -> dict:
    if not await admin_db.delete_template(str(template_id)):
        raise HTTPException(status_code=404, detail="Template not found.")
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
    if await admin_db.has_username_history(username):
        raise HTTPException(status_code=409, detail="Former usernames stay reserved so old links keep working.")
    if not await admin_db.remove_reserved(admin.id, username):
        raise HTTPException(status_code=404, detail="Reserved username not found.")
    return {"ok": True}


@router.get("/banned-words")
async def banned_words(_admin: AdminUser) -> dict:
    return {"words": await admin_db.list_banned_words()}


@router.post("/banned-words", status_code=201)
async def add_banned_word(payload: BannedWordRequest, admin: AdminUser) -> dict:
    try:
        word = normalize_banned_word(payload.word)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    try:
        await admin_db.add_banned_word(admin.id, word, payload.reason)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That word is already banned.") from None
    return {"ok": True}


@router.delete("/banned-words/{word}")
async def remove_banned_word(word: str, admin: AdminUser) -> dict:
    try:
        cleaned = normalize_banned_word(word)
    except ValueError:
        raise HTTPException(status_code=404, detail="Banned word not found.") from None
    if not await admin_db.remove_banned_word(admin.id, cleaned):
        raise HTTPException(status_code=404, detail="Banned word not found.")
    return {"ok": True}


@router.get("/bans")
async def list_bans(_admin: AdminUser) -> dict:
    return {"accounts": await admin_db.list_account_bans(), "ips": await admin_db.list_ip_bans()}


@router.post("/bans/accounts", status_code=201)
async def add_account_ban(payload: AccountBanRequest, admin: AdminUser, settings: SettingsDep) -> dict:
    target = await admin_db.get_user_id_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if await admin_db.is_admin_user(target, False, settings.admin_user_id_list):
        raise HTTPException(status_code=400, detail="Administrator accounts cannot be banned.")
    try:
        banned = await admin_db.ban_account(admin.id, target, payload.reason)
    except LookupError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    except PermissionError:
        raise HTTPException(status_code=400, detail="Administrator accounts cannot be banned.") from None
    except ValueError:
        raise HTTPException(status_code=409, detail="That account is already banned.") from None
    await revoke_all_sessions(str(banned["user_id"]))
    return {"ok": True, "ban": banned}


@router.delete("/bans/accounts/{username}")
async def remove_account_ban(username: str, admin: AdminUser) -> dict:
    user_id = await admin_db.unban_account(admin.id, username)
    if user_id is None:
        raise HTTPException(status_code=404, detail="That account is not banned.")
    return {"ok": True}


@router.post("/bans/ips", status_code=201)
async def add_ip_ban(payload: IpBanRequest, admin: AdminUser) -> dict:
    try:
        banned = await admin_db.ban_ip(admin.id, payload.ip, payload.reason)
    except ValueError as exc:
        if str(exc) == "exists":
            raise HTTPException(status_code=409, detail="That IP is already banned.") from None
        raise HTTPException(status_code=400, detail=str(exc)) from None
    for user_id in banned.get("user_ids") or []:
        await revoke_all_sessions(str(user_id))
    return {"ok": True, "ban": {"ip": banned["ip"], "usernames": banned["usernames"]}}


@router.delete("/bans/ips")
async def remove_ip_ban(admin: AdminUser, ip: str = Query(min_length=3, max_length=45)) -> dict:
    try:
        cleaned = normalize_ip(ip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    user_ids = await admin_db.unban_ip(admin.id, cleaned)
    if user_ids is None:
        raise HTTPException(status_code=404, detail="That IP is not banned.")
    return {"ok": True}


@router.get("/badges")
async def badges(_admin: AdminUser) -> dict:
    """Compatibility listing backed by the dynamic platform."""
    return {"badges": await achievements.list_badges_admin()}


@router.post("/badges", status_code=410)
async def add_badge(_payload: BadgeRequest, _admin: AdminUser) -> dict:
    raise HTTPException(status_code=410, detail="Use the Badge + Rank platform so assets are validated and stored in R2.")


@router.put("/users/{user_id}/badges/{badge_id}")
async def assign_badge(user_id: UUID, badge_id: str, _payload: UserBadgeRequest, admin: AdminUser) -> dict:
    try:
        changed = await achievements.assign(admin.id, user_id, "BADGE", badge_id, reason="Assigned through legacy admin route")
    except (LookupError, PermissionError, ValueError):
        raise HTTPException(status_code=404, detail="User or badge not found, or manual assignment is disabled.") from None
    return {"ok": True, "changed": changed}


@router.put("/badges/{badge_id}/grants")
async def grant_badge_by_username(badge_id: str, payload: BadgeGrantRequest, admin: AdminUser) -> dict:
    target = (payload.user or payload.username).strip()
    if len(target) < 3:
        raise HTTPException(status_code=400, detail="Enter a user ID or username.")
    user_id = await admin_db.resolve_user_ref(target)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found.")
    try:
        changed = await (achievements.assign(admin.id, UUID(user_id), "BADGE", badge_id, reason="Assigned through legacy admin route") if payload.granted else achievements.revoke(admin.id, UUID(user_id), "BADGE", badge_id, "Removed through legacy admin route"))
    except (LookupError, PermissionError, ValueError):
        raise HTTPException(status_code=404, detail="User or badge not found, or manual assignment is disabled.") from None
    return {"ok": True, "user": user_id, "granted": payload.granted, "changed": changed}


@router.delete("/badges/{badge_id}")
async def delete_badge(badge_id: str, admin: AdminUser) -> dict:
    try:
        action = await achievements.delete_badge(admin.id, badge_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Badge not found.") from None
    return {"ok": True, "action": action}

@router.get("/verification")
async def verification_queue(_admin: AdminUser, status: str = Query(default="", max_length=16)) -> dict:
    wanted = status if status in {"pending", "approved", "rejected"} else None
    return {"requests": await admin_db.list_verification_requests(wanted)}


@router.patch("/verification/{request_id}")
async def review_verification(request_id: UUID, payload: VerificationReviewRequest, admin: AdminUser) -> dict:
    note = " ".join((payload.note or "").split())[:400]
    updated = await admin_db.review_verification_request(admin.id, request_id, payload.status, note)
    if updated is None:
        raise HTTPException(status_code=404, detail="That request is not pending.")
    return {"ok": True, "request": updated}


@router.get("/entitlements")
async def entitlements(_admin: AdminUser) -> dict:
    return {"ranks": await admin_db.list_premium_ranks(), "entitlements": await admin_db.list_entitlements()}


@router.post("/entitlements", status_code=201)
async def add_entitlement(payload: EntitlementRequest, admin: AdminUser) -> dict:
    try:
        entitlement_id = await admin_db.add_entitlement(admin.id, payload.user_id, payload.plan, payload.active, payload.expires_at)
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    return {"id": entitlement_id}


@router.post("/entitlements/ranks", status_code=201)
async def create_premium_rank(payload: PremiumRankRequest, admin: AdminUser) -> dict:
    try:
        rank = await admin_db.add_premium_rank(admin.id, payload.name)
    except ValueError as exc:
        if str(exc) == "exists":
            raise HTTPException(status_code=409, detail="That rank already exists.") from None
        raise HTTPException(status_code=400, detail="Enter a rank name.") from None
    return {"ok": True, "rank": rank}


@router.get("/entitlements/ranks/{rank_id}")
async def premium_rank(rank_id: UUID, _admin: AdminUser) -> dict:
    rank = await admin_db.get_premium_rank(rank_id)
    if rank is None:
        raise HTTPException(status_code=404, detail="Rank not found.")
    return {"rank": rank}


@router.post("/entitlements/ranks/{rank_id}/grants", status_code=201)
async def grant_premium_rank(rank_id: UUID, payload: PremiumRankGrantRequest, admin: AdminUser) -> dict:
    target = await admin_db.resolve_user_ref(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    try:
        grant_id = await admin_db.grant_premium_rank(admin.id, rank_id, UUID(target))
    except LookupError:
        raise HTTPException(status_code=404, detail="Rank not found.") from None
    except ValueError:
        raise HTTPException(status_code=409, detail="That user already has this rank.") from None
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    return {"ok": True, "id": grant_id}


@router.delete("/entitlements/ranks/{rank_id}/grants/{username}")
async def revoke_premium_rank(rank_id: UUID, username: str, admin: AdminUser) -> dict:
    target = await admin_db.resolve_user_ref(username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    try:
        revoked = await admin_db.revoke_premium_rank(admin.id, rank_id, UUID(target))
    except LookupError:
        raise HTTPException(status_code=404, detail="Rank not found.") from None
    if not revoked:
        raise HTTPException(status_code=404, detail="That user does not have this rank.")
    return {"ok": True}


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


@router.get("/fonts")
async def default_fonts(_admin: AdminUser) -> dict:
    return {"fonts": await admin_db.list_default_fonts()}


@router.put("/fonts/{slot}")
async def save_default_font(slot: int, payload: DefaultFontRequest, admin: AdminUser) -> dict:
    if slot not in range(2, 12):
        raise HTTPException(status_code=400, detail="Font slot must be between 2 and 11.")
    decoded = decode_data_url(payload.data_url)
    allowed = {
        "font/woff2",
        "font/woff",
        "font/ttf",
        "font/otf",
        "font/opentype",
        "application/font-woff2",
        "application/font-woff",
        "application/x-font-ttf",
        "application/x-font-otf",
        "application/vnd.ms-opentype",
    }
    if not decoded or decoded[1].lower() not in allowed:
        raise HTTPException(status_code=400, detail="Upload a WOFF2, WOFF, TTF, or OTF font.")
    if len(decoded[0]) > 2_000_000:
        raise HTTPException(status_code=413, detail="Font must be smaller than 2 MB.")
    await admin_db.save_default_font(admin.id, slot, payload.name.strip(), payload.data_url, decoded[1].lower())
    return {"ok": True, "fonts": await admin_db.list_default_fonts()}


@router.delete("/fonts/{slot}")
async def delete_default_font(slot: int, admin: AdminUser) -> dict:
    if slot not in range(2, 12):
        raise HTTPException(status_code=400, detail="Font slot must be between 2 and 11.")
    if not await admin_db.delete_default_font(admin.id, slot):
        raise HTTPException(status_code=404, detail="Font slot is already empty.")
    return {"ok": True}


class ConstellationModerationRequest(BaseModel):
    suspended: bool


def _constellation_repository(request: Request):
    repository = getattr(request.app.state, "constellations", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="Constellations are unavailable.")
    return repository


async def _constellation_admin_call(operation):
    from app.constellation_system.repository import DomainError
    try:
        return await operation
    except DomainError as error:
        raise HTTPException(status_code=error.status, detail=error.message) from error


@router.get("/constellations")
async def admin_constellations(
    request: Request,
    _admin: AdminUser,
    search: str = Query(default="", max_length=128),
    status_filter: str = Query(default="", alias="status", max_length=16),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict:
    repository = _constellation_repository(request)
    return {"constellations": await _constellation_admin_call(repository.admin_list(search, status_filter, limit))}


@router.get("/constellations/{constellation_id}")
async def admin_constellation_detail(constellation_id: str, request: Request, _admin: AdminUser) -> dict:
    repository = _constellation_repository(request)
    return {"constellation": await _constellation_admin_call(repository.admin_detail(constellation_id))}


@router.patch("/constellations/{constellation_id}/status")
async def admin_constellation_status(
    constellation_id: str,
    payload: ConstellationModerationRequest,
    request: Request,
    admin: AdminUser,
) -> dict:
    repository = _constellation_repository(request)
    return {"constellation": await _constellation_admin_call(repository.admin_status(constellation_id, admin.id, payload.suspended))}


@router.delete("/constellations/{constellation_id}/members/{member_id}")
async def admin_constellation_remove_member(
    constellation_id: str,
    member_id: str,
    request: Request,
    admin: AdminUser,
) -> dict:
    if getattr(request.state, "staff_role", "") not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only owners and administrators can remove members.")
    repository = _constellation_repository(request)
    return {"constellation": await _constellation_admin_call(repository.admin_remove_member(constellation_id, admin.id, member_id))}


@router.delete("/constellations/{constellation_id}/invitations/{invitation_id}")
async def admin_constellation_revoke_invite(
    constellation_id: str,
    invitation_id: str,
    request: Request,
    admin: AdminUser,
) -> dict:
    repository = _constellation_repository(request)
    return {"constellation": await _constellation_admin_call(repository.admin_revoke_invite(constellation_id, admin.id, invitation_id))}


@router.delete("/constellations/{constellation_id}")
async def admin_constellation_delete(constellation_id: str, request: Request, admin: AdminUser) -> dict:
    if getattr(request.state, "staff_role", "") not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only owners and administrators can delete Constellations.")
    repository = _constellation_repository(request)
    result = await _constellation_admin_call(repository.delete(constellation_id, admin.id, admin=True))
    key = result.pop("backgroundKey", None)
    if key:
        from app.core.r2_storage import get_r2_storage
        try:
            await get_r2_storage(get_settings()).delete(key)
        except Exception:
            pass
    return result


# Dynamic Badge + Rank platform endpoints. Kept in this router so the existing OTP/session
# and section-permission dependency protects every operation server-side.
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import File, UploadFile
from PIL import Image, UnidentifiedImageError

from app.core.r2_storage import get_r2_storage
from app.db import achievements


class AchievementDefinitionRequest(BaseModel):
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    color: str = Field(default="#9b87f5", max_length=32)
    categoryId: UUID | None = None
    rarity: str = Field(default="COMMON", max_length=32)
    level: int = Field(default=0, ge=0, le=1_000_000)
    displayOrder: int = Field(default=0, ge=-1_000_000, le=1_000_000)
    requirements: list[dict] = Field(default_factory=list, max_length=12)
    automaticAward: bool = False
    manualAssignmentAllowed: bool = True
    visibility: str = Field(default="PUBLIC", pattern=r"^(PUBLIC|PRIVATE)$")
    limited: bool = False
    maxAwards: int | None = Field(default=None, ge=1)
    availableFrom: datetime | None = None
    expiresAt: datetime | None = None
    purchasable: bool = False
    priceMinor: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    active: bool = True
    badgeIds: list[str] = Field(default_factory=list, max_length=100)


class AchievementCategoryRequest(BaseModel):
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=96)
    description: str = Field(default="", max_length=500)
    displayOrder: int = Field(default=0, ge=-1_000_000, le=1_000_000)
    active: bool = True


class AchievementAssignmentRequest(BaseModel):
    user: str = Field(min_length=3, max_length=128)
    itemType: str = Field(pattern=r"^(BADGE|RANK)$")
    itemId: str = Field(min_length=2, max_length=64)
    action: str = Field(pattern=r"^(ASSIGN|REMOVE)$")
    reason: str = Field(default="", max_length=500)


class PurchaseTransitionRequest(BaseModel):
    status: str = Field(pattern=r"^(PENDING|FAILED|REFUNDED|CANCELLED)$")
    providerReference: str = Field(default="", max_length=255)


@router.get("/badge-platform/categories")
async def achievement_categories(_admin: AdminUser) -> dict:
    return {"categories": await achievements.list_categories()}


@router.post("/badge-platform/categories", status_code=201)
async def create_achievement_category(payload: AchievementCategoryRequest, admin: AdminUser) -> dict:
    try:
        item = await achievements.save_category(admin.id, payload.model_dump())
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That category slug already exists.") from None
    return {"category": item}


@router.put("/badge-platform/categories/{category_id}")
async def update_achievement_category(category_id: UUID, payload: AchievementCategoryRequest, admin: AdminUser) -> dict:
    try:
        item = await achievements.save_category(admin.id, payload.model_dump(), category_id)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That category slug already exists.") from None
    return {"category": item}


@router.delete("/badge-platform/categories/{category_id}")
async def remove_achievement_category(category_id: UUID, admin: AdminUser) -> dict:
    if not await achievements.delete_category(admin.id, category_id):
        raise HTTPException(status_code=404, detail="Category not found.")
    return {"ok": True}


@router.get("/badge-platform/badges")
async def achievement_badges(_admin: AdminUser, search: str = Query(default="", max_length=128)) -> dict:
    return {"badges": await achievements.list_badges_admin(search)}


@router.post("/badge-platform/badges", status_code=201)
async def create_achievement_badge(payload: AchievementDefinitionRequest, admin: AdminUser) -> dict:
    if not HEX_COLOR.match(payload.color):
        raise HTTPException(status_code=400, detail="Pick a valid badge color.")
    try:
        badge = await achievements.save_badge(admin.id, payload.model_dump())
    except (ValueError, asyncpg.ForeignKeyViolationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid badge definition.") from None
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That badge slug already exists.") from None
    return {"badge": badge}


@router.put("/badge-platform/badges/{badge_id}")
async def update_achievement_badge(badge_id: str, payload: AchievementDefinitionRequest, admin: AdminUser) -> dict:
    if not HEX_COLOR.match(payload.color):
        raise HTTPException(status_code=400, detail="Pick a valid badge color.")
    try:
        badge = await achievements.save_badge(admin.id, payload.model_dump(), badge_id)
    except (ValueError, asyncpg.ForeignKeyViolationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid badge definition.") from None
    return {"badge": badge}


@router.delete("/badge-platform/badges/{badge_id}")
async def remove_achievement_badge(badge_id: str, admin: AdminUser) -> dict:
    try:
        action = await achievements.delete_badge(admin.id, badge_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Badge not found.") from None
    return {"ok": True, "action": action}


@router.post("/badge-platform/badges/{badge_id}/asset")
async def upload_achievement_badge_asset(badge_id: str, admin: AdminUser, settings: SettingsDep, file: UploadFile = File(...)) -> dict:
    allowed = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    mime = (file.content_type or "").lower()
    if mime not in allowed:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPG, WebP, or GIF badge.")
    if not await admin_db.database_pool().fetchval("SELECT EXISTS(SELECT 1 FROM badges WHERE id=$1)", badge_id):
        raise HTTPException(status_code=404, detail="Badge not found.")
    body = await file.read(2_000_001)
    if not body or len(body) > 2_000_000:
        raise HTTPException(status_code=413, detail="Badge assets must be smaller than 2 MB.")
    try:
        image = Image.open(BytesIO(body))
        image.verify()
        image = Image.open(BytesIO(body))
        format_name = str(image.format or "").upper()
        format_mimes = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
        detected_mime = format_mimes.get(format_name)
        if not detected_mime or detected_mime != mime:
            raise HTTPException(status_code=400, detail="The file content does not match its image type.")
        if image.width > 2048 or image.height > 2048:
            raise HTTPException(status_code=400, detail="Badge dimensions cannot exceed 2048px.")
        animated = bool(getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1)
        image.seek(0)
        preview = image.convert("RGBA")
        preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
        preview_buffer = BytesIO()
        preview.save(preview_buffer, format="PNG", optimize=True)
        preview_body = preview_buffer.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="That badge image is invalid.") from None
    storage = get_r2_storage(settings)
    if not storage.enabled:
        raise HTTPException(status_code=503, detail="R2 object storage is not configured.")
    safe_stem = "".join(char if char.isalnum() or char in "-_" else "-" for char in Path(file.filename or "badge").stem)[:80] or "badge"
    extension = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif"}[format_name]
    token = uuid4().hex
    asset_key = f"badges/{badge_id}/{token}-{safe_stem}{extension}"
    preview_key = f"badges/{badge_id}/{token}-preview.png"
    try:
        await storage.put(asset_key, body, mime)
        await storage.put(preview_key, preview_body, "image/png")
        badge = await achievements.update_badge_asset(admin.id, badge_id, asset_url=storage.public_url(asset_key), preview_url=storage.public_url(preview_key), asset_key=asset_key, preview_key=preview_key, mime=mime, animated=animated)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not store that badge asset in R2.") from None
    if badge is None:
        raise HTTPException(status_code=404, detail="Badge not found.")
    return {"badge": badge}


@router.get("/badge-platform/ranks")
async def achievement_ranks(_admin: AdminUser, search: str = Query(default="", max_length=128)) -> dict:
    return {"ranks": await achievements.list_ranks_admin(search)}


@router.post("/badge-platform/ranks", status_code=201)
async def create_achievement_rank(payload: AchievementDefinitionRequest, admin: AdminUser) -> dict:
    try:
        rank = await achievements.save_rank(admin.id, payload.model_dump())
    except (ValueError, asyncpg.ForeignKeyViolationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid rank definition.") from None
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="That rank slug already exists.") from None
    return {"rank": rank}


@router.put("/badge-platform/ranks/{rank_id}")
async def update_achievement_rank(rank_id: UUID, payload: AchievementDefinitionRequest, admin: AdminUser) -> dict:
    try:
        rank = await achievements.save_rank(admin.id, payload.model_dump(), rank_id)
    except (ValueError, asyncpg.ForeignKeyViolationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid rank definition.") from None
    return {"rank": rank}


@router.delete("/badge-platform/ranks/{rank_id}")
async def remove_achievement_rank(rank_id: UUID, admin: AdminUser) -> dict:
    try:
        action = await achievements.delete_rank(admin.id, rank_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Rank not found.") from None
    return {"ok": True, "action": action}


@router.get("/badge-platform/assignments")
async def achievement_assignments(_admin: AdminUser, search: str = Query(default="", max_length=128), item_type: str = Query(default="", pattern=r"^(|BADGE|RANK)$"), active_only: bool = Query(default=False)) -> dict:
    return {"assignments": await achievements.list_assignments(search, item_type, active_only)}


@router.post("/badge-platform/assignments")
async def update_achievement_assignment(payload: AchievementAssignmentRequest, admin: AdminUser) -> dict:
    user_id = await admin_db.resolve_user_ref(payload.user)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found.")
    try:
        if payload.action == "ASSIGN":
            changed = await achievements.assign(admin.id, UUID(user_id), payload.itemType, payload.itemId, reason=payload.reason)
        else:
            changed = await achievements.revoke(admin.id, UUID(user_id), payload.itemType, payload.itemId, payload.reason)
    except LookupError:
        raise HTTPException(status_code=404, detail=f"{payload.itemType.title()} not found.") from None
    except PermissionError:
        raise HTTPException(status_code=403, detail="Manual assignment is disabled for that definition.") from None
    except (ValueError, asyncpg.ForeignKeyViolationError):
        raise HTTPException(status_code=400, detail="Invalid assignment request.") from None
    return {"ok": True, "changed": changed, "userId": user_id}


@router.get("/badge-platform/{item_type}/{item_id}/owners")
async def achievement_owners(item_type: str, item_id: str, _admin: AdminUser) -> dict:
    kind = item_type.upper()
    if kind not in {"BADGE", "RANK"}:
        raise HTTPException(status_code=400, detail="Invalid item type.")
    try:
        return {"owners": await achievements.owners(kind, item_id)}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid item ID.") from None


@router.get("/badge-platform/purchases")
async def achievement_purchases(_admin: AdminUser, search: str = Query(default="", max_length=128), purchase_status: str = Query(default="", max_length=16)) -> dict:
    if purchase_status and purchase_status not in achievements.PURCHASE_STATES:
        raise HTTPException(status_code=400, detail="Invalid purchase status.")
    return {"purchases": await achievements.list_purchases(search, purchase_status)}


@router.patch("/badge-platform/purchases/{purchase_id}")
async def update_achievement_purchase(purchase_id: UUID, payload: PurchaseTransitionRequest, admin: AdminUser) -> dict:
    try:
        purchase = await achievements.transition_purchase(admin.id, purchase_id, payload.status, payload.providerReference)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Only a verified payment provider callback can complete a purchase.") from None
    except ValueError:
        raise HTTPException(status_code=409, detail="That purchase status transition is not allowed.") from None
    if purchase is None:
        raise HTTPException(status_code=404, detail="Purchase not found.")
    return {"purchase": purchase}
