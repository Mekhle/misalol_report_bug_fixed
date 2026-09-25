"""Integrated Constellations domain service backed by Misa's PostgreSQL database."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import secrets
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

import asyncpg

from app.db import admin_db
from app.models import User

INVITATION_DAYS = 7
MIN_CAPACITY = 2
MAX_CAPACITY = 4
ProfileResolver = Callable[[str], Awaitable[dict[str, Any] | None]]


class DomainError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def normalized_slug(value: str) -> str:
    slug = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,30}[a-z0-9]", slug):
        raise DomainError("Use 2–32 lowercase letters, numbers, or internal hyphens for the URL.", 422)
    return slug


def default_positions(capacity: int) -> list[tuple[float, float]]:
    examples = {
        2: [(27.0, 50.0), (73.0, 50.0)],
        3: [(50.0, 27.0), (25.0, 68.0), (75.0, 68.0)],
        4: [(28.0, 30.0), (72.0, 30.0), (28.0, 72.0), (72.0, 72.0)],
    }
    try:
        return examples[capacity]
    except KeyError as error:
        raise DomainError("Constellations support 2–4 profiles.", 422) from error


def default_scale(capacity: int) -> float:
    scales = {2: 0.86, 3: 0.76, 4: 0.62}
    try:
        return scales[capacity]
    except KeyError as error:
        raise DomainError("Constellations support 2–4 profiles.", 422) from error


def _json(value: Any, fallback: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value if value is not None else fallback


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else str(value) if value is not None else None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ConstellationRepository:
    def __init__(self, profile_resolver: ProfileResolver | None = None):
        self.profile_resolver = profile_resolver

    @property
    def pool(self) -> asyncpg.Pool:
        return admin_db.database_pool()

    async def _group(self, conn: asyncpg.Connection, group_id: str, lock: bool = False) -> asyncpg.Record:
        try:
            row = await conn.fetchrow(
                "SELECT c.*,u.username AS owner_username FROM constellations c "
                "LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=$1" + (" FOR UPDATE OF c" if lock else ""),
                UUID(group_id),
            )
        except ValueError as exc:
            raise DomainError("Constellation not found.", 404) from exc
        if row is None:
            raise DomainError("Constellation not found.", 404)
        return row

    async def _membership(self, conn: asyncpg.Connection, group_id: str, user_id: str) -> asyncpg.Record | None:
        try:
            return await conn.fetchrow(
                "SELECT * FROM constellation_members WHERE constellation_id=$1 AND user_id=$2",
                UUID(group_id), UUID(user_id),
            )
        except ValueError:
            return None

    async def _require_member(self, conn: asyncpg.Connection, group_id: str, user_id: str, lock: bool = False) -> tuple[asyncpg.Record, asyncpg.Record]:
        group = await self._group(conn, group_id, lock)
        member = await self._membership(conn, group_id, user_id)
        if member is None:
            raise DomainError("Constellation not found.", 404)
        return group, member

    async def _require_owner(self, conn: asyncpg.Connection, group_id: str, user_id: str, lock: bool = False) -> asyncpg.Record:
        group = await self._group(conn, group_id, lock)
        if str(group["owner_id"]) != user_id:
            raise DomainError("Only the Constellation owner can do that.", 403)
        return group

    async def _audit(self, conn: asyncpg.Connection, actor_id: str, action: str, group_id: str, metadata: dict[str, Any] | None = None) -> None:
        await admin_db._audit(conn, UUID(actor_id), action, "constellation", group_id, metadata or {})

    async def _member_rows(self, conn: asyncpg.Connection, group_id: str) -> list[asyncpg.Record]:
        return await conn.fetch(
            """
            SELECT m.*,u.username,u.display_name,u.avatar_url,u.created_at AS user_created_at,
                   u.suspended_at,u.suspended_until
            FROM constellation_members m JOIN users u ON u.id=m.user_id
            WHERE m.constellation_id=$1 ORDER BY m.slot,m.joined_at
            """,
            UUID(group_id),
        )

    async def _initial_profile(self, user: User) -> dict[str, Any]:
        username = str(user.username or "")
        profile = await self.profile_resolver(username) if self.profile_resolver and username else None
        if profile is not None:
            return profile
        from app.core.profiles import default_public_profile
        return default_public_profile(user)

    async def _profile(self, conn: asyncpg.Connection, row: asyncpg.Record) -> dict[str, Any]:
        stored = _json(row["profile_config"], None)
        if isinstance(stored, dict):
            return stored
        from app.core.profiles import default_public_profile
        profile = default_public_profile(User(
            id=str(row["user_id"]), username=str(row["username"] or "user"),
            display_name=row["display_name"], avatar_url=row["avatar_url"],
            created_at=_iso(row["user_created_at"]),
        ))
        await conn.execute(
            "UPDATE constellation_members SET profile_config=$3::jsonb,updated_at=NOW() WHERE constellation_id=$1 AND user_id=$2 AND profile_config IS NULL",
            row["constellation_id"], row["user_id"], json.dumps(profile),
        )
        return profile

    async def _members(self, conn: asyncpg.Connection, group_id: str, profiles: bool) -> list[dict[str, Any]]:
        rows = await self._member_rows(conn, group_id)
        configs = await asyncio.gather(*(self._profile(conn, row) for row in rows)) if profiles else [None] * len(rows)
        now = datetime.now(timezone.utc)
        result = []
        for row, profile in zip(rows, configs):
            suspended = bool(row["suspended_at"]) and (row["suspended_until"] is None or row["suspended_until"] > now)
            item = {
                "userId": str(row["user_id"]), "username": row["username"] or "",
                "displayName": row["display_name"] or row["username"] or "Misa user",
                "avatarUrl": row["avatar_url"], "role": row["role"], "slot": int(row["slot"]),
                "position": {"x": float(row["position_x"]), "y": float(row["position_y"])},
                "scale": float(row["scale"]), "frameOverride": row["frame_override"],
                "joinedAt": _iso(row["joined_at"]), "active": not suspended,
            }
            if profile is not None:
                item["profile"] = profile
            result.append(item)
        return result
    async def _invitations(self, conn: asyncpg.Connection, group_id: str) -> list[dict[str, Any]]:
        rows = await conn.fetch(
            """
            SELECT i.*,u.username AS inviter_username FROM constellation_invitations i
            LEFT JOIN users u ON u.id=i.invited_by
            WHERE i.constellation_id=$1 ORDER BY i.created_at DESC
            """,
            UUID(group_id),
        )
        now = datetime.now(timezone.utc)
        return [{
            "id": str(row["id"]), "groupId": str(row["constellation_id"]),
            "userId": str(row["invited_user_id"]) if row["invited_user_id"] else None,
            "username": row["invited_username"], "inviterUsername": row["inviter_username"],
            "status": "revoked" if row["revoked_at"] else "accepted" if row["accepted_at"] else "expired" if row["expires_at"] <= now else "pending",
            "expiresAt": _iso(row["expires_at"]), "createdAt": _iso(row["created_at"]),
        } for row in rows]

    def _serialize(self, group: asyncpg.Record, members: list[dict[str, Any]], invitations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        occupied = {member["slot"] for member in members}
        return {
            "id": str(group["id"]), "ownerId": str(group["owner_id"]),
            "ownerUsername": group["owner_username"], "name": group["name"], "slug": group["slug"],
            "description": group["description"], "capacity": int(group["capacity"]),
            "assignmentMode": group["assignment_mode"], "globalFont": group["global_font"],
            "allowMemberFonts": bool(group["allow_member_fonts"]),
            "allowMemberMove": bool(group["allow_member_move"]),
            "allowMemberResize": bool(group["allow_member_resize"]),
            "frameMode": group["frame_mode"],
            "background": _json(group["background"], {"type": "color", "color": "#08080d"}),
            "sharedAssets": _json(group["shared_assets"], {"cursor": None, "audio": None, "audioCover": None, "effectVideo": None, "effect": "None"}),
            "status": group["status"], "published": group["status"] == "published",
            "publicPath": f"/c/{group['slug']}", "members": members, "invitations": invitations or [],
            "availableSlots": [slot for slot in range(1, int(group["capacity"]) + 1) if slot not in occupied],
            "canPublish": len(members) == int(group["capacity"]) and all(item["active"] for item in members),
            "hasUnpublishedChanges": group["status"] == "draft" and group["published_at"] is not None,
            "createdAt": _iso(group["created_at"]), "updatedAt": _iso(group["updated_at"]),
            "publishedAt": _iso(group["published_at"]),
        }

    async def detail(self, group_id: str, user_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            group, _ = await self._require_member(conn, group_id, user_id)
            invitations = await self._invitations(conn, group_id) if str(group["owner_id"]) == user_id else []
            return self._serialize(group, await self._members(conn, group_id, True), invitations)

    async def create(self, user: User, *, name: str, slug: str, capacity: int, assignment_mode: str = "owner") -> dict[str, Any]:
        title, slug = name.strip(), normalized_slug(slug)
        if not 1 <= len(title) <= 60:
            raise DomainError("Give your Constellation a name of 1–60 characters.", 422)
        if not MIN_CAPACITY <= capacity <= MAX_CAPACITY or assignment_mode not in {"owner", "self"}:
            raise DomainError("Choose valid slots and assignment permissions.", 422)
        group_id, (x, y) = uuid4(), default_positions(capacity)[0]
        profile = await self._initial_profile(user)
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO constellations(id,owner_id,name,slug,capacity,assignment_mode) VALUES($1,$2,$3,$4,$5,$6)",
                        group_id, UUID(user.id), title, slug, capacity, assignment_mode,
                    )
                    await conn.execute(
                        "INSERT INTO constellation_members(constellation_id,user_id,role,slot,position_x,position_y,scale,profile_config) VALUES($1,$2,'owner',1,$3,$4,$5,$6::jsonb)",
                        group_id, UUID(user.id), x, y, default_scale(capacity), json.dumps(profile),
                    )
                    await self._audit(conn, user.id, "constellation.created", str(group_id), {"capacity": capacity})
        except asyncpg.UniqueViolationError as exc:
            raise DomainError("That Constellation URL is already taken.", 409) from exc
        return await self.detail(str(group_id), user.id)

    async def list_for(self, user_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            ids = await conn.fetch(
                "SELECT c.id FROM constellations c JOIN constellation_members m ON m.constellation_id=c.id WHERE m.user_id=$1 ORDER BY c.updated_at DESC",
                UUID(user_id),
            )
            rows = await conn.fetch(
                """
                SELECT i.*,c.name AS group_name,c.capacity,u.username AS inviter_username
                FROM constellation_invitations i JOIN constellations c ON c.id=i.constellation_id
                LEFT JOIN users u ON u.id=i.invited_by
                WHERE i.invited_user_id=$1 AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>NOW()
                ORDER BY i.created_at DESC
                """, UUID(user_id),
            )
        groups = await asyncio.gather(*(self.detail(str(row["id"]), user_id) for row in ids))
        invitations = [{
            "id": str(row["id"]), "groupId": str(row["constellation_id"]), "groupName": row["group_name"],
            "capacity": int(row["capacity"]), "userId": str(row["invited_user_id"]),
            "username": row["invited_username"], "inviterUsername": row["inviter_username"],
            "status": "pending", "expiresAt": _iso(row["expires_at"]),
        } for row in rows]
        return {"groups": list(groups), "invitations": invitations}

    async def update(self, group_id: str, actor_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        allowed = {"name", "slug", "description", "capacity", "assignmentMode", "globalFont", "allowMemberFonts", "allowMemberMove", "allowMemberResize", "frameMode"}
        if not patch or set(patch) - allowed:
            raise DomainError("Unsupported Constellation setting.", 422)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group = await self._require_owner(conn, group_id, actor_id, True)
                values = {
                    "name": group["name"], "slug": group["slug"], "description": group["description"],
                    "capacity": int(group["capacity"]), "assignmentMode": group["assignment_mode"],
                    "globalFont": group["global_font"], "allowMemberFonts": group["allow_member_fonts"],
                    "allowMemberMove": group["allow_member_move"], "allowMemberResize": group["allow_member_resize"],
                    "frameMode": group["frame_mode"],
                }
                values.update(patch)
                values["name"], values["slug"] = str(values["name"]).strip(), normalized_slug(str(values["slug"]))
                values["description"] = str(values["description"] or "").strip()
                values["capacity"], values["globalFont"] = int(values["capacity"]), str(values["globalFont"] or "Inter")[:120]
                highest = int(await conn.fetchval("SELECT COALESCE(MAX(slot),0) FROM constellation_members WHERE constellation_id=$1", UUID(group_id)) or 0)
                if not 1 <= len(values["name"]) <= 60 or len(values["description"]) > 500:
                    raise DomainError("Check the name and description lengths.", 422)
                if not MIN_CAPACITY <= values["capacity"] <= MAX_CAPACITY or values["capacity"] < highest:
                    raise DomainError("The slot count cannot exclude an assigned member.", 409)
                if values["assignmentMode"] not in {"owner", "self"} or values["frameMode"] not in {"member", "framed", "frameless"}:
                    raise DomainError("Invalid Constellation permissions.", 422)
                await conn.execute(
                    """
                    UPDATE constellations SET name=$2,slug=$3,description=$4,capacity=$5,assignment_mode=$6,
                    global_font=$7,allow_member_fonts=$8,allow_member_move=$9,allow_member_resize=$10,
                    frame_mode=$11,status=CASE WHEN status='suspended' THEN status ELSE 'draft' END,updated_at=NOW()
                    WHERE id=$1
                    """,
                    UUID(group_id), values["name"], values["slug"], values["description"], values["capacity"],
                    values["assignmentMode"], values["globalFont"], bool(values["allowMemberFonts"]),
                    bool(values["allowMemberMove"]), bool(values["allowMemberResize"]), values["frameMode"],
                )
                await self._audit(conn, actor_id, "constellation.settings.updated", group_id, {"fields": sorted(patch)})
        return await self.detail(group_id, actor_id)
    async def update_background(self, group_id: str, actor_id: str, background: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
        kind, color = str(background.get("type") or "color"), str(background.get("color") or "#08080d")
        if kind not in {"color", "image", "video"} or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise DomainError("Invalid Constellation background.", 422)
        clean: dict[str, Any] = {"type": kind, "color": color}
        if kind != "color":
            url, key = str(background.get("url") or ""), str(background.get("key") or "")
            if not url.startswith(("https://", "http://")) or not key.startswith(f"constellations/{group_id}/"):
                raise DomainError("Invalid Constellation background asset.", 422)
            clean.update({"url": url, "key": key, "name": str(background.get("name") or "")[:100], "contentType": str(background.get("contentType") or "")[:100]})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group, _ = await self._require_member(conn, group_id, actor_id, True)
                previous = _json(group["background"], {})
                await conn.execute(
                    "UPDATE constellations SET background=$2::jsonb,status=CASE WHEN status='suspended' THEN status ELSE 'draft' END,updated_at=NOW() WHERE id=$1",
                    UUID(group_id), json.dumps(clean),
                )
                await self._audit(conn, actor_id, "constellation.background.updated", group_id, {"type": kind})
        return await self.detail(group_id, actor_id), previous.get("key") if isinstance(previous, dict) else None

    async def update_shared_effect(self, group_id: str, actor_id: str, effect: str) -> dict[str, Any]:
        if effect not in {"None", "Snowflakes", "Snow", "Sakura", "Rain", "Fireflies"}:
            raise DomainError("Unsupported background effect.", 422)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group, _ = await self._require_member(conn, group_id, actor_id, True)
                shared = _json(group["shared_assets"], {"cursor": None, "audio": None, "audioCover": None, "effectVideo": None, "effect": "None"})
                if not isinstance(shared, dict):
                    shared = {"cursor": None, "audio": None, "audioCover": None, "effectVideo": None, "effect": "None"}
                shared = {**shared, "effect": effect}
                await conn.execute(
                    "UPDATE constellations SET shared_assets=$2::jsonb,status=CASE WHEN status='suspended' THEN status ELSE 'draft' END,updated_at=NOW() WHERE id=$1",
                    UUID(group_id), json.dumps(shared),
                )
                await self._audit(conn, actor_id, "constellation.shared_effect.updated", group_id, {"effect": effect})
        return await self.detail(group_id, actor_id)
    async def update_shared_asset(self, group_id: str, actor_id: str, kind: str, asset: dict[str, Any] | None) -> tuple[dict[str, Any], str | None]:
        if kind not in {"cursor", "audio", "audioCover", "effectVideo"}:
            raise DomainError("Unsupported shared asset.", 422)
        clean: dict[str, Any] | None = None
        if asset is not None:
            url, key = str(asset.get("url") or ""), str(asset.get("key") or "")
            if not url.startswith("https://") or not key.startswith(f"constellations/{group_id}/shared/{kind}/"):
                raise DomainError("Invalid shared asset.", 422)
            clean = {
                "url": url,
                "key": key,
                "name": str(asset.get("name") or "")[:100],
                "contentType": str(asset.get("contentType") or "")[:100],
                **({"title": str(asset.get("title") or "")[:120]} if kind == "audio" else {}),
            }
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group, _ = await self._require_member(conn, group_id, actor_id, True)
                shared = _json(group["shared_assets"], {"cursor": None, "audio": None, "audioCover": None, "effectVideo": None, "effect": "None"})
                if not isinstance(shared, dict):
                    shared = {"cursor": None, "audio": None, "audioCover": None, "effectVideo": None, "effect": "None"}
                previous = shared.get(kind)
                shared = {**shared, kind: clean}
                await conn.execute(
                    "UPDATE constellations SET shared_assets=$2::jsonb,status=CASE WHEN status='suspended' THEN status ELSE 'draft' END,updated_at=NOW() WHERE id=$1",
                    UUID(group_id), json.dumps(shared),
                )
                await self._audit(conn, actor_id, "constellation.shared_asset.updated", group_id, {"kind": kind, "removed": clean is None})
        old_key = previous.get("key") if isinstance(previous, dict) else None
        return await self.detail(group_id, actor_id), old_key

    async def invite(self, group_id: str, actor_id: str, target: User | None = None) -> dict[str, Any]:
        token, invitation_id = secrets.token_urlsafe(32), uuid4()
        expires = datetime.now(timezone.utc) + timedelta(days=INVITATION_DAYS)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group = await self._require_owner(conn, group_id, actor_id, True)
                count = int(await conn.fetchval("SELECT COUNT(*) FROM constellation_members WHERE constellation_id=$1", UUID(group_id)) or 0)
                if count >= int(group["capacity"]):
                    raise DomainError("This Constellation is full.", 409)
                if target:
                    if await self._membership(conn, group_id, target.id):
                        raise DomainError("That person is already a member.", 409)
                    duplicate = await conn.fetchval(
                        "SELECT 1 FROM constellation_invitations WHERE constellation_id=$1 AND invited_user_id=$2 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>NOW()",
                        UUID(group_id), UUID(target.id),
                    )
                    if duplicate:
                        raise DomainError("That person already has a pending invitation.", 409)
                await conn.execute(
                    """
                    INSERT INTO constellation_invitations
                    (id,constellation_id,token_hash,invited_user_id,invited_username,invited_by,expires_at)
                    VALUES($1,$2,$3,$4,$5,$6,$7)
                    """,
                    invitation_id, UUID(group_id), _token_hash(token), UUID(target.id) if target else None,
                    target.username if target else None, UUID(actor_id), expires,
                )
                await self._audit(conn, actor_id, "constellation.invite.created", group_id, {"target": target.username if target else None})
        return {"invitation": {
            "id": str(invitation_id), "groupId": group_id, "username": target.username if target else None,
            "status": "pending", "expiresAt": _iso(expires), "token": token,
            "joinPath": f"/dashboard/constellations?invite={token}",
        }}

    async def _accept(self, conn: asyncpg.Connection, invitation: asyncpg.Record, user: User, profile: dict[str, Any]) -> str:
        group_id = str(invitation["constellation_id"])
        group = await self._group(conn, group_id, True)
        if invitation["revoked_at"] or invitation["expires_at"] <= datetime.now(timezone.utc):
            raise DomainError("This invitation is no longer valid.", 410)
        if invitation["invited_user_id"] and str(invitation["invited_user_id"]) != user.id:
            raise DomainError("This invitation belongs to another account.", 403)
        if invitation["accepted_at"] and str(invitation["accepted_by"]) != user.id:
            raise DomainError("This invitation has already been used.", 410)
        if await self._membership(conn, group_id, user.id):
            if invitation["accepted_at"] is None:
                await conn.execute("UPDATE constellation_invitations SET accepted_at=NOW(),accepted_by=$2 WHERE id=$1", invitation["id"], UUID(user.id))
            return group_id
        occupied = {int(row["slot"]) for row in await conn.fetch(
            "SELECT slot FROM constellation_members WHERE constellation_id=$1 FOR UPDATE", UUID(group_id)
        )}
        slot = next((value for value in range(1, int(group["capacity"]) + 1) if value not in occupied), None)
        if slot is None:
            raise DomainError("This Constellation is full.", 409)
        x, y = default_positions(int(group["capacity"]))[slot - 1]
        await conn.execute(
            "INSERT INTO constellation_members(constellation_id,user_id,role,slot,position_x,position_y,scale,profile_config) VALUES($1,$2,'member',$3,$4,$5,$6,$7::jsonb)",
            UUID(group_id), UUID(user.id), slot, x, y, default_scale(int(group["capacity"])), json.dumps(profile),
        )
        await conn.execute("UPDATE constellation_invitations SET accepted_at=NOW(),accepted_by=$2 WHERE id=$1", invitation["id"], UUID(user.id))
        await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
        await self._audit(conn, user.id, "constellation.member.joined", group_id, {"slot": slot})
        return group_id

    async def join(self, token: str, user: User) -> dict[str, Any]:
        if not 20 <= len(token) <= 128:
            raise DomainError("Invalid invitation.", 404)
        profile = await self._initial_profile(user)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                invitation = await conn.fetchrow("SELECT * FROM constellation_invitations WHERE token_hash=$1 FOR UPDATE", _token_hash(token))
                if invitation is None:
                    raise DomainError("Invalid invitation.", 404)
                group_id = await self._accept(conn, invitation, user, profile)
        return await self.detail(group_id, user.id)

    async def respond(self, group_id: str, invitation_id: str, user: User, accept: bool) -> dict[str, Any]:
        profile = await self._initial_profile(user) if accept else {}
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                try:
                    invitation = await conn.fetchrow(
                        "SELECT * FROM constellation_invitations WHERE id=$1 AND constellation_id=$2 FOR UPDATE",
                        UUID(invitation_id), UUID(group_id),
                    )
                except ValueError as exc:
                    raise DomainError("Invitation not found.", 404) from exc
                if invitation is None or str(invitation["invited_user_id"] or "") != user.id:
                    raise DomainError("Invitation not found.", 404)
                if accept:
                    await self._accept(conn, invitation, user, profile)
                else:
                    if invitation["accepted_at"] or invitation["revoked_at"] or invitation["expires_at"] <= datetime.now(timezone.utc):
                        raise DomainError("This invitation is no longer pending.", 409)
                    await conn.execute("UPDATE constellation_invitations SET revoked_at=NOW() WHERE id=$1", invitation["id"])
                    await self._audit(conn, user.id, "constellation.invite.declined", group_id)
        return {"accepted": accept, **({"group": await self.detail(group_id, user.id)} if accept else {})}

    async def revoke_invite(self, group_id: str, invitation_id: str, actor_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._require_owner(conn, group_id, actor_id)
                try:
                    result = await conn.execute(
                        "UPDATE constellation_invitations SET revoked_at=NOW() WHERE id=$1 AND constellation_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL",
                        UUID(invitation_id), UUID(group_id),
                    )
                except ValueError as exc:
                    raise DomainError("Invitation not found.", 404) from exc
                if result.endswith(" 0"):
                    raise DomainError("Invitation not found.", 404)
                await self._audit(conn, actor_id, "constellation.invite.revoked", group_id, {"invitationId": invitation_id})
        return await self.detail(group_id, actor_id)

    async def update_member(self, group_id: str, actor_id: str, target_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        if not patch or set(patch) - {"slot", "position", "scale", "frameOverride"}:
            raise DomainError("Unsupported profile placement setting.", 422)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group, _ = await self._require_member(conn, group_id, actor_id)
                target = await self._membership(conn, group_id, target_id)
                if target is None:
                    raise DomainError("Member not found.", 404)
                owner, own = str(group["owner_id"]) == actor_id, actor_id == target_id
                if not owner and not own:
                    raise DomainError("You cannot modify another member's profile.", 403)
                slot, x, y = int(target["slot"]), float(target["position_x"]), float(target["position_y"])
                scale, frame = float(target["scale"]), target["frame_override"]
                if "slot" in patch:
                    if not owner and group["assignment_mode"] != "self":
                        raise DomainError("The owner assigns profile slots.", 403)
                    slot = int(patch["slot"])
                    if not 1 <= slot <= int(group["capacity"]):
                        raise DomainError("Choose an available profile slot.", 422)
                if "position" in patch:
                    if not owner and not group["allow_member_move"]:
                        raise DomainError("Members cannot move profiles in this Constellation.", 403)
                    x, y = float(patch["position"]["x"]), float(patch["position"]["y"])
                    if not 0 <= x <= 100 or not 0 <= y <= 100:
                        raise DomainError("Profile position must stay inside the canvas.", 422)
                if "scale" in patch:
                    if not owner and not group["allow_member_resize"]:
                        raise DomainError("Members cannot resize profiles in this Constellation.", 403)
                    scale = float(patch["scale"])
                    if not .4 <= scale <= 1.8:
                        raise DomainError("Profile scale must be between 40% and 180%.", 422)
                if "frameOverride" in patch:
                    if not owner and group["frame_mode"] != "member":
                        raise DomainError("The owner controls frames in this Constellation.", 403)
                    frame = str(patch["frameOverride"])
                    if frame not in {"inherit", "framed", "frameless"}:
                        raise DomainError("Choose framed, frameless, or inherit.", 422)
                try:
                    await conn.execute(
                        """
                        UPDATE constellation_members SET slot=$3,position_x=$4,position_y=$5,scale=$6,
                        frame_override=$7,updated_at=NOW() WHERE constellation_id=$1 AND user_id=$2
                        """, UUID(group_id), UUID(target_id), slot, x, y, scale, frame,
                    )
                except asyncpg.UniqueViolationError as exc:
                    raise DomainError("That profile slot is already occupied.", 409) from exc
                await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.member.placement", group_id, {"userId": target_id, "slot": slot})
        return await self.detail(group_id, actor_id)

    async def update_member_profile(self, group_id: str, actor_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._require_member(conn, group_id, actor_id, True)
                await conn.execute(
                    "UPDATE constellation_members SET profile_config=$3::jsonb,updated_at=NOW() WHERE constellation_id=$1 AND user_id=$2",
                    UUID(group_id), UUID(actor_id), json.dumps(profile),
                )
                await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.member.design", group_id)
        return await self.detail(group_id, actor_id)
    async def remove_member(self, group_id: str, actor_id: str, target_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group, _ = await self._require_member(conn, group_id, actor_id)
                if actor_id != target_id and str(group["owner_id"]) != actor_id:
                    raise DomainError("Only the owner can remove another member.", 403)
                if str(group["owner_id"]) == target_id:
                    raise DomainError("Transfer ownership before the owner leaves.", 409)
                result = await conn.execute(
                    "DELETE FROM constellation_members WHERE constellation_id=$1 AND user_id=$2",
                    UUID(group_id), UUID(target_id),
                )
                if result.endswith(" 0"):
                    raise DomainError("Member not found.", 404)
                await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.member.removed", group_id, {"userId": target_id})
        return {"left": actor_id == target_id, **({"group": await self.detail(group_id, actor_id)} if actor_id != target_id else {})}

    async def transfer(self, group_id: str, actor_id: str, target_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._require_owner(conn, group_id, actor_id, True)
                if not await self._membership(conn, group_id, target_id):
                    raise DomainError("Choose a current member.", 404)
                await conn.execute("UPDATE constellation_members SET role='member' WHERE constellation_id=$1", UUID(group_id))
                await conn.execute("UPDATE constellation_members SET role='owner' WHERE constellation_id=$1 AND user_id=$2", UUID(group_id), UUID(target_id))
                await conn.execute("UPDATE constellations SET owner_id=$2,status='draft',updated_at=NOW() WHERE id=$1", UUID(group_id), UUID(target_id))
                await self._audit(conn, actor_id, "constellation.owner.transferred", group_id, {"ownerId": target_id})
        return await self.detail(group_id, actor_id)

    async def publish(self, group_id: str, actor_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group = await self._require_owner(conn, group_id, actor_id, True)
                if group["status"] == "suspended":
                    raise DomainError("This Constellation is suspended.", 403)
                members = await self._member_rows(conn, group_id)
                if len(members) != int(group["capacity"]):
                    raise DomainError("Fill every profile slot before publishing.", 409)
                now = datetime.now(timezone.utc)
                if any(row["suspended_at"] and (row["suspended_until"] is None or row["suspended_until"] > now) for row in members):
                    raise DomainError("Every member must have an active account.", 409)
                await conn.execute("UPDATE constellations SET status='published',published_at=NOW(),updated_at=NOW() WHERE id=$1", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.published", group_id)
        return await self.detail(group_id, actor_id)

    async def unpublish(self, group_id: str, actor_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._require_owner(conn, group_id, actor_id)
                await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.unpublished", group_id)
        return await self.detail(group_id, actor_id)

    async def delete(self, group_id: str, actor_id: str, admin: bool = False) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group = await self._group(conn, group_id, True) if admin else await self._require_owner(conn, group_id, actor_id, True)
                background = _json(group["background"], {})
                shared_assets = _json(group["shared_assets"], {})
                await self._audit(conn, actor_id, "constellation.admin.deleted" if admin else "constellation.deleted", group_id)
                await conn.execute("DELETE FROM constellations WHERE id=$1", UUID(group_id))
        shared_keys = [asset.get("key") for asset in shared_assets.values() if isinstance(asset, dict) and asset.get("key")] if isinstance(shared_assets, dict) else []
        return {"deleted": True, "backgroundKey": background.get("key") if isinstance(background, dict) else None, "sharedKeys": shared_keys}

    async def public(self, slug: str) -> dict[str, Any]:
        slug = normalized_slug(slug)
        async with self.pool.acquire() as conn:
            group = await conn.fetchrow(
                "SELECT c.*,u.username AS owner_username FROM constellations c LEFT JOIN users u ON u.id=c.owner_id WHERE c.slug=$1 AND c.status='published'",
                slug,
            )
            if group is None:
                raise DomainError("Constellation not found.", 404)
            members = await self._members(conn, str(group["id"]), True)
            if len(members) != int(group["capacity"]) or any(not item["active"] for item in members):
                raise DomainError("Constellation not found.", 404)
            result = self._serialize(group, members)
            for key in ("ownerId", "invitations", "availableSlots"):
                result.pop(key, None)
            from app.core.premium import has_premium, public_projection
            for member in result["members"]:
                member["profile"] = public_projection(member.get("profile") or {}, await has_premium(member["userId"]))
                member.pop("userId", None)
                member.pop("active", None)
            return result

    async def admin_list(self, search: str = "", status: str = "", limit: int = 100) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """
            SELECT c.id,c.name,c.slug,c.status,c.capacity,c.created_at,c.updated_at,c.owner_id,
                   u.username AS owner_username,COUNT(m.user_id)::int AS member_count
            FROM constellations c LEFT JOIN users u ON u.id=c.owner_id
            LEFT JOIN constellation_members m ON m.constellation_id=c.id
            WHERE ($1='' OR c.name ILIKE '%'||$1||'%' OR c.slug ILIKE '%'||$1||'%'
                   OR u.username ILIKE '%'||$1||'%' OR c.id::text=$1 OR c.owner_id::text=$1)
              AND ($2='' OR c.status=$2)
            GROUP BY c.id,u.username ORDER BY c.updated_at DESC LIMIT $3
            """, search.strip(), status.strip(), max(1, min(limit, 200)),
        )
        return [{
            "id": str(row["id"]), "name": row["name"], "slug": row["slug"], "status": row["status"],
            "capacity": int(row["capacity"]), "memberCount": int(row["member_count"]),
            "ownerId": str(row["owner_id"]), "ownerUsername": row["owner_username"],
            "createdAt": _iso(row["created_at"]), "updatedAt": _iso(row["updated_at"]),
        } for row in rows]

    async def admin_detail(self, group_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            group = await self._group(conn, group_id)
            return self._serialize(group, await self._members(conn, group_id, False), await self._invitations(conn, group_id))

    async def admin_status(self, group_id: str, actor_id: str, suspended: bool) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._group(conn, group_id, True)
                await conn.execute("UPDATE constellations SET status=$2,updated_at=NOW() WHERE id=$1", UUID(group_id), "suspended" if suspended else "draft")
                await self._audit(conn, actor_id, "constellation.admin.suspended" if suspended else "constellation.admin.restored", group_id)
        return await self.admin_detail(group_id)

    async def admin_remove_member(self, group_id: str, actor_id: str, target_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                group = await self._group(conn, group_id, True)
                if str(group["owner_id"]) == target_id:
                    raise DomainError("Transfer or delete the Constellation instead of removing its owner.", 409)
                result = await conn.execute(
                    "DELETE FROM constellation_members WHERE constellation_id=$1 AND user_id=$2", UUID(group_id), UUID(target_id)
                )
                if result.endswith(" 0"):
                    raise DomainError("Member not found.", 404)
                await conn.execute("UPDATE constellations SET status='draft',updated_at=NOW() WHERE id=$1 AND status<>'suspended'", UUID(group_id))
                await self._audit(conn, actor_id, "constellation.admin.member_removed", group_id, {"userId": target_id})
        return await self.admin_detail(group_id)
    async def admin_revoke_invite(self, group_id: str, actor_id: str, invitation_id: str) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._group(conn, group_id, True)
                try:
                    result = await conn.execute(
                        "UPDATE constellation_invitations SET revoked_at=NOW() WHERE id=$1 AND constellation_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL",
                        UUID(invitation_id), UUID(group_id),
                    )
                except ValueError as exc:
                    raise DomainError("Invitation not found.", 404) from exc
                if result.endswith(" 0"):
                    raise DomainError("Invitation not found.", 404)
                await self._audit(conn, actor_id, "constellation.admin.invite_revoked", group_id, {"invitationId": invitation_id})
        return await self.admin_detail(group_id)
