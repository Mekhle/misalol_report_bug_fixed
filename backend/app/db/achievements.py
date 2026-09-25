"""Dynamic, server-authoritative Badge + Rank platform."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID, uuid4

import asyncpg

from app.db import admin_db

FEATURED_LIMIT = 5
REQUIREMENT_TYPES = {"profile_views", "account_age", "link_clicks", "profile_completion", "music_activity", "manual", "purchase", "rank", "custom"}
SOURCES = {"AUTOMATIC", "MANUAL", "PURCHASE"}
PURCHASE_STATES = {"PENDING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED"}
_definition_cache: tuple[float, list[dict[str, Any]], list[dict[str, Any]]] | None = None


def _pool() -> asyncpg.Pool:
    return admin_db.database_pool()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _slug(value: str) -> str:
    result = "".join(char if char.isalnum() else "-" for char in value.strip().lower())
    while "--" in result:
        result = result.replace("--", "-")
    return result.strip("-")[:64]


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def invalidate_definition_cache() -> None:
    global _definition_cache
    _definition_cache = None


async def ensure_schema() -> None:
    migration = Path(__file__).with_name("migrations") / "20260918_badge_rank_platform.sql"
    sql = migration.read_text(encoding="utf-8")
    async with _pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(sql)


async def _definitions() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    global _definition_cache
    if _definition_cache and time.monotonic() - _definition_cache[0] < 60:
        return _definition_cache[1], _definition_cache[2]
    badges = [dict(row) for row in await _pool().fetch("""SELECT id,slug,name,description,color,requirements,automatic_award,limited,max_awards,available_from,expires_at,active FROM badges WHERE active=TRUE AND automatic_award=TRUE ORDER BY display_order,name""")]
    ranks = [dict(row) for row in await _pool().fetch("""SELECT id,slug,name,description,color,requirements,automatic_award,limited,max_awards,available_from,expires_at,active FROM ranks WHERE active=TRUE AND automatic_award=TRUE ORDER BY level,display_order,name""")]
    _definition_cache = (time.monotonic(), badges, ranks)
    return badges, ranks


def _active_now(item: dict[str, Any]) -> bool:
    now = _now()
    return bool(item.get("active", True)) and (not item.get("available_from") or item["available_from"] <= now) and (not item.get("expires_at") or item["expires_at"] > now)


def _config(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = []
    return [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def validate_requirements(value: Any) -> list[dict[str, Any]]:
    requirements = _config(value)
    clean: list[dict[str, Any]] = []
    for item in requirements[:12]:
        kind = str(item.get("type") or "").strip().lower()
        if kind not in REQUIREMENT_TYPES:
            raise ValueError(f"Unsupported requirement type: {kind or 'empty'}")
        operator = str(item.get("operator") or "gte").lower()
        if operator not in {"gte", "lte", "eq"}:
            raise ValueError("Unsupported requirement operator.")
        row: dict[str, Any] = {"type": kind, "operator": operator}
        if kind == "rank":
            row["rank"] = str(item.get("rank") or item.get("rankId") or "")[:64]
            if not row["rank"]:
                raise ValueError("Rank requirements need a rank ID or slug.")
        elif kind in {"manual", "purchase"}:
            pass
        elif kind == "custom":
            row["key"] = str(item.get("key") or "")[:80]
            row["value"] = item.get("value")
        else:
            try:
                row["value"] = max(0, int(item.get("value") or 0))
            except (TypeError, ValueError) as exc:
                raise ValueError("Requirement values must be whole numbers.") from exc
        clean.append(row)
    return clean


def requirement_met(requirement: dict[str, Any], metrics: dict[str, Any]) -> bool:
    kind = str(requirement.get("type") or "")
    if kind in {"manual", "purchase", "custom"}:
        return False
    if kind == "rank":
        return str(requirement.get("rank") or "") in metrics.get("ranks", set())
    key = {"profile_views": "profile_views", "account_age": "account_age_days", "link_clicks": "link_clicks", "profile_completion": "profile_completion", "music_activity": "music_activity"}.get(kind)
    if not key:
        return False
    current, target = int(metrics.get(key) or 0), int(requirement.get("value") or 0)
    operator = requirement.get("operator") or "gte"
    return current >= target if operator == "gte" else current <= target if operator == "lte" else current == target


def requirements_met(requirements: Any, metrics: dict[str, Any]) -> bool:
    items = _config(requirements)
    return bool(items) and all(requirement_met(item, metrics) for item in items)


def _profile_completion(config: Any) -> int:
    if not isinstance(config, dict):
        return 0
    root = config.get("config") if isinstance(config.get("config"), dict) else config
    profile = root.get("profile") if isinstance(root.get("profile"), dict) else {}
    assets = root.get("assets") if isinstance(root.get("assets"), dict) else {}
    socials = root.get("socials") if isinstance(root.get("socials"), list) else []
    checks = [bool(profile.get("displayName")), bool(profile.get("description")), bool((assets.get("avatar") or {}).get("url") if isinstance(assets.get("avatar"), dict) else False), bool((assets.get("background") or {}).get("url") if isinstance(assets.get("background"), dict) else False), any(isinstance(item, dict) and item.get("enabled") and item.get("value") for item in socials)]
    return round(sum(checks) / len(checks) * 100)


async def user_metrics(user_id: UUID, conn: asyncpg.Connection | None = None) -> dict[str, Any]:
    owner = False
    if conn is None:
        conn = await _pool().acquire()
        owner = True
    try:
        row = await conn.fetchrow("""SELECT u.created_at,COALESCE(s.views,0) AS views,COALESCE(s.clicks,0) AS clicks,p.config,COALESCE((SELECT count(*) FROM profile_events e WHERE e.user_id=u.id AND e.kind IN ('audio','music','track_play')),0) AS music FROM users u LEFT JOIN profile_stats s ON s.user_id=u.id LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1""", user_id)
        if row is None:
            raise LookupError("user")
        ranks = await conn.fetch("""SELECT r.id,r.slug FROM rank_awards a JOIN ranks r ON r.id=a.rank_id WHERE a.user_id=$1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>NOW())""", user_id)
        age = max(0, (_now() - row["created_at"]).days) if row["created_at"] else 0
        rank_keys = {str(item["id"]) for item in ranks} | {str(item["slug"]) for item in ranks}
        return {"profile_views": int(row["views"]), "link_clicks": int(row["clicks"]), "account_age_days": age, "profile_completion": _profile_completion(row["config"]), "music_activity": int(row["music"]), "ranks": rank_keys}
    finally:
        if owner:
            await _pool().release(conn)


async def should_evaluate_metric(metric: str, value: int) -> bool:
    badges, ranks = await _definitions()
    requirement_type = {"views": "profile_views", "clicks": "link_clicks"}.get(metric, metric)
    return any(int(req.get("value") or -1) == value for definition in badges + ranks for req in _config(definition.get("requirements")) if req.get("type") == requirement_type and (req.get("operator") or "gte") == "gte")


async def _award_badge(conn: asyncpg.Connection, user_id: UUID, badge_id: str, source: str, *, actor_id: UUID | None = None, reason: str = "", purchase_id: UUID | None = None, featured: bool = False) -> bool:
    result = await conn.execute("""INSERT INTO badge_awards (id,badge_id,user_id,source,assigned_by,reason,purchase_id,featured,display_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE((SELECT max(display_order)+1 FROM badge_awards WHERE user_id=$3),0)) ON CONFLICT (user_id,badge_id) WHERE revoked_at IS NULL DO NOTHING""", uuid4(), badge_id, user_id, source, actor_id, reason[:500], purchase_id, featured)
    inserted = result == "INSERT 0 1"
    if inserted:
        await conn.execute("""INSERT INTO user_badges (user_id,badge_id,enabled,granted_by,granted_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (user_id,badge_id) DO UPDATE SET enabled=EXCLUDED.enabled,granted_by=EXCLUDED.granted_by,granted_at=NOW()""", user_id, badge_id, featured, actor_id)
    return inserted


async def _award_rank(conn: asyncpg.Connection, user_id: UUID, rank_id: UUID, source: str, *, actor_id: UUID | None = None, reason: str = "", purchase_id: UUID | None = None) -> bool:
    result = await conn.execute("""INSERT INTO rank_awards (id,rank_id,user_id,source,assigned_by,reason,purchase_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id,rank_id) WHERE revoked_at IS NULL DO NOTHING""", uuid4(), rank_id, user_id, source, actor_id, reason[:500], purchase_id)
    if result != "INSERT 0 1":
        return False
    linked = await conn.fetch("SELECT badge_id FROM rank_badges WHERE rank_id=$1 AND included=TRUE", rank_id)
    for item in linked:
        await _award_badge(conn, user_id, item["badge_id"], source, actor_id=actor_id, reason=f"Included with rank {rank_id}", purchase_id=purchase_id)
    return True


async def evaluate_user(user_id: str | UUID) -> dict[str, int]:
    owner = UUID(str(user_id))
    badges, ranks = await _definitions()
    awarded = {"badges": 0, "ranks": 0}
    async with _pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"achievements:{owner}")
            metrics = await user_metrics(owner, conn)
            for rank in ranks:
                if not _active_now(rank) or not requirements_met(rank.get("requirements"), metrics):
                    continue
                locked = await conn.fetchrow("SELECT id,limited,max_awards FROM ranks WHERE id=$1 FOR UPDATE", rank["id"])
                if not locked:
                    continue
                if locked["limited"] and int(await conn.fetchval("SELECT count(*) FROM rank_awards WHERE rank_id=$1 AND revoked_at IS NULL", rank["id"]) or 0) >= int(locked["max_awards"] or 0):
                    continue
                if await _award_rank(conn, owner, rank["id"], "AUTOMATIC", reason="Requirements completed"):
                    awarded["ranks"] += 1
                    metrics["ranks"].update({str(rank["id"]), str(rank["slug"])})
            for badge in badges:
                if not _active_now(badge) or not requirements_met(badge.get("requirements"), metrics):
                    continue
                locked = await conn.fetchrow("SELECT id,limited,max_awards FROM badges WHERE id=$1 FOR UPDATE", badge["id"])
                if not locked:
                    continue
                if locked["limited"] and int(await conn.fetchval("SELECT count(*) FROM badge_awards WHERE badge_id=$1 AND revoked_at IS NULL", badge["id"]) or 0) >= int(locked["max_awards"] or 0):
                    continue
                if await _award_badge(conn, owner, badge["id"], "AUTOMATIC", reason="Requirements completed"):
                    awarded["badges"] += 1
    return awarded



def _progress(requirements: Any, metrics: dict[str, Any]) -> dict[str, Any] | None:
    for req in _config(requirements):
        kind = str(req.get("type") or "")
        key = {"profile_views":"profile_views","account_age":"account_age_days","link_clicks":"link_clicks","profile_completion":"profile_completion","music_activity":"music_activity"}.get(kind)
        if key:
            current, target = int(metrics.get(key) or 0), int(req.get("value") or 0)
            labels = {"profile_views":"views","account_age":"days","link_clicks":"clicks","profile_completion":"% complete","music_activity":"plays"}
            return {"current": current, "target": target, "label": labels[kind], "percent": 100 if target <= 0 else min(100, round(current / target * 100))}
        if kind == "rank":
            met = requirement_met(req, metrics)
            return {"current": int(met), "target": 1, "label": "rank", "percent": 100 if met else 0}
    return None


async def collection_for_user(user_id: str | UUID) -> dict[str, Any]:
    owner = UUID(str(user_id))
    await evaluate_user(owner)
    metrics = await user_metrics(owner)
    categories = [dict(row) for row in await _pool().fetch("SELECT id,slug,name,description,display_order FROM badge_categories WHERE active=TRUE ORDER BY display_order,name")]
    badges = [dict(row) for row in await _pool().fetch("""SELECT b.id,b.slug,b.name,b.description,b.color,b.rarity,b.display_order,b.icon,b.asset_url,b.preview_url,b.animated,b.requirements,b.purchasable,b.price_minor,b.currency,b.visibility,c.slug AS category_slug,c.name AS category_name,a.id AS award_id,a.source,a.earned_at,a.featured,a.display_order AS featured_order FROM badges b LEFT JOIN badge_categories c ON c.id=b.category_id LEFT JOIN badge_awards a ON a.badge_id=b.id AND a.user_id=$1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>NOW()) WHERE b.active=TRUE AND (b.visibility='PUBLIC' OR a.id IS NOT NULL) ORDER BY b.display_order,b.name""", owner)]
    ranks = [dict(row) for row in await _pool().fetch("""SELECT r.id,r.slug,r.name,r.description,r.level,r.display_order,r.color,r.requirements,r.purchasable,r.price_minor,r.currency,r.visibility,a.id AS award_id,a.source,a.earned_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'previewUrl',b.preview_url,'assetUrl',b.asset_url)) FROM rank_badges rb JOIN badges b ON b.id=rb.badge_id WHERE rb.rank_id=r.id AND rb.included=TRUE),'[]'::jsonb) AS badges FROM ranks r LEFT JOIN rank_awards a ON a.rank_id=r.id AND a.user_id=$1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>NOW()) WHERE r.active=TRUE AND (r.visibility='PUBLIC' OR a.id IS NOT NULL) ORDER BY r.level,r.display_order,r.name""", owner)]
    badge_items: list[dict[str, Any]] = []
    for row in badges:
        item = dict(row)
        item["owned"] = bool(item.pop("award_id"))
        item["progress"] = None if item["owned"] else _progress(item.get("requirements"), metrics)
        badge_items.append(item)
    rank_items: list[dict[str, Any]] = []
    for row in ranks:
        item = dict(row)
        item["owned"] = bool(item.pop("award_id"))
        item["progress"] = None if item["owned"] else _progress(item.get("requirements"), metrics)
        rank_items.append(item)
    current_rank = next((item for item in reversed(rank_items) if item["owned"]), None)
    return {"categories": categories, "badges": badge_items, "ranks": rank_items, "currentRank": current_rank, "metrics": {key: value for key, value in metrics.items() if key != "ranks"}, "featuredLimit": FEATURED_LIMIT}


async def set_featured(user_id: str | UUID, badge_ids: Iterable[str]) -> list[str]:
    owner = UUID(str(user_id))
    ordered = list(dict.fromkeys(str(item) for item in badge_ids))
    if len(ordered) > FEATURED_LIMIT:
        raise ValueError("featured_limit")
    async with _pool().acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch("SELECT badge_id FROM badge_awards WHERE user_id=$1 AND revoked_at IS NULL AND badge_id=ANY($2::text[])", owner, ordered)
            if {str(item["badge_id"]) for item in rows} != set(ordered):
                raise ValueError("not_owned")
            await conn.execute("UPDATE badge_awards SET featured=FALSE WHERE user_id=$1 AND revoked_at IS NULL", owner)
            for index, badge_id in enumerate(ordered):
                await conn.execute("UPDATE badge_awards SET featured=TRUE,display_order=$3 WHERE user_id=$1 AND badge_id=$2 AND revoked_at IS NULL", owner, badge_id, index)
                await conn.execute("UPDATE user_badges SET enabled=TRUE WHERE user_id=$1 AND badge_id=$2", owner, badge_id)
            if ordered:
                await conn.execute("UPDATE user_badges SET enabled=FALSE WHERE user_id=$1 AND badge_id<>ALL($2::text[])", owner, ordered)
            else:
                await conn.execute("UPDATE user_badges SET enabled=FALSE WHERE user_id=$1", owner)
    return ordered


async def list_user_badge_grants(user_id: str | UUID) -> list[dict[str, Any]]:
    rows = await _pool().fetch("""SELECT b.id,b.name,b.description,b.color,b.preview_url,b.asset_url,b.animated,b.rarity,a.featured AS enabled,a.source,a.earned_at,a.display_order FROM badge_awards a JOIN badges b ON b.id=a.badge_id WHERE a.user_id=$1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>NOW()) AND b.active=TRUE ORDER BY a.featured DESC,a.display_order,b.display_order,b.name""", UUID(str(user_id)))
    return [dict(row) for row in rows]


async def set_badge_visible(user_id: str | UUID, badge_id: str, enabled: bool) -> bool:
    owner = UUID(str(user_id))
    result = await _pool().execute(
        "UPDATE user_badges SET enabled=$3 WHERE user_id=$1 AND badge_id=$2",
        owner,
        badge_id,
        enabled,
    )
    return bool(result and result.endswith(" 1"))


async def list_categories() -> list[dict[str, Any]]:
    return [dict(row) for row in await _pool().fetch("SELECT c.*, (SELECT count(*) FROM badges b WHERE b.category_id=c.id) AS badge_count FROM badge_categories c ORDER BY display_order,name")]


async def save_category(actor_id: UUID, payload: dict[str, Any], category_id: UUID | None = None) -> dict[str, Any]:
    category_id = category_id or uuid4()
    slug = _slug(str(payload.get("slug") or payload.get("name") or ""))
    async with _pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""INSERT INTO badge_categories (id,slug,name,description,display_order,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,description=EXCLUDED.description,display_order=EXCLUDED.display_order,active=EXCLUDED.active,updated_at=NOW() RETURNING *""", category_id, slug, str(payload.get("name") or "").strip(), str(payload.get("description") or "").strip(), int(payload.get("displayOrder") or 0), bool(payload.get("active", True)), actor_id)
            await admin_db._audit(conn, actor_id, "badge_category.save", "badge_category", str(category_id), {"slug": slug})
    invalidate_definition_cache()
    return dict(row)


async def delete_category(actor_id: UUID, category_id: UUID) -> bool:
    async with _pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("UPDATE badges SET category_id=NULL WHERE category_id=$1", category_id)
            result = await conn.execute("DELETE FROM badge_categories WHERE id=$1", category_id)
            if result == "DELETE 1":
                await admin_db._audit(conn, actor_id, "badge_category.delete", "badge_category", str(category_id))
    invalidate_definition_cache()
    return result == "DELETE 1"


def _definition_values(payload: dict[str, Any]) -> tuple[Any, ...]:
    requirements = validate_requirements(payload.get("requirements") or [])
    automatic = bool(payload.get("automaticAward"))
    limited = bool(payload.get("limited"))
    purchasable = bool(payload.get("purchasable"))
    max_awards = payload.get("maxAwards")
    price_minor = payload.get("priceMinor")
    if automatic and not requirements:
        raise ValueError("Automatic awards need at least one requirement.")
    if automatic and any(item["type"] in {"manual", "purchase", "custom"} for item in requirements):
        raise ValueError("Manual, purchase, and custom requirements cannot be automatic.")
    if limited and max_awards is None:
        raise ValueError("Limited definitions need a maximum award count.")
    if purchasable and price_minor is None:
        raise ValueError("Purchasable definitions need a price.")
    return (
        str(payload.get("name") or "").strip(),
        str(payload.get("description") or "").strip(),
        str(payload.get("color") or "#9b87f5"),
        _json(requirements),
        automatic,
        bool(payload.get("manualAssignmentAllowed", True)),
        str(payload.get("visibility") or "PUBLIC").upper(),
        limited,
        max_awards,
        payload.get("availableFrom"),
        payload.get("expiresAt"),
        purchasable,
        price_minor,
        str(payload.get("currency") or "USD").upper()[:3],
        bool(payload.get("active", True)),
        int(payload.get("displayOrder") or 0),
    )

async def list_badges_admin(search: str = "") -> list[dict[str, Any]]:
    rows = await _pool().fetch("""SELECT b.*,c.name AS category_name,COALESCE((SELECT count(*) FROM badge_awards a WHERE a.badge_id=b.id AND a.revoked_at IS NULL),0) AS owners,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug)) FROM rank_badges rb JOIN ranks r ON r.id=rb.rank_id WHERE rb.badge_id=b.id),'[]'::jsonb) AS ranks FROM badges b LEFT JOIN badge_categories c ON c.id=b.category_id WHERE ($1='' OR b.name ILIKE '%'||$1||'%' OR b.slug ILIKE '%'||$1||'%') ORDER BY b.display_order,b.name""", search.strip())
    return [dict(row) for row in rows]


async def save_badge(actor_id: UUID, payload: dict[str, Any], badge_id: str | None = None) -> dict[str, Any]:
    slug = _slug(str(payload.get("slug") or payload.get("name") or badge_id or ""))
    badge_id = badge_id or slug
    values = _definition_values(payload)
    category = UUID(str(payload["categoryId"])) if payload.get("categoryId") else None
    rarity = str(payload.get("rarity") or "COMMON").upper()[:32]
    async with _pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""INSERT INTO badges (id,slug,name,description,color,requirements,automatic_award,manual_assignment_allowed,visibility,limited,max_awards,available_from,expires_at,purchasable,price_minor,currency,active,display_order,category_id,rarity) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,description=EXCLUDED.description,color=EXCLUDED.color,requirements=EXCLUDED.requirements,automatic_award=EXCLUDED.automatic_award,manual_assignment_allowed=EXCLUDED.manual_assignment_allowed,visibility=EXCLUDED.visibility,limited=EXCLUDED.limited,max_awards=EXCLUDED.max_awards,available_from=EXCLUDED.available_from,expires_at=EXCLUDED.expires_at,purchasable=EXCLUDED.purchasable,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,active=EXCLUDED.active,display_order=EXCLUDED.display_order,category_id=EXCLUDED.category_id,rarity=EXCLUDED.rarity,updated_at=NOW() RETURNING *""", badge_id, slug, *values, category, rarity)
            await admin_db._audit(conn, actor_id, "badge.save", "badge", badge_id, {"slug": slug})
    invalidate_definition_cache()
    return dict(row)


async def update_badge_asset(actor_id: UUID, badge_id: str, *, asset_url: str, preview_url: str, asset_key: str, preview_key: str, mime: str, animated: bool) -> dict[str, Any] | None:
    async with _pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("UPDATE badges SET asset_url=$2,preview_url=$3,asset_key=$4,preview_key=$5,asset_mime=$6,animated=$7,updated_at=NOW() WHERE id=$1 RETURNING *", badge_id, asset_url, preview_url, asset_key, preview_key, mime, animated)
            if row:
                await admin_db._audit(conn, actor_id, "badge.asset.upload", "badge", badge_id, {"animated": animated, "mime": mime})
    return dict(row) if row else None


async def delete_badge(actor_id: UUID, badge_id: str) -> str:
    async with _pool().acquire() as conn:
        async with conn.transaction():
            owners = int(await conn.fetchval("SELECT count(*) FROM badge_awards WHERE badge_id=$1", badge_id) or 0)
            if owners:
                result = await conn.execute("UPDATE badges SET active=FALSE,updated_at=NOW() WHERE id=$1", badge_id)
                action = "disabled"
            else:
                result = await conn.execute("DELETE FROM badges WHERE id=$1", badge_id)
                action = "deleted"
            if result.endswith("0"):
                raise LookupError("badge")
            await admin_db._audit(conn, actor_id, f"badge.{action}", "badge", badge_id)
    invalidate_definition_cache()
    return action


async def list_ranks_admin(search: str = "") -> list[dict[str, Any]]:
    rows = await _pool().fetch("""SELECT r.*,COALESCE((SELECT count(*) FROM rank_awards a WHERE a.rank_id=r.id AND a.revoked_at IS NULL),0) AS owners,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'slug',b.slug)) FROM rank_badges rb JOIN badges b ON b.id=rb.badge_id WHERE rb.rank_id=r.id AND rb.included=TRUE),'[]'::jsonb) AS badges FROM ranks r WHERE ($1='' OR r.name ILIKE '%'||$1||'%' OR r.slug ILIKE '%'||$1||'%') ORDER BY r.level,r.display_order,r.name""", search.strip())
    return [dict(row) for row in rows]


async def save_rank(actor_id: UUID, payload: dict[str, Any], rank_id: UUID | None = None) -> dict[str, Any]:
    rank_id = rank_id or uuid4()
    slug = _slug(str(payload.get("slug") or payload.get("name") or ""))
    values = _definition_values(payload)
    level = int(payload.get("level") or 0)
    badge_ids = list(dict.fromkeys(str(item) for item in payload.get("badgeIds") or []))
    async with _pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""INSERT INTO ranks (id,slug,name,description,color,requirements,automatic_award,manual_assignment_allowed,visibility,limited,max_awards,available_from,expires_at,purchasable,price_minor,currency,active,display_order,level,created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,description=EXCLUDED.description,color=EXCLUDED.color,requirements=EXCLUDED.requirements,automatic_award=EXCLUDED.automatic_award,manual_assignment_allowed=EXCLUDED.manual_assignment_allowed,visibility=EXCLUDED.visibility,limited=EXCLUDED.limited,max_awards=EXCLUDED.max_awards,available_from=EXCLUDED.available_from,expires_at=EXCLUDED.expires_at,purchasable=EXCLUDED.purchasable,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,active=EXCLUDED.active,display_order=EXCLUDED.display_order,level=EXCLUDED.level,updated_at=NOW() RETURNING *""", rank_id, slug, *values, level, actor_id)
            await conn.execute("DELETE FROM rank_badges WHERE rank_id=$1", rank_id)
            for badge_id in badge_ids:
                await conn.execute("INSERT INTO rank_badges (rank_id,badge_id,included) VALUES ($1,$2,TRUE)", rank_id, badge_id)
            await admin_db._audit(conn, actor_id, "rank.save", "rank", str(rank_id), {"slug": slug, "badges": badge_ids})
    invalidate_definition_cache()
    return dict(row)


async def delete_rank(actor_id: UUID, rank_id: UUID) -> str:
    async with _pool().acquire() as conn:
        async with conn.transaction():
            owners = int(await conn.fetchval("SELECT count(*) FROM rank_awards WHERE rank_id=$1", rank_id) or 0)
            if owners:
                result = await conn.execute("UPDATE ranks SET active=FALSE,updated_at=NOW() WHERE id=$1", rank_id)
                action = "disabled"
            else:
                result = await conn.execute("DELETE FROM ranks WHERE id=$1", rank_id)
                action = "deleted"
            if result.endswith("0"):
                raise LookupError("rank")
            await admin_db._audit(conn, actor_id, f"rank.{action}", "rank", str(rank_id))
    invalidate_definition_cache()
    return action


async def assign(actor_id: UUID, user_id: UUID, item_type: str, item_id: str, *, reason: str = "", source: str = "MANUAL") -> bool:
    source = source.upper()
    if source not in SOURCES:
        raise ValueError("source")
    async with _pool().acquire() as conn:
        async with conn.transaction():
            if item_type == "BADGE":
                allowed = await conn.fetchval("SELECT manual_assignment_allowed FROM badges WHERE id=$1", item_id)
                if allowed is None:
                    raise LookupError("badge")
                if source == "MANUAL" and not allowed:
                    raise PermissionError("manual")
                changed = await _award_badge(conn, user_id, item_id, source, actor_id=actor_id, reason=reason)
            else:
                rank_id = UUID(item_id)
                allowed = await conn.fetchval("SELECT manual_assignment_allowed FROM ranks WHERE id=$1", rank_id)
                if allowed is None:
                    raise LookupError("rank")
                if source == "MANUAL" and not allowed:
                    raise PermissionError("manual")
                changed = await _award_rank(conn, user_id, rank_id, source, actor_id=actor_id, reason=reason)
            await admin_db._audit(conn, actor_id, f"{item_type.lower()}.assign", "user", str(user_id), {"item_id": item_id, "source": source, "reason": reason[:500], "changed": changed})
    return changed


async def revoke(actor_id: UUID, user_id: UUID, item_type: str, item_id: str, reason: str = "") -> bool:
    table, column, value = ("badge_awards", "badge_id", item_id) if item_type == "BADGE" else ("rank_awards", "rank_id", UUID(item_id))
    async with _pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(f"UPDATE {table} SET revoked_at=NOW(),revoked_by=$3,revoke_reason=$4 WHERE user_id=$1 AND {column}=$2 AND revoked_at IS NULL", user_id, value, actor_id, reason[:500])
            changed = result != "UPDATE 0"
            if item_type == "BADGE" and changed:
                await conn.execute("UPDATE user_badges SET enabled=FALSE WHERE user_id=$1 AND badge_id=$2", user_id, item_id)
            await admin_db._audit(conn, actor_id, f"{item_type.lower()}.revoke", "user", str(user_id), {"item_id": item_id, "reason": reason[:500], "changed": changed})
    return changed


async def list_assignments(search: str = "", item_type: str = "", active_only: bool = False) -> list[dict[str, Any]]:
    active = "AND a.revoked_at IS NULL" if active_only else ""
    rows: list[dict[str, Any]] = []
    if item_type in {"", "BADGE"}:
        rows.extend(dict(row) for row in await _pool().fetch(f"""SELECT 'BADGE' AS item_type,a.id,a.user_id,u.username,u.email,a.badge_id AS item_id,b.name AS item_name,a.source,a.earned_at,a.assigned_by,a.reason,a.purchase_id,a.revoked_at,a.revoke_reason FROM badge_awards a JOIN users u ON u.id=a.user_id JOIN badges b ON b.id=a.badge_id WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%') {active} ORDER BY a.earned_at DESC LIMIT 300""", search.strip()))
    if item_type in {"", "RANK"}:
        rows.extend(dict(row) for row in await _pool().fetch(f"""SELECT 'RANK' AS item_type,a.id,a.user_id,u.username,u.email,a.rank_id::text AS item_id,r.name AS item_name,a.source,a.earned_at,a.assigned_by,a.reason,a.purchase_id,a.revoked_at,a.revoke_reason FROM rank_awards a JOIN users u ON u.id=a.user_id JOIN ranks r ON r.id=a.rank_id WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%') {active} ORDER BY a.earned_at DESC LIMIT 300""", search.strip()))
    return sorted(rows, key=lambda item: item["earned_at"], reverse=True)[:300]


async def owners(item_type: str, item_id: str) -> list[dict[str, Any]]:
    if item_type == "BADGE":
        return [dict(row) for row in await _pool().fetch("SELECT a.*,u.username,u.email FROM badge_awards a JOIN users u ON u.id=a.user_id WHERE a.badge_id=$1 ORDER BY a.earned_at DESC", item_id)]
    return [dict(row) for row in await _pool().fetch("SELECT a.*,u.username,u.email FROM rank_awards a JOIN users u ON u.id=a.user_id WHERE a.rank_id=$1 ORDER BY a.earned_at DESC", UUID(item_id))]


async def list_purchases(search: str = "", status: str = "") -> list[dict[str, Any]]:
    rows = await _pool().fetch("""SELECT p.*,u.username,u.email,b.name AS badge_name,r.name AS rank_name FROM purchase_records p JOIN users u ON u.id=p.user_id LEFT JOIN badges b ON b.id=p.badge_id LEFT JOIN ranks r ON r.id=p.rank_id WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%') AND ($2='' OR p.status=$2) ORDER BY p.created_at DESC LIMIT 300""", search.strip(), status.upper())
    return [dict(row) for row in rows]


async def create_purchase(user_id: UUID, item_type: str, item_id: str, idempotency_key: str | None = None) -> dict[str, Any]:
    kind = item_type.upper()
    if kind == "BADGE":
        definition = await _pool().fetchrow("SELECT id,purchasable,price_minor,currency FROM badges WHERE id=$1 AND active=TRUE", item_id)
    elif kind == "RANK":
        definition = await _pool().fetchrow("SELECT id,purchasable,price_minor,currency FROM ranks WHERE id=$1 AND active=TRUE", UUID(item_id))
    else:
        raise ValueError("item_type")
    if not definition or not definition["purchasable"]:
        raise PermissionError("not_purchasable")
    row = await _pool().fetchrow("""INSERT INTO purchase_records (id,user_id,item_type,badge_id,rank_id,status,amount_minor,currency,idempotency_key) VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8) RETURNING *""", uuid4(), user_id, kind, item_id if kind == "BADGE" else None, UUID(item_id) if kind == "RANK" else None, int(definition["price_minor"] or 0), definition["currency"], idempotency_key)
    return dict(row)


async def transition_purchase(actor_id: UUID, purchase_id: UUID, status: str, provider_reference: str = "", *, provider_verified: bool = False) -> dict[str, Any] | None:
    target = status.upper()
    if target not in PURCHASE_STATES:
        raise ValueError("status")
    if target == "COMPLETED" and not provider_verified:
        raise PermissionError("provider_verification_required")
    async with _pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT * FROM purchase_records WHERE id=$1 FOR UPDATE", purchase_id)
            if not row:
                return None
            allowed = {"PENDING":{"COMPLETED","FAILED","CANCELLED"},"COMPLETED":{"REFUNDED"},"FAILED":set(),"REFUNDED":set(),"CANCELLED":set()}
            if target != row["status"] and target not in allowed.get(row["status"], set()):
                raise ValueError("transition")
            updated = await conn.fetchrow("""UPDATE purchase_records SET status=$2,provider_reference=CASE WHEN $3='' THEN provider_reference ELSE $3 END,updated_at=NOW(),completed_at=CASE WHEN $2='COMPLETED' THEN NOW() ELSE completed_at END WHERE id=$1 RETURNING *""", purchase_id, target, provider_reference[:255])
            if target == "COMPLETED" and row["status"] != "COMPLETED":
                if row["item_type"] == "BADGE":
                    await _award_badge(conn, row["user_id"], row["badge_id"], "PURCHASE", actor_id=actor_id, reason="Completed purchase", purchase_id=purchase_id)
                else:
                    await _award_rank(conn, row["user_id"], row["rank_id"], "PURCHASE", actor_id=actor_id, reason="Completed purchase", purchase_id=purchase_id)
            await admin_db._audit(conn, actor_id, "purchase.transition", "purchase", str(purchase_id), {"from": row["status"], "to": target})
    return dict(updated)


async def current_rank_for_user(user_id: str | UUID) -> dict[str, Any] | None:
    row = await _pool().fetchrow("""SELECT r.id,r.slug,r.name,r.description,r.level,r.color,a.source,a.earned_at FROM rank_awards a JOIN ranks r ON r.id=a.rank_id WHERE a.user_id=$1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>NOW()) AND r.active=TRUE ORDER BY r.level DESC,r.display_order DESC,a.earned_at DESC LIMIT 1""", UUID(str(user_id)))
    return dict(row) if row else None
