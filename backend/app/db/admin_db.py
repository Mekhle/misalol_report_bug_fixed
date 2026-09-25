import json
import hmac
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import asyncpg

from app.core.security import normalize_ip, username_hits_banned_word
from app.core.feature_flags import FEATURE_FLAG_CATALOG

STAFF_SECTIONS = (
    "users",
    "constellations",
    "bans",
    "reserved",
    "banned",
    "badges",
    "premium",
    "reports",
    "flags",
    "bakaboost",
    "themes",
    "templates",
    "fonts",
    "audit",
)
STAFF_ROLES = ("admin", "moderator")

_pool: asyncpg.Pool | None = None


async def init_admin_db(
    database_url: str,
    root_email: str = "",
    *,
    initialize_schema: bool = True,
) -> None:
    global _pool
    if not database_url:
        return
    _pool = await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=4,
        command_timeout=30,
        max_inactive_connection_lifetime=30,
    )
    if not initialize_schema:
        return
    # Multiple Gunicorn workers execute lifespan concurrently.  A transaction-scoped
    # lock serializes bootstrap without leaving a session-level lock behind if a
    # worker is terminated.  Bootstrap can exceed the pool's normal 30-second
    # command timeout on an existing production schema, so only lock acquisition
    # receives the bounded extended timeout.
    async with _pool.acquire() as schema_lock:
        async with schema_lock.transaction():
            await schema_lock.execute(
                "SELECT pg_advisory_xact_lock(hashtext('misa_admin_schema_bootstrap'))",
                timeout=120,
            )
            await _ensure_admin_schema(root_email)


async def _ensure_admin_schema(root_email: str) -> None:
    """Run startup schema work once when multiple application workers boot."""
    await ensure_badge_icons()
    await ensure_verification_requests()
    await ensure_discord_links()
    await ensure_analytics_tables()
    await ensure_template_tables()
    await ensure_username_history()
    await ensure_account_security()
    await ensure_banned_username_words()
    await ensure_user_bans()
    await ensure_staff_access()
    await ensure_feature_flags()
    await ensure_premium_ranks()
    from app.db import achievements
    await achievements.ensure_schema()
    await ensure_default_fonts()
    await ensure_constellation_tables()
    await ensure_apple_support()
    await ensure_admin_auth_tables(root_email)


async def close_admin_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
    _pool = None


def _get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("admin database is not initialised")
    return _pool


def has_pool() -> bool:
    return _pool is not None


def database_pool() -> asyncpg.Pool:
    """Return the application's shared PostgreSQL pool for integrated domains."""
    return _get_pool()


async def ensure_constellation_tables() -> None:
    """Install the production Constellations schema in the existing database."""
    if _pool is None:
        return
    statements = (
        """
        CREATE TABLE IF NOT EXISTS constellations (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(60) NOT NULL,
            slug VARCHAR(32) NOT NULL UNIQUE,
            description VARCHAR(500) NOT NULL DEFAULT '',
            capacity SMALLINT NOT NULL CHECK (capacity BETWEEN 2 AND 4),
            assignment_mode VARCHAR(16) NOT NULL DEFAULT 'owner'
                CHECK (assignment_mode IN ('owner', 'self')),
            global_font VARCHAR(120) NOT NULL DEFAULT 'Inter',
            allow_member_fonts BOOLEAN NOT NULL DEFAULT TRUE,
            allow_member_move BOOLEAN NOT NULL DEFAULT TRUE,
            allow_member_resize BOOLEAN NOT NULL DEFAULT TRUE,
            frame_mode VARCHAR(16) NOT NULL DEFAULT 'member'
                CHECK (frame_mode IN ('member', 'framed', 'frameless')),
            background JSONB NOT NULL DEFAULT '{"type":"color","color":"#08080d"}'::jsonb,
            shared_assets JSONB NOT NULL DEFAULT '{"cursor":null,"audio":null}'::jsonb,
            status VARCHAR(16) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'suspended')),
            published_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        ALTER TABLE constellations
        ADD COLUMN IF NOT EXISTS shared_assets JSONB NOT NULL
        DEFAULT '{"cursor":null,"audio":null}'::jsonb
        """,
        """
        CREATE TABLE IF NOT EXISTS constellation_members (
            constellation_id UUID NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
            slot SMALLINT NOT NULL CHECK (slot >= 1 AND slot <= 4),
            position_x NUMERIC(6,3) NOT NULL DEFAULT 50,
            position_y NUMERIC(6,3) NOT NULL DEFAULT 50,
            scale NUMERIC(5,3) NOT NULL DEFAULT 1,
            frame_override VARCHAR(16) NOT NULL DEFAULT 'inherit'
                CHECK (frame_override IN ('inherit', 'framed', 'frameless')),
            profile_config JSONB,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (constellation_id, user_id),
            UNIQUE (constellation_id, slot)
        )
        """,
        """
        ALTER TABLE constellation_members
        ADD COLUMN IF NOT EXISTS profile_config JSONB
        """,
        """
        UPDATE constellation_members AS member
        SET profile_config = profile.config
        FROM profiles AS profile
        WHERE profile.user_id = member.user_id
          AND profile.disabled_at IS NULL
          AND member.profile_config IS NULL
        """,
        """
        CREATE TABLE IF NOT EXISTS constellation_invitations (
            id UUID PRIMARY KEY,
            constellation_id UUID NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
            token_hash CHAR(64) NOT NULL UNIQUE,
            invited_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            invited_username VARCHAR(32),
            invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            accepted_at TIMESTAMPTZ,
            accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        DO $constellation_limit$
        DECLARE capacity_definition TEXT;
        BEGIN
            SELECT pg_get_constraintdef(oid) INTO capacity_definition
            FROM pg_constraint
            WHERE conrelid = 'constellations'::regclass
              AND conname = 'constellations_capacity_check';
            IF capacity_definition IS NULL OR capacity_definition NOT LIKE '%4%' THEN
                ALTER TABLE constellations DROP CONSTRAINT IF EXISTS constellations_capacity_check;
                ALTER TABLE constellations ADD CONSTRAINT constellations_capacity_check
                    CHECK (capacity BETWEEN 2 AND 4) NOT VALID;
            END IF;
        END;
        $constellation_limit$;
        """,
        """
        DO $constellation_slot_limit$
        DECLARE slot_definition TEXT;
        BEGIN
            SELECT pg_get_constraintdef(oid) INTO slot_definition
            FROM pg_constraint
            WHERE conrelid = 'constellation_members'::regclass
              AND conname = 'constellation_members_slot_check';
            IF slot_definition IS NULL OR slot_definition NOT LIKE '%4%' THEN
                ALTER TABLE constellation_members DROP CONSTRAINT IF EXISTS constellation_members_slot_check;
                ALTER TABLE constellation_members ADD CONSTRAINT constellation_members_slot_check
                    CHECK (slot BETWEEN 1 AND 4) NOT VALID;
            END IF;
        END;
        $constellation_slot_limit$;
        """,
        "CREATE INDEX IF NOT EXISTS constellations_owner_idx ON constellations (owner_id, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS constellations_status_idx ON constellations (status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS constellation_members_user_idx ON constellation_members (user_id, joined_at DESC)",
        "CREATE INDEX IF NOT EXISTS constellation_invites_target_idx ON constellation_invitations (invited_user_id, expires_at DESC)",
        "CREATE INDEX IF NOT EXISTS constellation_invites_group_idx ON constellation_invitations (constellation_id, created_at DESC)",
    )
    async with _pool.acquire() as conn:
        async with conn.transaction():
            for statement in statements:
                await conn.execute(statement)

async def ensure_discord_links() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS discord_links (
                user_id UUID PRIMARY KEY,
                discord_id TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                access_token TEXT,
                access_expires_at TIMESTAMPTZ,
                show_avatar BOOLEAN NOT NULL DEFAULT TRUE,
                show_decoration BOOLEAN NOT NULL DEFAULT TRUE,
                show_guild_tag BOOLEAN NOT NULL DEFAULT TRUE,
                show_status BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute("ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS show_status BOOLEAN NOT NULL DEFAULT TRUE")
    except (asyncpg.PostgresError, OSError):
        return


async def ensure_apple_support() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id VARCHAR(128) UNIQUE")
    except (asyncpg.PostgresError, OSError):
        return


async def ensure_analytics_tables() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS profile_events (
                id BIGSERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                kind TEXT NOT NULL,
                social_id TEXT NOT NULL DEFAULT '',
                social_label TEXT NOT NULL DEFAULT '',
                referrer_host TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                device TEXT NOT NULL DEFAULT 'desktop',
                visitor_hash TEXT NOT NULL,
                occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute(
            """
            CREATE INDEX IF NOT EXISTS profile_events_user_time
            ON profile_events (user_id, occurred_at DESC)
            """
        )
        await _pool.execute(
            """
            CREATE INDEX IF NOT EXISTS profile_events_user_kind_time
            ON profile_events (user_id, kind, occurred_at DESC)
            """
        )
        await _pool.execute(
            """
            CREATE INDEX IF NOT EXISTS profile_events_kind_time
            ON profile_events (kind, occurred_at DESC)
            """
        )
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS profile_stats (
                user_id UUID PRIMARY KEY,
                views BIGINT NOT NULL DEFAULT 0,
                clicks BIGINT NOT NULL DEFAULT 0
            )
            """
        )
    except (asyncpg.PostgresError, OSError):
        return


async def ensure_template_tables() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                granted_by UUID,
                granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, role)
            )
            """
        )
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS profile_templates (
                id UUID PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                config JSONB NOT NULL,
                preview JSONB NOT NULL DEFAULT '{}'::jsonb,
                preview_image_url TEXT,
                published BOOLEAN NOT NULL DEFAULT TRUE,
                created_by UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        # These columns were added after the first template release. Keep the
        # migration idempotent so existing production databases are upgraded
        # on startup without replacing or losing any saved templates.
        await _pool.execute(
            "ALTER TABLE profile_templates ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'"
        )
        await _pool.execute(
            "ALTER TABLE profile_templates ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'"
        )
        await _pool.execute(
            "ALTER TABLE profile_templates ADD COLUMN IF NOT EXISTS preview_image_url TEXT"
        )
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS template_favorites (
                template_id UUID NOT NULL REFERENCES profile_templates(id) ON DELETE CASCADE,
                user_id UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (template_id, user_id)
            )
            """
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS template_favorites_user_idx ON template_favorites (user_id, created_at DESC)"
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS template_favorites_template_created_idx ON template_favorites (template_id, created_at DESC)"
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS profile_templates_published_idx ON profile_templates (published, updated_at DESC)"
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS profile_templates_creator_idx ON profile_templates (created_by)"
        )
        await _seed_official_templates()
    except (asyncpg.PostgresError, OSError):
        return


async def _seed_official_templates() -> None:
    if _pool is None:
        return
    existing = await _pool.fetchval("SELECT COUNT(*) FROM profile_templates")
    if int(existing or 0) > 0:
        return
    from app.core.templates import official_seed_looks

    system_id = UUID("00000000-0000-0000-0000-000000000001")
    for look in official_seed_looks():
        await _pool.execute(
            """
            INSERT INTO profile_templates (id, slug, name, description, config, preview, published, created_by)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE, $7)
            ON CONFLICT (slug) DO NOTHING
            """,
            uuid4(),
            look["slug"],
            look["name"],
            look["description"],
            json.dumps(look["config"]),
            json.dumps(look["preview"]),
            system_id,
        )


async def user_has_role(user_id: str, role: str) -> bool:
    if _pool is None:
        return False
    try:
        row = await _pool.fetchrow(
            "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2",
            UUID(user_id),
            role,
        )
    except (asyncpg.PostgresError, OSError, ValueError):
        return False
    return row is not None


async def set_user_role(actor_id: UUID, user_id: UUID, role: str, granted: bool) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            exists = await conn.fetchrow("SELECT 1 FROM users WHERE id = $1", user_id)
            if exists is None:
                return False
            if granted:
                await conn.execute(
                    """
                    INSERT INTO user_roles (user_id, role, granted_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, role) DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = NOW()
                    """,
                    user_id,
                    role,
                    actor_id,
                )
                await _audit(conn, actor_id, "role.grant", "user", str(user_id), {"role": role})
            else:
                await conn.execute("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", user_id, role)
                await _audit(conn, actor_id, "role.revoke", "user", str(user_id), {"role": role})
    return True


def _template_row(row: asyncpg.Record) -> dict[str, Any]:
    item = dict(row)
    config = item.get("config")
    if isinstance(config, str):
        item["config"] = json.loads(config)
    preview = item.get("preview")
    if isinstance(preview, str):
        item["preview"] = json.loads(preview)
    return item


async def list_published_templates(sort: str = "latest") -> list[dict[str, Any]]:
    order_by = {
        "latest": "t.updated_at DESC, t.id DESC",
        "popular": "favorite_count DESC, t.updated_at DESC, t.id DESC",
        "week": "week_favorite_count DESC, t.updated_at DESC, t.id DESC",
        "month": "month_favorite_count DESC, t.updated_at DESC, t.id DESC",
        "all_time": "favorite_count DESC, t.created_at ASC, t.id ASC",
    }.get(sort, "t.updated_at DESC, t.id DESC")
    rows = await _get_pool().fetch(
        f"""
        SELECT t.id, t.slug, t.name, t.description, t.preview, t.preview_image_url, t.published, t.visibility, t.tags, t.created_by,
               t.created_at, t.updated_at, u.username AS creator_username,
               (SELECT COUNT(*) FROM template_favorites f WHERE f.template_id = t.id)::int AS favorite_count,
               (SELECT COUNT(*) FROM template_favorites f WHERE f.template_id = t.id AND f.created_at >= NOW() - INTERVAL '7 days')::int AS week_favorite_count,
               (SELECT COUNT(*) FROM template_favorites f WHERE f.template_id = t.id AND f.created_at >= NOW() - INTERVAL '30 days')::int AS month_favorite_count
        FROM profile_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.published = TRUE AND t.visibility = 'public'
        ORDER BY {order_by}
        """
    )
    return [_template_row(row) for row in rows]


async def list_templates_by_creator(user_id: str) -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT t.id, t.slug, t.name, t.description, t.preview, t.preview_image_url, t.published, t.visibility, t.tags, t.created_by,
               t.created_at, t.updated_at, u.username AS creator_username
        FROM profile_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.created_by = $1
        ORDER BY t.updated_at DESC
        """,
        UUID(user_id),
    )
    return [_template_row(row) for row in rows]


async def list_all_templates() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT t.id, t.slug, t.name, t.description, t.preview, t.preview_image_url, t.published, t.visibility, t.tags, t.created_by,
               t.created_at, t.updated_at, u.username AS creator_username
        FROM profile_templates t
        LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.updated_at DESC
        """
    )
    return [_template_row(row) for row in rows]


async def get_template(template_id: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        """
        SELECT t.id, t.slug, t.name, t.description, t.config, t.preview, t.preview_image_url, t.published, t.visibility, t.tags, t.created_by,
               t.created_at, t.updated_at, u.username AS creator_username
        FROM profile_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1
        """,
        UUID(template_id),
    )
    return _template_row(row) if row else None


async def get_template_by_slug(slug: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        """
        SELECT t.id, t.slug, t.name, t.description, t.config, t.preview, t.preview_image_url, t.published,
               t.visibility, t.tags, t.created_by, t.created_at, t.updated_at,
               u.username AS creator_username
        FROM profile_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.slug = $1
        """,
        slug,
    )
    return _template_row(row) if row else None


async def count_templates_for_creator(user_id: str) -> int:
    value = await _get_pool().fetchval(
        "SELECT COUNT(*) FROM profile_templates WHERE created_by = $1",
        UUID(user_id),
    )
    return int(value or 0)


async def insert_template(
    creator_id: str,
    slug: str,
    name: str,
    description: str,
    config: dict[str, Any],
    preview: dict[str, Any],
    tags: list[str] | None = None,
    visibility: str = "public",
    preview_image_url: str | None = None,
) -> dict[str, Any]:
    template_id = uuid4()
    row = await _get_pool().fetchrow(
        """
        INSERT INTO profile_templates (id, slug, name, description, config, preview, preview_image_url, published, visibility, tags, created_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, TRUE, $8, $9, $10)
        RETURNING id, slug, name, description, preview, preview_image_url, published, visibility, tags, created_by, created_at, updated_at
        """,
        template_id,
        slug,
        name,
        description,
        json.dumps(config),
        json.dumps(preview),
        preview_image_url,
        visibility,
        tags or [],
        UUID(creator_id),
    )
    return _template_row(row) if row else {"id": str(template_id), "slug": slug, "name": name}


async def update_template_meta(
    template_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    published: bool | None = None,
    slug: str | None = None,
    tags: list[str] | None = None,
    visibility: str | None = None,
) -> dict[str, Any] | None:
    current = await get_template(template_id)
    if current is None:
        return None
    next_name = name if name is not None else current["name"]
    next_description = description if description is not None else current["description"]
    next_published = current["published"] if published is None else published
    next_slug = slug if slug is not None else current["slug"]
    next_tags = (current.get("tags") or []) if tags is None else tags
    next_visibility = (current.get("visibility") or "public") if visibility is None else visibility
    await _get_pool().execute(
        """
        UPDATE profile_templates
        SET name = $2, description = $3, published = $4, slug = $5, tags = $6, visibility = $7, updated_at = NOW()
        WHERE id = $1
        """,
        UUID(template_id),
        next_name,
        next_description,
        next_published,
        next_slug,
        next_tags,
        next_visibility,
    )
    return await get_template(template_id)


async def refresh_template_snapshot(template_id: str, config: dict[str, Any], preview: dict[str, Any], preview_image_url: str | None = None) -> dict[str, Any] | None:
    result = await _get_pool().execute(
        """
        UPDATE profile_templates
        SET config = $2::jsonb, preview = $3::jsonb, preview_image_url = $4, updated_at = NOW()
        WHERE id = $1
        """,
        UUID(template_id),
        json.dumps(config),
        json.dumps(preview),
        preview_image_url,
    )
    if result != "UPDATE 1":
        return None
    return await get_template(template_id)


async def delete_template(template_id: str) -> bool:
    result = await _get_pool().execute("DELETE FROM profile_templates WHERE id = $1", UUID(template_id))
    return result == "DELETE 1"


async def set_template_favorite(user_id: str, template_id: str, favorite: bool) -> bool:
    template = await get_template(template_id)
    if template is None:
        return False
    if favorite:
        await _get_pool().execute(
            """
            INSERT INTO template_favorites (template_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (template_id, user_id) DO NOTHING
            """,
            UUID(template_id),
            UUID(user_id),
        )
        return True
    await _get_pool().execute(
        "DELETE FROM template_favorites WHERE template_id = $1 AND user_id = $2",
        UUID(template_id),
        UUID(user_id),
    )
    return True


async def template_favorite_ids(user_id: str) -> set[str]:
    rows = await _get_pool().fetch(
        "SELECT template_id FROM template_favorites WHERE user_id = $1",
        UUID(user_id),
    )
    return {str(row["template_id"]) for row in rows}


async def ensure_username_history() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS username_history (
                id BIGSERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                old_username VARCHAR(32),
                new_username VARCHAR(32),
                changed_by UUID,
                reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS username_history_old_idx ON username_history (lower(old_username))"
        )
    except (asyncpg.PostgresError, OSError):
        return


async def ensure_account_security() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS user_security (
                user_id UUID PRIMARY KEY,
                mfa_secret TEXT,
                mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS mfa_backup_codes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                code_hash TEXT NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute(
            "CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_idx ON mfa_backup_codes (user_id) WHERE used_at IS NULL"
        )
    except (asyncpg.PostgresError, OSError):
        return


async def mfa_is_enabled(user_id: str) -> bool:
    if _pool is None:
        return False
    try:
        value = await _get_pool().fetchval(
            "SELECT mfa_enabled FROM user_security WHERE user_id = $1",
            UUID(user_id),
        )
    except (asyncpg.PostgresError, OSError, ValueError):
        return False
    return bool(value)


async def set_mfa_enabled(user_id: str, enabled: bool) -> None:
    await _get_pool().execute(
        """
        INSERT INTO user_security (user_id, mfa_enabled, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE SET mfa_enabled = EXCLUDED.mfa_enabled, updated_at = NOW()
        """,
        UUID(user_id),
        enabled,
    )


async def unused_backup_count(user_id: str) -> int:
    if _pool is None:
        return 0
    try:
        value = await _get_pool().fetchval(
            "SELECT count(*) FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL",
            UUID(user_id),
        )
    except (asyncpg.PostgresError, OSError, ValueError):
        return 0
    return int(value or 0)


async def replace_backup_codes(user_id: str, code_hashes: list[str]) -> None:
    pool = _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = $1", UUID(user_id))
            if code_hashes:
                await conn.executemany(
                    "INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)",
                    [(UUID(user_id), digest) for digest in code_hashes],
                )
            await conn.execute(
                """
                INSERT INTO user_security (user_id, mfa_enabled, updated_at)
                VALUES ($1, TRUE, NOW())
                ON CONFLICT (user_id) DO UPDATE SET mfa_enabled = TRUE, updated_at = NOW()
                """,
                UUID(user_id),
            )


async def disable_mfa(user_id: str) -> None:
    pool = _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = $1", UUID(user_id))
            await conn.execute(
                """
                INSERT INTO user_security (user_id, mfa_enabled, updated_at)
                VALUES ($1, FALSE, NOW())
                ON CONFLICT (user_id) DO UPDATE SET mfa_enabled = FALSE, updated_at = NOW()
                """,
                UUID(user_id),
            )


async def consume_backup_code(user_id: str, code_hash: str) -> bool:
    result = await _get_pool().execute(
        """
        UPDATE mfa_backup_codes
        SET used_at = NOW()
        WHERE id = (
            SELECT id FROM mfa_backup_codes
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
            LIMIT 1
        )
        """,
        UUID(user_id),
        code_hash,
    )
    return result == "UPDATE 1"


async def unused_backup_hashes(user_id: str) -> list[str]:
    rows = await _get_pool().fetch(
        "SELECT code_hash FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL",
        UUID(user_id),
    )
    return [str(row["code_hash"]) for row in rows]


async def resolve_user_ref(value: str) -> str | None:
    raw = value.strip().lstrip("@")
    if not raw:
        return None
    try:
        user_id = UUID(raw)
    except ValueError:
        return await get_user_id_by_username(raw)
    row = await _get_pool().fetchrow("SELECT id::text AS id FROM users WHERE id = $1", user_id)
    return str(row["id"]) if row and row["id"] else None


async def get_user_id_by_username(username: str) -> str | None:
    handle = username.strip().lstrip("@").lower()
    row = await _get_pool().fetchrow(
        "SELECT id::text AS id FROM users WHERE lower(username) = $1",
        handle,
    )
    if row and row["id"]:
        return str(row["id"])
    try:
        alias = await _get_pool().fetchrow(
            """
            SELECT user_id::text AS id
            FROM username_history
            WHERE lower(old_username) = $1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            handle,
        )
    except asyncpg.UndefinedTableError:
        return None
    return str(alias["id"]) if alias and alias["id"] else None


async def current_username_for_alias(username: str) -> str | None:
    if _pool is None:
        return None
    handle = username.lower()
    try:
        row = await _get_pool().fetchrow(
            """
            SELECT lower(u.username) AS username
            FROM username_history h
            JOIN users u ON u.id = h.user_id
            WHERE lower(h.old_username) = $1 AND lower(u.username) IS DISTINCT FROM $1
            ORDER BY h.created_at DESC
            LIMIT 1
            """,
            handle,
        )
    except (asyncpg.PostgresError, OSError):
        return None
    value = str((row or {}).get("username") or "").strip()
    return value or None


async def owns_former_username(user_id: str, username: str) -> bool:
    if _pool is None:
        return False
    try:
        row = await _get_pool().fetchrow(
            "SELECT 1 FROM username_history WHERE lower(old_username) = $1 AND user_id = $2 LIMIT 1",
            username.lower(),
            UUID(user_id),
        )
    except (asyncpg.PostgresError, OSError, ValueError):
        return False
    return row is not None


async def has_username_history(username: str) -> bool:
    if _pool is None:
        return False
    try:
        row = await _get_pool().fetchrow(
            "SELECT 1 FROM username_history WHERE lower(old_username) = $1 LIMIT 1",
            username.lower(),
        )
    except (asyncpg.PostgresError, OSError):
        return False
    return row is not None


async def change_username(user_id: str, new_username: str, old_username: str | None) -> None:
    owner = UUID(user_id)
    new_handle = new_username.lower()
    old_handle = (old_username or "").strip().lower() or None
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow("SELECT username FROM users WHERE id = $1 FOR UPDATE", owner)
            if current is None:
                raise LookupError("user")
            live = str(current.get("username") or "").strip().lower() or None
            if live == new_handle:
                return
            taken = await conn.fetchrow(
                "SELECT 1 FROM users WHERE lower(username) = $1 AND id <> $2",
                new_handle,
                owner,
            )
            if taken:
                raise ValueError("taken")
            banned = await conn.fetch("SELECT word FROM banned_username_words")
            if username_hits_banned_word(new_handle, [row["word"] for row in banned]):
                raise ValueError("banned")
            reserved = await conn.fetchrow("SELECT 1 FROM reserved_usernames WHERE username = $1", new_handle)
            former = await conn.fetchrow(
                "SELECT user_id FROM username_history WHERE lower(old_username) = $1 ORDER BY created_at DESC LIMIT 1",
                new_handle,
            )
            former_owner = str(former["user_id"]) if former and former["user_id"] else ""
            if reserved and former_owner != user_id:
                raise ValueError("reserved")
            if former is not None and former_owner != user_id:
                raise ValueError("reserved")
            try:
                await conn.execute(
                    "UPDATE users SET username = $2, updated_at = NOW() WHERE id = $1",
                    owner,
                    new_handle,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ValueError("taken") from exc
            if old_handle and old_handle != new_handle:
                await conn.execute(
                    """
                    INSERT INTO username_history (user_id, old_username, new_username, changed_by, reason)
                    VALUES ($1, $2, $3, $1, 'User rename')
                    """,
                    owner,
                    old_handle,
                    new_handle,
                )
                await conn.execute(
                    """
                    INSERT INTO reserved_usernames (username, reason, created_by)
                    VALUES ($1, 'Former username', $2)
                    ON CONFLICT (username) DO UPDATE SET reason = 'Former username', created_by = EXCLUDED.created_by
                    """,
                    old_handle,
                    owner,
                )
            if former_owner == user_id:
                await conn.execute(
                    "DELETE FROM reserved_usernames WHERE username = $1 AND reason = 'Former username'",
                    new_handle,
                )
            await conn.execute(
                """
                UPDATE profiles
                SET config = CASE
                    WHEN config ? 'profile' THEN jsonb_set(config, ARRAY['profile','username']::text[], to_jsonb($2::text), true)
                    WHEN config #> '{config,profile}' IS NOT NULL THEN jsonb_set(config, ARRAY['config','profile','username']::text[], to_jsonb($2::text), true)
                    ELSE config
                END,
                updated_at = NOW()
                WHERE user_id = $1
                """,
                owner,
                new_handle,
            )
            await _audit(conn, owner, "user.rename", "user", user_id, {"from": old_handle, "to": new_handle})


async def get_profile_view_count(user_id: str) -> int:
    row = await _get_pool().fetchrow(
        "SELECT views FROM profile_stats WHERE user_id = $1",
        UUID(user_id),
    )
    return int((row or {}).get("views") or 0)


async def record_profile_event(
    user_id: str,
    kind: str,
    *,
    social_id: str,
    social_label: str,
    referrer_host: str,
    country: str,
    device: str,
    visitor_hash: str,
) -> None:
    owner = UUID(user_id)
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO profile_events (
                    user_id, kind, social_id, social_label, referrer_host, country, device, visitor_hash
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                owner,
                kind,
                social_id,
                social_label,
                referrer_host,
                country,
                device,
                visitor_hash,
            )
            if kind == "view":
                metric_value = await conn.fetchval(
                    """
                    INSERT INTO profile_stats (user_id, views, clicks)
                    VALUES ($1, 1, 0)
                    ON CONFLICT (user_id) DO UPDATE SET views = profile_stats.views + 1
                    RETURNING views
                    """,
                    owner,
                )
            else:
                metric_value = await conn.fetchval(
                    """
                    INSERT INTO profile_stats (user_id, views, clicks)
                    VALUES ($1, 0, 1)
                    ON CONFLICT (user_id) DO UPDATE SET clicks = profile_stats.clicks + 1
                    RETURNING clicks
                    """,
                    owner,
                )

    metric = "views" if kind == "view" else "clicks"
    value = int(metric_value or 0)
    from app.db import achievements
    if await achievements.should_evaluate_metric(metric, value):
        await achievements.evaluate_user(owner)

async def analytics_window(user_id: str, start: Any, end: Any) -> dict[str, Any]:
    owner = UUID(user_id)
    async with _get_pool().acquire() as conn:
        views = await conn.fetchval(
            "SELECT COUNT(*) FROM profile_events WHERE user_id = $1 AND kind = 'view' AND occurred_at >= $2 AND occurred_at < $3",
            owner,
            start,
            end,
        )
        clicks = await conn.fetchval(
            "SELECT COUNT(*) FROM profile_events WHERE user_id = $1 AND kind = 'click' AND occurred_at >= $2 AND occurred_at < $3",
            owner,
            start,
            end,
        )
        series = await conn.fetch(
            """
            SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS views
            FROM profile_events
            WHERE user_id = $1 AND kind = 'view' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1
            """,
            owner,
            start,
            end,
        )
        devices = await conn.fetch(
            """
            SELECT device, COUNT(*)::int AS count
            FROM profile_events
            WHERE user_id = $1 AND kind = 'view' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1
            """,
            owner,
            start,
            end,
        )
        referrers = await conn.fetch(
            """
            SELECT COALESCE(NULLIF(referrer_host, ''), 'direct') AS host, COUNT(*)::int AS count
            FROM profile_events
            WHERE user_id = $1 AND kind = 'view' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 8
            """,
            owner,
            start,
            end,
        )
        socials = await conn.fetch(
            """
            SELECT social_id AS id, MAX(social_label) AS label, COUNT(*)::int AS clicks
            FROM profile_events
            WHERE user_id = $1 AND kind = 'click' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1
            ORDER BY clicks DESC
            LIMIT 8
            """,
            owner,
            start,
            end,
        )
        countries = await conn.fetch(
            """
            SELECT country, COUNT(*)::int AS count
            FROM profile_events
            WHERE user_id = $1 AND kind = 'view' AND country <> '' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 8
            """,
            owner,
            start,
            end,
        )
    return {
        "views": int(views or 0),
        "clicks": int(clicks or 0),
        "series": [{"day": row["day"], "views": row["views"]} for row in series],
        "devices": {str(row["device"] or "desktop"): int(row["count"]) for row in devices},
        "referrers": [{"host": str(row["host"] or "direct"), "count": int(row["count"])} for row in referrers],
        "socials": [{"id": str(row["id"] or ""), "label": str(row["label"] or ""), "clicks": int(row["clicks"])} for row in socials],
        "countries": [{"country": str(row["country"] or ""), "count": int(row["count"])} for row in countries],
    }


_LIVE_PROFILE = "u.username IS NOT NULL AND length(u.username) >= 3 AND u.suspended_at IS NULL"


async def leaderboard_rows(metric: str, start: Any, limit: int = 50) -> list[dict[str, Any]]:
    wanted = "views" if metric == "views" else "clicks"
    try:
        if start is None:
            rows = await _get_pool().fetch(
                f"""
                SELECT u.id::text AS user_id,
                       u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
                       s.views::int AS views,
                       s.clicks::int AS clicks
                FROM profile_stats s
                JOIN users u ON u.id = s.user_id
                WHERE {_LIVE_PROFILE} AND s.{wanted} > 0
                ORDER BY s.{wanted} DESC, u.username ASC
                LIMIT $1
                """,
                max(1, min(limit, 50)),
            )
        else:
            rows = await _get_pool().fetch(
                f"""
                SELECT u.id::text AS user_id,
                       u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
                       COUNT(*) FILTER (WHERE e.kind = 'view')::int AS views,
                       COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks
                FROM profile_events e
                JOIN users u ON u.id = e.user_id
                WHERE e.occurred_at >= $2 AND {_LIVE_PROFILE}
                GROUP BY u.id, u.username, u.display_name
                HAVING COUNT(*) FILTER (WHERE e.kind = $3) > 0
                ORDER BY COUNT(*) FILTER (WHERE e.kind = $3) DESC, u.username ASC
                LIMIT $1
                """,
                max(1, min(limit, 50)),
                start,
                "view" if wanted == "views" else "click",
            )
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        return []
    return [dict(row) for row in rows]


async def latest_profile_rows(limit: int = 50) -> list[dict[str, Any]]:
    try:
        rows = await _get_pool().fetch(
            f"""
            SELECT u.id::text AS user_id,
                   u.username,
                   COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
                   COALESCE(s.views, 0)::int AS views,
                   COALESCE(s.clicks, 0)::int AS clicks
            FROM users u
            LEFT JOIN profile_stats s ON s.user_id = u.id
            WHERE {_LIVE_PROFILE}
            ORDER BY u.updated_at DESC, u.created_at DESC, u.username ASC
            LIMIT $1
            """,
            max(1, min(limit, 50)),
        )
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        return []
    return [dict(row) for row in rows]


async def leaderboard_score(user_id: str, metric: str, start: Any) -> dict[str, Any] | None:
    owner = UUID(user_id)
    wanted = "views" if metric == "views" else "clicks"
    try:
        if start is None:
            row = await _get_pool().fetchrow(
                f"""
                SELECT u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
                       COALESCE(s.views, 0)::int AS views,
                       COALESCE(s.clicks, 0)::int AS clicks
                FROM users u
                LEFT JOIN profile_stats s ON s.user_id = u.id
                WHERE u.id = $1 AND {_LIVE_PROFILE}
                """,
                owner,
            )
            if row is None:
                return None
            score = int(row[wanted] or 0)
            ahead = await _get_pool().fetchval(
                f"""
                SELECT COUNT(*) FROM profile_stats s
                JOIN users u ON u.id = s.user_id
                WHERE {_LIVE_PROFILE} AND s.{wanted} > $1
                """,
                score,
            )
        else:
            kind = "view" if wanted == "views" else "click"
            row = await _get_pool().fetchrow(
                f"""
                SELECT u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
                       COUNT(*) FILTER (WHERE e.kind = 'view')::int AS views,
                       COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks
                FROM users u
                LEFT JOIN profile_events e ON e.user_id = u.id AND e.occurred_at >= $2
                WHERE u.id = $1 AND {_LIVE_PROFILE}
                GROUP BY u.username, u.display_name
                """,
                owner,
                start,
            )
            if row is None:
                return None
            score = int(row[wanted] or 0)
            ahead = await _get_pool().fetchval(
                f"""
                SELECT COUNT(*) FROM (
                    SELECT e.user_id
                    FROM profile_events e
                    JOIN users u ON u.id = e.user_id
                    WHERE e.occurred_at >= $2 AND e.kind = $3 AND {_LIVE_PROFILE}
                    GROUP BY e.user_id
                    HAVING COUNT(*) > $1
                ) ranked
                """,
                score,
                start,
                kind,
            )
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        return None
    return {
        "username": str(row["username"]),
        "displayName": str(row["display_name"] or row["username"]),
        "views": int(row["views"] or 0),
        "clicks": int(row["clicks"] or 0),
        "rank": int(ahead or 0) + 1 if score > 0 else None,
    }


async def get_discord_link(user_id: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        """
        SELECT user_id, discord_id, refresh_token, access_token, access_expires_at,
               show_avatar, show_decoration, show_guild_tag
        FROM discord_links WHERE user_id = $1
        """,
        UUID(user_id),
    )
    return dict(row) if row else None


async def save_discord_link(
    user_id: str,
    *,
    discord_id: str,
    refresh_token: str,
    access_token: str | None,
    access_expires_at: Any,
    show_avatar: bool,
    show_decoration: bool,
    show_guild_tag: bool,
    show_status: bool = True,
) -> dict[str, Any]:
    row = await _get_pool().fetchrow(
        """
        INSERT INTO discord_links (
            user_id, discord_id, refresh_token, access_token, access_expires_at,
            show_avatar, show_decoration, show_guild_tag, show_status, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            discord_id = EXCLUDED.discord_id,
            refresh_token = EXCLUDED.refresh_token,
            access_token = EXCLUDED.access_token,
            access_expires_at = EXCLUDED.access_expires_at,
            show_avatar = EXCLUDED.show_avatar,
            show_decoration = EXCLUDED.show_decoration,
            show_guild_tag = EXCLUDED.show_guild_tag,
            show_status = EXCLUDED.show_status,
            updated_at = NOW()
        RETURNING user_id, discord_id, refresh_token, access_token, access_expires_at,
                  show_avatar, show_decoration, show_guild_tag, show_status
        """,
        UUID(user_id),
        discord_id,
        refresh_token,
        access_token,
        access_expires_at,
        show_avatar,
        show_decoration,
        show_guild_tag,
        show_status,
    )
    return dict(row) if row else {}


async def update_discord_prefs(user_id: str, **prefs: bool) -> dict[str, Any] | None:
    current = await get_discord_link(user_id)
    if current is None:
        return None
    row = await _get_pool().fetchrow(
        """
        UPDATE discord_links
        SET show_avatar = $2, show_decoration = $3, show_guild_tag = $4, updated_at = NOW()
        WHERE user_id = $1
        RETURNING user_id, discord_id, refresh_token, access_token, access_expires_at,
                  show_avatar, show_decoration, show_guild_tag, show_status
        """,
        UUID(user_id),
        prefs.get("show_avatar", bool(current["show_avatar"])),
        prefs.get("show_decoration", bool(current["show_decoration"])),
        prefs.get("show_guild_tag", bool(current["show_guild_tag"])),
    )
    return dict(row) if row else None


async def delete_discord_link(user_id: str) -> None:
    await _get_pool().execute("DELETE FROM discord_links WHERE user_id = $1", UUID(user_id))


async def clear_user_discord_id(user_id: str) -> None:
    await _get_pool().execute("UPDATE users SET discord_id = NULL, updated_at = NOW() WHERE id = $1", UUID(user_id))


async def clear_user_provider(user_id: str, provider: str) -> None:
    columns = {"google": "google_id", "telegram": "telegram_id"}
    column = columns.get(provider)
    if column is None:
        raise ValueError("unsupported provider")
    extra = ", telegram_username = NULL" if provider == "telegram" else ""
    await _get_pool().execute(
        f"UPDATE users SET {column} = NULL{extra}, updated_at = NOW() WHERE id = $1",
        UUID(user_id),
    )


async def get_user_discord_id(user_id: str) -> str | None:
    row = await _get_pool().fetchrow("SELECT discord_id FROM users WHERE id = $1", UUID(user_id))
    value = str((row or {}).get("discord_id") or "").strip() if row else ""
    return value or None


async def get_share_card_bits(username: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        """
        SELECT
            u.username,
            u.display_name,
            COALESCE(pr.config->'_premium_base', pr.config->'config'->'_premium_base') AS premium_base,
            EXISTS(SELECT 1 FROM premium_entitlements pe WHERE pe.user_id=u.id AND pe.active=TRUE AND (pe.expires_at IS NULL OR pe.expires_at>NOW())) AS premium_active,
            COALESCE(
                pr.config->'settings',
                pr.config->'config'->'settings',
                '{}'::jsonb
            ) AS settings,
            COALESCE(
                pr.config->'profile',
                pr.config->'config'->'profile',
                '{}'::jsonb
            ) AS identity,
            COALESCE(
                pr.config->'assets'->'ogImage'->>'url',
                pr.config->'config'->'assets'->'ogImage'->>'url'
            ) AS og_image,
            COALESCE(
                pr.config->'assets'->'favicon'->>'url',
                pr.config->'config'->'assets'->'favicon'->>'url'
            ) AS favicon,
            COALESCE(
                pr.config->'assets'->'avatar'->>'url',
                pr.config->'config'->'assets'->'avatar'->>'url'
            ) AS avatar,
            COALESCE(
                pr.config->'assets'->'background'->>'url',
                pr.config->'config'->'assets'->'background'->>'url'
            ) AS background,
            EXTRACT(EPOCH FROM COALESCE(pr.updated_at, u.updated_at))::bigint AS version
        FROM users u
        LEFT JOIN profiles pr ON pr.user_id = u.id AND pr.disabled_at IS NULL
        WHERE lower(u.username) = $1
        """,
        username.lower(),
    )
    if row is None:
        return None
    settings = row["settings"] if isinstance(row["settings"], dict) else {}
    identity = row["identity"] if isinstance(row["identity"], dict) else {}
    if not str(identity.get("displayName") or "").strip():
        identity = dict(identity)
        identity["displayName"] = str(row.get("display_name") or row.get("username") or username)
    from app.core.premium import public_projection
    projection = public_projection({"settings": settings, "_premium_base": row["premium_base"], "assets": {"ogImage": {"url": row["og_image"]}, "favicon": {"url": row["favicon"]}}}, bool(row["premium_active"]))
    settings = projection["settings"]
    return {
        "username": str(row["username"] or username),
        "settings": settings,
        "identity": identity,
        "og_image": (projection["assets"].get("ogImage") or {}).get("url"),
        "favicon": (projection["assets"].get("favicon") or {}).get("url"),
        "avatar": str(row["avatar"] or "").strip() or None,
        "background": str(row["background"] or "").strip() or None,
        "version": int(row["version"] or 0),
    }


async def get_public_asset_url(username: str, kind: str) -> str | None:
    row = await _get_pool().fetchrow(
        """
        SELECT CASE WHEN $2 = ANY(ARRAY['customFont','clickSound','entryIcon','ogImage','favicon'])
            AND COALESCE(config->'_premium_base',config->'config'->'_premium_base') IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM premium_entitlements pe WHERE pe.user_id=u.id AND pe.active=TRUE AND (pe.expires_at IS NULL OR pe.expires_at>NOW()))
            THEN COALESCE(config->'_premium_base'->'assets'->$2->>'url',config->'config'->'_premium_base'->'assets'->$2->>'url')
            ELSE COALESCE(config->'assets'->$2->>'url',config->'config'->'assets'->$2->>'url') END AS url
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        WHERE lower(u.username) = $1 AND p.disabled_at IS NULL
        """,
        username.lower(),
        kind,
    )
    url = str((row or {}).get("url") or "").strip() if row else ""
    return url or None


async def get_public_track_asset_url(username: str, track_id: str, kind: str) -> str | None:
    row = await _get_pool().fetchrow(
        """
        SELECT item->$3->>'url' AS url
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(
                config->'assets'->'tracks',
                config->'config'->'assets'->'tracks',
                '[]'::jsonb
            )
        ) AS item
        WHERE lower(u.username) = $1 AND p.disabled_at IS NULL AND item->>'id' = $2
        LIMIT 1
        """,
        username.lower(),
        track_id,
        kind,
    )
    url = str((row or {}).get("url") or "").strip() if row else ""
    return url or None


async def get_profile(user_id: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        "SELECT config FROM profiles WHERE user_id = $1 AND disabled_at IS NULL",
        UUID(user_id),
    )
    if row is None:
        return None
    config = row["config"]
    if isinstance(config, str):
        config = json.loads(config)
    return config if isinstance(config, dict) else None


async def save_profile(user_id: str, config: dict[str, Any]) -> dict[str, Any]:
    await _get_pool().execute(
        """
        INSERT INTO profiles (user_id, config, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET config = EXCLUDED.config, updated_at = NOW(), disabled_at = NULL, disabled_reason = NULL
        """,
        UUID(user_id),
        json.dumps(config),
    )
    return config


async def list_profiles_for_media_migration(
    after_user_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Read profile JSON in stable batches for the one-time media migration.

    This intentionally includes disabled profiles: migrating their embedded media
    changes no account or publication state and avoids leaving oversized JSONB
    documents behind.
    """
    batch_size = max(1, min(int(limit), 500))
    if after_user_id:
        rows = await _get_pool().fetch(
            """
            SELECT user_id::text AS user_id, config
            FROM profiles
            WHERE user_id > $1
            ORDER BY user_id
            LIMIT $2
            """,
            UUID(after_user_id),
            batch_size,
        )
    else:
        rows = await _get_pool().fetch(
            """
            SELECT user_id::text AS user_id, config
            FROM profiles
            ORDER BY user_id
            LIMIT $1
            """,
            batch_size,
        )
    profiles: list[dict[str, Any]] = []
    for row in rows:
        config = row["config"]
        if isinstance(config, str):
            config = json.loads(config)
        profiles.append({"user_id": row["user_id"], "config": config})
    return profiles


async def replace_profile_config_for_media_migration(
    user_id: str,
    expected_config: dict[str, Any],
    updated_config: dict[str, Any],
) -> bool:
    """Replace only an unchanged profile document and never insert or delete rows."""
    result = await _get_pool().execute(
        """
        UPDATE profiles
        SET config = $3::jsonb, updated_at = NOW()
        WHERE user_id = $1 AND config = $2::jsonb
        """,
        UUID(user_id),
        json.dumps(expected_config),
        json.dumps(updated_config),
    )
    return result == "UPDATE 1"


async def _audit(conn: asyncpg.Connection, actor_id: UUID, action: str, target_type: str | None, target_id: str | None, metadata: dict[str, Any] | None = None) -> None:
    await conn.execute(
        "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",
        actor_id, action, target_type, target_id, json.dumps(metadata or {}),
    )


async def search_users(search: str = "", limit: int = 50, offset: int = 0, allow_ids: set[str] | None = None) -> list[dict[str, Any]]:
    term = f"%{search.strip()}%"
    bounds = (term, max(1, min(limit, 100)), max(0, offset))
    try:
        rows = await _get_pool().fetch(
            """SELECT id, email, email_verified, username, display_name, avatar_url,
                      google_id, discord_id, telegram_id, telegram_username, apple_id,
                      created_at, updated_at, last_login_at, is_admin,
                      suspended_at, suspension_reason, suspended_until,
                      EXISTS (
                        SELECT 1 FROM user_roles r
                        WHERE r.user_id = users.id AND r.role = 'template_creator'
                      ) AS is_template_creator,
                      EXISTS (
                        SELECT 1 FROM user_roles r
                        WHERE r.user_id = users.id AND r.role = 'owner'
                      ) AS is_owner,
                      EXISTS (
                        SELECT 1 FROM user_roles r
                        WHERE r.user_id = users.id AND r.role = 'admin'
                      ) AS is_staff_admin,
                      EXISTS (
                        SELECT 1 FROM user_roles r
                        WHERE r.user_id = users.id AND r.role = 'moderator'
                      ) AS is_moderator
               FROM users
               WHERE $1 = '%' OR id::text ILIKE $1 OR COALESCE(username, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
            *bounds,
        )
    except asyncpg.UndefinedTableError:
        rows = await _get_pool().fetch(
            """SELECT id, email, email_verified, username, display_name, avatar_url,
                      google_id, discord_id, telegram_id, telegram_username, apple_id,
                      created_at, updated_at, last_login_at, is_admin,
                      suspended_at, suspension_reason, suspended_until
               FROM users
               WHERE $1 = '%' OR id::text ILIKE $1 OR COALESCE(username, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
            *bounds,
        )
        return [_with_staff_role({**dict(row), "is_template_creator": False, "is_owner": False, "is_staff_admin": False, "is_moderator": False}, allow_ids) for row in rows]
    return [_with_staff_role(dict(row), allow_ids) for row in rows]


async def set_suspension(actor_id: UUID, user_id: UUID, suspended: bool, reason: str | None, until: Any) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "UPDATE users SET suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END, suspension_reason = CASE WHEN $2 THEN $3 ELSE NULL END, suspended_until = CASE WHEN $2 THEN $4 ELSE NULL END, updated_at = NOW() WHERE id = $1",
                user_id, suspended, reason, until,
            )
            if result != "UPDATE 1":
                return False
            await _audit(conn, actor_id, "user.suspend" if suspended else "user.unsuspend", "user", str(user_id), {"reason": reason, "until": str(until) if until else None})
    return True


async def list_reserved() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT username, reason, created_by, created_at FROM reserved_usernames ORDER BY username")]


async def is_reserved(username: str) -> bool:
    handle = username.lower()
    row = await _get_pool().fetchrow("SELECT 1 FROM reserved_usernames WHERE username = $1", handle)
    if row is not None:
        return True
    return await has_username_history(handle)


async def add_reserved(actor_id: UUID, username: str, reason: str | None) -> None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO reserved_usernames (username, reason, created_by) VALUES ($1,$2,$3)", username.lower(), reason, actor_id)
            await _audit(conn, actor_id, "reserved_username.create", "reserved_username", username.lower(), {"reason": reason})


async def remove_reserved(actor_id: UUID, username: str) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute("DELETE FROM reserved_usernames WHERE username = $1", username.lower())
            if result != "DELETE 1":
                return False
            await _audit(conn, actor_id, "reserved_username.delete", "reserved_username", username.lower())
    return True


async def ensure_banned_username_words() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS banned_username_words (
                word VARCHAR(24) PRIMARY KEY,
                reason TEXT,
                created_by UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    except (asyncpg.PostgresError, OSError):
        return


async def list_banned_words() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT word, reason, created_by, created_at FROM banned_username_words ORDER BY word")]


async def username_is_banned(username: str) -> bool:
    if _pool is None:
        return False
    try:
        rows = await _get_pool().fetch("SELECT word FROM banned_username_words")
    except (asyncpg.PostgresError, OSError, asyncpg.UndefinedTableError):
        return False
    return username_hits_banned_word(username, [row["word"] for row in rows])


async def add_banned_word(actor_id: UUID, word: str, reason: str | None) -> None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO banned_username_words (word, reason, created_by) VALUES ($1,$2,$3)",
                word,
                reason,
                actor_id,
            )
            await _audit(conn, actor_id, "banned_word.create", "banned_word", word, {"reason": reason})


async def remove_banned_word(actor_id: UUID, word: str) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute("DELETE FROM banned_username_words WHERE word = $1", word.lower())
            if result != "DELETE 1":
                return False
            await _audit(conn, actor_id, "banned_word.delete", "banned_word", word.lower())
    return True


async def ensure_user_bans() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(45)")
        await _pool.execute("CREATE INDEX IF NOT EXISTS users_signup_ip_idx ON users (signup_ip)")
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS banned_accounts (
                user_id UUID PRIMARY KEY,
                username TEXT,
                reason TEXT,
                created_by UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS banned_ips (
                ip VARCHAR(45) PRIMARY KEY,
                reason TEXT,
                created_by UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    except (asyncpg.PostgresError, OSError):
        return


def _clean_ban_reason(reason: str | None) -> str | None:
    value = " ".join((reason or "").split())
    return value[:500] or None


async def remember_signup_ip(user_id: str, ip: str) -> str | None:
    if _pool is None:
        return None
    try:
        cleaned = normalize_ip(ip)
    except ValueError:
        return None
    try:
        await _get_pool().execute(
            "UPDATE users SET signup_ip = $2 WHERE id = $1 AND (signup_ip IS NULL OR signup_ip = '')",
            UUID(user_id),
            cleaned,
        )
        stored = await _get_pool().fetchval("SELECT signup_ip FROM users WHERE id = $1", UUID(user_id))
    except (asyncpg.PostgresError, OSError, ValueError):
        return None
    return str(stored) if stored else None


async def request_ip_is_banned(ip: str) -> bool:
    if _pool is None:
        return False
    try:
        cleaned = normalize_ip(ip)
    except ValueError:
        return False
    try:
        row = await _get_pool().fetchrow("SELECT 1 FROM banned_ips WHERE ip = $1", cleaned)
    except (asyncpg.PostgresError, OSError, asyncpg.UndefinedTableError):
        return False
    return row is not None


async def user_is_banned(user_id: str) -> bool:
    if _pool is None:
        return False
    try:
        row = await _get_pool().fetchrow(
            """
            SELECT u.is_admin,
                   EXISTS (SELECT 1 FROM banned_accounts b WHERE b.user_id = u.id) AS account_banned,
                   EXISTS (
                       SELECT 1 FROM banned_ips i
                       WHERE u.signup_ip IS NOT NULL AND i.ip = u.signup_ip
                   ) AS ip_banned
            FROM users u
            WHERE u.id = $1
            """,
            UUID(user_id),
        )
    except (asyncpg.PostgresError, OSError, asyncpg.UndefinedTableError, ValueError):
        return False
    if row is None:
        return False
    try:
        from app.core.config import get_settings
        allow = get_settings().admin_user_id_list
    except Exception:
        allow = set()
    if row["is_admin"] or user_id in allow:
        return False
    return bool(row["account_banned"] or row["ip_banned"])


async def list_account_bans() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT b.user_id, COALESCE(u.username, b.username) AS username, u.signup_ip,
               b.reason, b.created_by, b.created_at
        FROM banned_accounts b
        LEFT JOIN users u ON u.id = b.user_id
        ORDER BY b.created_at DESC
        """
    )
    return [dict(row) for row in rows]


async def list_ip_bans() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT i.ip, i.reason, i.created_by, i.created_at,
               COALESCE(array_agg(u.username ORDER BY u.username) FILTER (WHERE u.id IS NOT NULL), '{}') AS usernames
        FROM banned_ips i
        LEFT JOIN users u ON u.signup_ip = i.ip
        GROUP BY i.ip, i.reason, i.created_by, i.created_at
        ORDER BY i.created_at DESC
        """
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["usernames"] = [name for name in (item.get("usernames") or []) if name]
        items.append(item)
    return items


async def _suspend_user(conn: asyncpg.Connection, user_id: UUID, reason: str | None) -> None:
    await conn.execute(
        """
        UPDATE users
        SET suspended_at = NOW(),
            suspension_reason = $2,
            suspended_until = NULL,
            updated_at = NOW()
        WHERE id = $1
        """,
        user_id,
        reason,
    )


async def _unsuspend_if_clear(conn: asyncpg.Connection, user_id: UUID) -> None:
    still = await conn.fetchval(
        """
        SELECT EXISTS (SELECT 1 FROM banned_accounts WHERE user_id = $1)
            OR EXISTS (
                SELECT 1 FROM users u
                JOIN banned_ips i ON i.ip = u.signup_ip
                WHERE u.id = $1
            )
        """,
        user_id,
    )
    if still:
        return
    await conn.execute(
        """
        UPDATE users
        SET suspended_at = NULL, suspension_reason = NULL, suspended_until = NULL, updated_at = NOW()
        WHERE id = $1
        """,
        user_id,
    )


async def ban_account(actor_id: UUID, user_id: str, reason: str | None) -> dict[str, Any]:
    note = _clean_ban_reason(reason)
    owner = UUID(user_id)
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, username, is_admin, signup_ip FROM users WHERE id = $1",
                owner,
            )
            if row is None:
                raise LookupError("user")
            if row["is_admin"]:
                raise PermissionError("admin")
            try:
                await conn.execute(
                    "INSERT INTO banned_accounts (user_id, username, reason, created_by) VALUES ($1,$2,$3,$4)",
                    row["id"],
                    row["username"],
                    note,
                    actor_id,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ValueError("exists") from exc
            await _suspend_user(conn, row["id"], note or "Account banned")
            await _audit(conn, actor_id, "account.ban", "user", str(row["id"]), {"username": row["username"], "reason": note})
            return {
                "user_id": row["id"],
                "username": row["username"],
                "signup_ip": row["signup_ip"],
            }


async def unban_account(actor_id: UUID, username: str) -> UUID | None:
    handle = username.strip().lstrip("@").lower()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT b.user_id
                FROM banned_accounts b
                LEFT JOIN users u ON u.id = b.user_id
                WHERE lower(COALESCE(u.username, b.username, '')) = $1
                """,
                handle,
            )
            if row is None:
                try:
                    row = await conn.fetchrow("SELECT user_id FROM banned_accounts WHERE user_id = $1", UUID(handle))
                except ValueError:
                    row = None
            if row is None:
                return None
            await conn.execute("DELETE FROM banned_accounts WHERE user_id = $1", row["user_id"])
            await _unsuspend_if_clear(conn, row["user_id"])
            await _audit(conn, actor_id, "account.unban", "user", str(row["user_id"]), {"username": handle})
            return row["user_id"]


async def ban_ip(actor_id: UUID, ip: str, reason: str | None) -> dict[str, Any]:
    cleaned = normalize_ip(ip)
    note = _clean_ban_reason(reason)
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            try:
                await conn.execute(
                    "INSERT INTO banned_ips (ip, reason, created_by) VALUES ($1,$2,$3)",
                    cleaned,
                    note,
                    actor_id,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ValueError("exists") from exc
            users = await conn.fetch(
                "SELECT id, username, is_admin FROM users WHERE signup_ip = $1",
                cleaned,
            )
            affected: list[str] = []
            for user in users:
                if user["is_admin"]:
                    continue
                await _suspend_user(conn, user["id"], note or "IP banned")
                if user["username"]:
                    affected.append(str(user["username"]))
            await _audit(conn, actor_id, "ip.ban", "ip", cleaned, {"reason": note, "accounts": affected})
            return {"ip": cleaned, "usernames": affected, "user_ids": [row["id"] for row in users if not row["is_admin"]]}


async def unban_ip(actor_id: UUID, ip: str) -> list[UUID] | None:
    cleaned = normalize_ip(ip)
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            deleted = await conn.execute("DELETE FROM banned_ips WHERE ip = $1", cleaned)
            if deleted != "DELETE 1":
                return None
            users = await conn.fetch("SELECT id FROM users WHERE signup_ip = $1", cleaned)
            for user in users:
                await _unsuspend_if_clear(conn, user["id"])
            await _audit(conn, actor_id, "ip.unban", "ip", cleaned, {"accounts": len(users)})
            return [row["id"] for row in users]


async def ensure_badge_icons() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute("ALTER TABLE badges ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT ''")
    except (asyncpg.PostgresError, OSError):
        return


async def list_user_badge_grants(user_id: str) -> list[dict[str, Any]]:
    from app.db import achievements
    try:
        return await achievements.list_user_badge_grants(user_id)
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        return []

async def list_badges() -> list[dict[str, Any]]:
    query = "SELECT id, name, description, color, created_at, (COALESCE(icon, '') <> '') AS has_icon FROM badges ORDER BY name"
    try:
        rows = await _get_pool().fetch(query)
    except asyncpg.UndefinedColumnError:
        await ensure_badge_icons()
        rows = await _get_pool().fetch(query)
    return [dict(row) for row in rows]


async def get_badge_icon(badge_id: str) -> str:
    try:
        value = await _get_pool().fetchval("SELECT icon FROM badges WHERE id = $1", badge_id)
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        return ""
    return str(value or "")


async def add_badge(actor_id: UUID, badge_id: str, name: str, description: str, color: str, icon: str = "") -> None:
    await ensure_badge_icons()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO badges (id, name, description, color, icon) VALUES ($1,$2,$3,$4,$5)",
                badge_id, name, description, color, icon,
            )
            await _audit(conn, actor_id, "badge.create", "badge", badge_id, {"name": name})


async def revoke_badge(actor_id: UUID, user_id: UUID, badge_id: str) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute("DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2", user_id, badge_id)
            if result != "DELETE 1":
                return False
            await _audit(conn, actor_id, "badge.revoke", "user", str(user_id), {"badge_id": badge_id})
    return True


async def delete_custom_badge(actor_id: UUID, badge_id: str) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM user_badges WHERE badge_id = $1", badge_id)
            result = await conn.execute("DELETE FROM badges WHERE id = $1", badge_id)
            if result != "DELETE 1":
                return False
            await _audit(conn, actor_id, "badge.delete", "badge", badge_id)
    return True


def _with_staff_role(item: dict[str, Any], allow_ids: set[str] | None = None) -> dict[str, Any]:
    user_id = str(item.get("id") or "")
    if item.get("is_admin") or item.get("is_owner") or user_id in (allow_ids or ()):
        item["staff_role"] = "owner"
    elif item.get("is_staff_admin"):
        item["staff_role"] = "admin"
    elif item.get("is_moderator"):
        item["staff_role"] = "moderator"
    else:
        item["staff_role"] = None
    return item


async def is_admin_user(user_id: str, flagged: bool = False, allow_ids: set[str] | None = None) -> bool:
    if flagged or user_id in (allow_ids or ()):
        return True
    if _pool is None:
        return False
    try:
        value = await _get_pool().fetchval("SELECT is_admin FROM users WHERE id = $1", UUID(user_id))
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError, asyncpg.PostgresError):
        return False
    return bool(value)


async def staff_role(user_id: str, flagged: bool = False, allow_ids: set[str] | None = None) -> str | None:
    if await is_admin_user(user_id, flagged, allow_ids):
        return "owner"
    if _pool is None:
        return None
    try:
        row = await _get_pool().fetchrow(
            """
            SELECT
              EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'owner') AS staff_owner,
              EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin') AS staff_admin,
              EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'moderator') AS staff_mod
            """,
            UUID(user_id),
        )
    except (asyncpg.UndefinedTableError, asyncpg.PostgresError, ValueError):
        return None
    if row and row["staff_owner"]:
        return "owner"
    if row and row["staff_admin"]:
        return "admin"
    if row and row["staff_mod"]:
        return "moderator"
    return None


async def ensure_staff_access() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_section_access (
                role TEXT NOT NULL,
                section TEXT NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                PRIMARY KEY (role, section)
            )
            """
        )
        await _pool.execute(
            """
            INSERT INTO staff_section_access (role, section, enabled)
            SELECT role, section, TRUE
            FROM unnest($1::text[]) AS role
            CROSS JOIN unnest($2::text[]) AS section
            ON CONFLICT (role, section) DO NOTHING
            """,
            list(STAFF_ROLES),
            list(STAFF_SECTIONS),
        )
    except (asyncpg.PostgresError, OSError):
        return


async def list_section_access() -> dict[str, dict[str, bool]]:
    access = {role: {section: True for section in STAFF_SECTIONS} for role in STAFF_ROLES}
    try:
        rows = await _get_pool().fetch("SELECT role, section, enabled FROM staff_section_access")
    except (asyncpg.PostgresError, OSError, asyncpg.UndefinedTableError):
        return access
    for row in rows:
        if row["role"] in access and row["section"] in access[row["role"]]:
            access[row["role"]][row["section"]] = bool(row["enabled"])
    return access


async def section_enabled(role: str, section: str) -> bool:
    if role == "owner":
        return True
    if role not in STAFF_ROLES or section not in STAFF_SECTIONS:
        return False
    try:
        value = await _get_pool().fetchval(
            "SELECT enabled FROM staff_section_access WHERE role = $1 AND section = $2",
            role,
            section,
        )
    except (asyncpg.PostgresError, OSError, RuntimeError, asyncpg.UndefinedTableError):
        return False
    return True if value is None else bool(value)


async def set_section_access(actor_id: UUID, role: str, sections: dict[str, bool]) -> dict[str, bool]:
    if role not in STAFF_ROLES:
        raise ValueError("role")
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            for section in STAFF_SECTIONS:
                if section not in sections:
                    continue
                enabled = bool(sections[section])
                await conn.execute(
                    """
                    INSERT INTO staff_section_access (role, section, enabled)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (role, section) DO UPDATE SET enabled = EXCLUDED.enabled
                    """,
                    role,
                    section,
                    enabled,
                )
            await _audit(conn, actor_id, "staff_access.update", "role", role, {"sections": sections})
    access = await list_section_access()
    return access[role]


async def allowed_sections(role: str | None) -> list[str]:
    if role == "owner":
        return list(STAFF_SECTIONS)
    if role not in STAFF_ROLES:
        return []
    access = await list_section_access()
    return [section for section in STAFF_SECTIONS if access.get(role, {}).get(section, True)]


async def list_staff() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT u.id, u.username, u.email,
               CASE
                 WHEN r.role = 'admin' THEN 'admin'
                 ELSE 'moderator'
               END AS staff_role
        FROM user_roles r
        JOIN users u ON u.id = r.user_id
        WHERE r.role IN ('admin', 'moderator')
        ORDER BY r.role, COALESCE(u.username, u.email, u.id::text)
        """
    )
    return [dict(row) for row in rows]


async def set_staff_role(actor_id: UUID, user_id: UUID, role: str, granted: bool) -> bool:
    if role not in STAFF_ROLES:
        raise ValueError("role")
    other = "moderator" if role == "admin" else "admin"
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            exists = await conn.fetchrow("SELECT 1 FROM users WHERE id = $1", user_id)
            if exists is None:
                return False
            if granted:
                await conn.execute("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", user_id, other)
                await conn.execute(
                    """
                    INSERT INTO user_roles (user_id, role, granted_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, role) DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = NOW()
                    """,
                    user_id,
                    role,
                    actor_id,
                )
                await _audit(conn, actor_id, "role.grant", "user", str(user_id), {"role": role})
            else:
                await conn.execute("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", user_id, role)
                await _audit(conn, actor_id, "role.revoke", "user", str(user_id), {"role": role})
    return True


async def user_has_badge(user_id: str, badge_id: str) -> bool:
    try:
        value = await _get_pool().fetchval(
            "SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = $2 AND enabled = TRUE",
            UUID(user_id),
            badge_id,
        )
    except (asyncpg.UndefinedTableError, asyncpg.PostgresError):
        return False
    return bool(value)


async def ensure_verification_requests() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_requests (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                proof_url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                review_note TEXT NOT NULL DEFAULT '',
                reviewed_by UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                reviewed_at TIMESTAMPTZ
            )
            """
        )
        await _pool.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS verification_requests_pending_user ON verification_requests (user_id) WHERE status = 'pending'"
        )
    except (asyncpg.PostgresError, OSError):
        return


async def get_verification_for_user(user_id: str) -> dict[str, Any] | None:
    try:
        row = await _get_pool().fetchrow(
            """
            SELECT id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
            FROM verification_requests
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            UUID(user_id),
        )
    except asyncpg.UndefinedTableError:
        return None
    return dict(row) if row else None


async def create_verification_request(user_id: str, reason: str, proof_url: str) -> dict[str, Any]:
    request_id = uuid4()
    values = (request_id, UUID(user_id), reason, proof_url)
    query = """
        INSERT INTO verification_requests (id, user_id, reason, proof_url, status)
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
    """
    try:
        row = await _get_pool().fetchrow(query, *values)
    except asyncpg.UndefinedTableError:
        await ensure_verification_requests()
        row = await _get_pool().fetchrow(query, *values)
    return dict(row)


async def list_verification_requests(status: str | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT v.id, v.user_id, v.reason, v.proof_url, v.status, v.review_note, v.created_at, v.reviewed_at,
               u.username, u.display_name
        FROM verification_requests v
        JOIN users u ON u.id = v.user_id
    """
    values: list[Any] = []
    if status:
        query += " WHERE v.status = $1"
        values.append(status)
    query += " ORDER BY v.created_at DESC LIMIT 100"
    try:
        rows = await _get_pool().fetch(query, *values)
    except asyncpg.UndefinedTableError:
        return []
    return [dict(row) for row in rows]


async def review_verification_request(actor_id: UUID, request_id: UUID, status: str, note: str) -> dict[str, Any] | None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE verification_requests
                SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
                WHERE id = $1 AND status = 'pending'
                RETURNING id, user_id, reason, proof_url, status, review_note, created_at, reviewed_at
                """,
                request_id,
                status,
                note,
                actor_id,
            )
            if row is None:
                return None
            await _audit(conn, actor_id, f"verification.{status}", "user", str(row["user_id"]), {"request_id": str(request_id)})
    return dict(row)


async def assign_badge(actor_id: UUID, user_id: UUID, badge_id: str, enabled: bool) -> None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO user_badges (user_id, badge_id, enabled, granted_by) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,badge_id) DO UPDATE SET enabled = EXCLUDED.enabled", user_id, badge_id, enabled, actor_id)
            await _audit(conn, actor_id, "badge.assign", "user", str(user_id), {"badge_id": badge_id, "enabled": enabled})


def _rank_slug(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in (name or "").strip().lower())
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned.strip("_")[:64]


async def ensure_premium_ranks() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute(
            """
            CREATE TABLE IF NOT EXISTS premium_ranks (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL,
                slug VARCHAR(64) NOT NULL UNIQUE,
                created_by UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        existing = await _pool.fetchval("SELECT COUNT(*) FROM premium_ranks")
        if int(existing or 0) > 0:
            return
        plans = await _pool.fetch(
            "SELECT DISTINCT plan FROM premium_entitlements WHERE plan IS NOT NULL AND length(plan) > 0"
        )
        for item in plans:
            slug = _rank_slug(str(item["plan"]))
            if not slug:
                continue
            await _pool.execute(
                "INSERT INTO premium_ranks (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING",
                uuid4(),
                str(item["plan"]),
                slug,
            )
    except (asyncpg.PostgresError, OSError):
        return


async def list_premium_ranks() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        """
        SELECT r.id, r.name, r.slug, r.created_at,
               COALESCE((
                   SELECT count(*) FROM premium_entitlements e
                   WHERE lower(e.plan) = r.slug AND e.active = TRUE
               ), 0) AS holders
        FROM premium_ranks r
        ORDER BY r.name
        """
    )
    return [dict(row) for row in rows]


async def get_premium_rank(rank_id: UUID) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        "SELECT id, name, slug, created_at FROM premium_ranks WHERE id = $1",
        rank_id,
    )
    if row is None:
        return None
    holders = await _get_pool().fetch(
        """
        SELECT e.id, e.user_id, u.username, e.created_at
        FROM premium_entitlements e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE lower(e.plan) = $1 AND e.active = TRUE
        ORDER BY COALESCE(u.username, e.user_id::text)
        """,
        row["slug"],
    )
    return {**dict(row), "holders": [dict(item) for item in holders]}


async def add_premium_rank(actor_id: UUID, name: str) -> dict[str, Any]:
    label = " ".join((name or "").split())
    slug = _rank_slug(label)
    if len(label) < 2 or not slug:
        raise ValueError("name")
    rank_id = uuid4()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            try:
                await conn.execute(
                    "INSERT INTO premium_ranks (id, name, slug, created_by) VALUES ($1,$2,$3,$4)",
                    rank_id,
                    label,
                    slug,
                    actor_id,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ValueError("exists") from exc
            await _audit(conn, actor_id, "premium.rank.create", "premium_rank", str(rank_id), {"name": label, "slug": slug})
    return {"id": rank_id, "name": label, "slug": slug}


async def has_active_premium(user_id: str) -> bool:
    return bool(await _get_pool().fetchval(
        "SELECT EXISTS(SELECT 1 FROM premium_entitlements WHERE user_id = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW()))", UUID(str(user_id))
    ))


async def list_entitlements() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT id, user_id, plan, active, expires_at, granted_by, created_at FROM premium_entitlements ORDER BY created_at DESC")]


async def add_entitlement(actor_id: UUID, user_id: UUID, plan: str, active: bool, expires_at: Any) -> UUID:
    entitlement_id = uuid4()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO premium_entitlements (id, user_id, plan, active, expires_at, granted_by) VALUES ($1,$2,$3,$4,$5,$6)", entitlement_id, user_id, plan, active, expires_at, actor_id)
            await _audit(conn, actor_id, "premium.grant", "user", str(user_id), {"plan": plan, "expires_at": str(expires_at) if expires_at else None})
    return entitlement_id


async def grant_premium_rank(actor_id: UUID, rank_id: UUID, user_id: UUID) -> UUID:
    rank = await _get_pool().fetchrow("SELECT slug FROM premium_ranks WHERE id = $1", rank_id)
    if rank is None:
        raise LookupError("rank")
    existing = await _get_pool().fetchrow(
        "SELECT id FROM premium_entitlements WHERE user_id = $1 AND lower(plan) = $2 AND active = TRUE",
        user_id,
        rank["slug"],
    )
    if existing:
        raise ValueError("exists")
    return await add_entitlement(actor_id, user_id, rank["slug"], True, None)


async def revoke_premium_rank(actor_id: UUID, rank_id: UUID, user_id: UUID) -> bool:
    rank = await _get_pool().fetchrow("SELECT slug FROM premium_ranks WHERE id = $1", rank_id)
    if rank is None:
        raise LookupError("rank")
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "UPDATE premium_entitlements SET active = FALSE WHERE user_id = $1 AND lower(plan) = $2 AND active = TRUE",
                user_id,
                rank["slug"],
            )
            if result == "UPDATE 0":
                return False
            await _audit(conn, actor_id, "premium.revoke", "user", str(user_id), {"plan": rank["slug"]})
    return True


async def list_reports() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT id, reporter_user_id, target_user_id, target_username, reason, details, status, reviewed_by, reviewed_at, created_at FROM reports ORDER BY created_at DESC LIMIT 200")]


async def update_report(actor_id: UUID, report_id: UUID, status: str) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute("UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $1", report_id, status, actor_id)
            if result != "UPDATE 1":
                return False
            await _audit(conn, actor_id, "report.update", "report", str(report_id), {"status": status})
    return True


async def ensure_feature_flags() -> None:
    if _pool is None:
        return
    try:
        await _pool.execute("""
            CREATE TABLE IF NOT EXISTS feature_flags (
                key VARCHAR(128) PRIMARY KEY,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                description TEXT NOT NULL DEFAULT '',
                updated_by UUID,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        for key, description in FEATURE_FLAG_CATALOG:
            await _pool.execute(
                "INSERT INTO feature_flags (key, enabled, description) VALUES ($1, TRUE, $2) ON CONFLICT (key) DO NOTHING",
                key,
                description,
            )
    except (asyncpg.PostgresError, OSError):
        return


async def public_flags() -> dict[str, bool]:
    defaults = {key: True for key, _ in FEATURE_FLAG_CATALOG}
    if _pool is None:
        return defaults
    try:
        rows = await _pool.fetch("SELECT key, enabled FROM feature_flags")
        for row in rows:
            defaults[str(row["key"])] = bool(row["enabled"])
    except (asyncpg.PostgresError, OSError):
        return defaults
    return defaults


async def list_flags() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key")]


async def update_flag(actor_id: UUID, key: str, enabled: bool, description: str) -> None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, description = EXCLUDED.description, updated_by = EXCLUDED.updated_by, updated_at = NOW()", key, enabled, description, actor_id)
            await _audit(conn, actor_id, "feature_flag.update", "feature_flag", key, {"enabled": enabled})


async def list_audit_logs() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 300")]


async def list_bakaboost_connections() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT user_id, provider, external_id, status, metadata, connected_at, updated_at FROM bakaboost_connections ORDER BY updated_at DESC")]


async def list_themes() -> list[dict[str, Any]]:
    return [dict(row) for row in await _get_pool().fetch("SELECT id, name, config, active, created_by, updated_by, created_at, updated_at FROM theme_presets ORDER BY name")]


async def save_theme(actor_id: UUID, name: str, config: dict[str, Any], active: bool) -> UUID:
    theme_id = uuid4()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO theme_presets (id, name, config, active, created_by, updated_by) VALUES ($1,$2,$3::jsonb,$4,$5,$5) ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = NOW()", theme_id, name, json.dumps(config), active, actor_id)
            await _audit(conn, actor_id, "theme_preset.save", "theme_preset", name, {"active": active})
    return theme_id


async def ensure_default_fonts() -> None:
    if _pool is None:
        return
    await _pool.execute(
        """
        CREATE TABLE IF NOT EXISTS default_profile_fonts (
            slot SMALLINT PRIMARY KEY CHECK (slot BETWEEN 2 AND 11),
            name TEXT NOT NULL,
            data_url TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            updated_by UUID,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    # Replace the original 2-6 constraint atomically so slots 7-11 are accepted.
    await _pool.execute(
        """
        ALTER TABLE default_profile_fonts
        DROP CONSTRAINT IF EXISTS default_profile_fonts_slot_check,
        ADD CONSTRAINT default_profile_fonts_slot_check CHECK (slot BETWEEN 2 AND 11)
        """
    )


async def list_default_fonts() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch(
        "SELECT slot, name, data_url, mime_type, updated_by, updated_at FROM default_profile_fonts ORDER BY slot"
    )
    return [
        {
            "id": f"font-{int(row['slot'])}",
            "slot": int(row["slot"]),
            "name": str(row["name"] or ""),
            "url": str(row["data_url"] or ""),
            "mimeType": str(row["mime_type"] or ""),
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


async def save_default_font(actor_id: UUID, slot: int, name: str, data_url: str, mime_type: str) -> None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO default_profile_fonts (slot, name, data_url, mime_type, updated_by, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (slot) DO UPDATE SET
                    name = EXCLUDED.name,
                    data_url = EXCLUDED.data_url,
                    mime_type = EXCLUDED.mime_type,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()
                """,
                slot,
                name,
                data_url,
                mime_type,
                actor_id,
            )
            await _audit(conn, actor_id, "default_font.save", "default_font", f"font-{slot}", {"name": name})


async def delete_default_font(actor_id: UUID, slot: int) -> bool:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            result = await conn.execute("DELETE FROM default_profile_fonts WHERE slot = $1", slot)
            if result != "DELETE 1":
                return False
            await _audit(conn, actor_id, "default_font.delete", "default_font", f"font-{slot}", {})
    return True


# Admin OTP/session storage is intentionally kept in the same database pool as
# the existing admin operations. This makes the OTP flow available to the
# active API router without introducing a second database or auth authority.
async def ensure_admin_auth_tables(root_email: str = "") -> None:
    if _pool is None:
        return
    await _pool.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_accounts (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT 'Misa administrator',
            role TEXT NOT NULL DEFAULT 'admin',
            permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'active',
            suspended BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS admin_otps (
            id UUID PRIMARY KEY,
            admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            id UUID PRIMARY KEY,
            admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            ip_address TEXT,
            user_agent TEXT,
            device_fingerprint TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS admin_invites (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'admin',
            permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
            expires_at TIMESTAMPTZ NOT NULL,
            created_by UUID,
            accepted_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS admin_otps_admin_created_idx ON admin_otps (admin_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS admin_sessions_token_idx ON admin_sessions (token_hash);
        CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions (admin_id);
        CREATE INDEX IF NOT EXISTS admin_invites_email_idx ON admin_invites (lower(email));
        """
    )
    # The VPS may already contain the earlier admin schema. Extend it in
    # place instead of replacing tables or deleting existing sessions/data.
    await _pool.execute("ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
    await _pool.execute("ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT")
    await _pool.execute("ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS device_fingerprint TEXT")
    await _pool.execute("ALTER TABLE admin_invites ADD COLUMN IF NOT EXISTS created_by UUID")
    await _pool.execute("ALTER TABLE admin_invites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
    normalized = root_email.strip().lower()
    if not normalized:
        return
    existing_user = await _pool.fetchrow(
        "SELECT id, COALESCE(display_name, username, email) AS name FROM users WHERE lower(email) = $1 LIMIT 1",
        normalized,
    )
    account_id = existing_user["id"] if existing_user else uuid4()
    name = existing_user["name"] if existing_user and existing_user["name"] else "Misa administrator"
    await _pool.execute(
        """
        INSERT INTO admin_accounts (id, email, name, role, permissions, status, suspended)
        VALUES ($1, $2, $3, 'super_admin', '{\"*\": true}'::jsonb, 'active', FALSE)
        ON CONFLICT (email) DO UPDATE SET
          role = 'super_admin', permissions = '{\"*\": true}'::jsonb,
          status = 'active', suspended = FALSE, updated_at = NOW()
        """,
        account_id,
        normalized,
        name,
    )


def _admin_row(row: asyncpg.Record | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


async def admin_by_email(email: str) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        "SELECT id, email, name, role, permissions, status, suspended FROM admin_accounts WHERE lower(email) = $1",
        email.strip().lower(),
    )
    return _admin_row(row)


async def admin_by_id(admin_id: UUID) -> dict[str, Any] | None:
    row = await _get_pool().fetchrow(
        "SELECT id, email, name, role, permissions, status, suspended FROM admin_accounts WHERE id = $1",
        admin_id,
    )
    return _admin_row(row)


async def create_admin_otp(admin_id: UUID, code_hash: str, expires_at: Any) -> UUID:
    otp_id = uuid4()
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("UPDATE admin_otps SET consumed_at = NOW() WHERE admin_id = $1 AND consumed_at IS NULL", admin_id)
            await conn.execute(
                "INSERT INTO admin_otps (id, admin_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)",
                otp_id, admin_id, code_hash, expires_at,
            )
    return otp_id


async def verify_admin_otp(admin_id: UUID, code_hash: str) -> tuple[bool, str]:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, code_hash, expires_at, attempts, consumed_at
                FROM admin_otps
                WHERE admin_id = $1
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
                """,
                admin_id,
            )
            if row is None or row["consumed_at"] is not None:
                return False, "missing"
            if row["expires_at"] <= datetime.now(timezone.utc):
                return False, "expired"
            if int(row["attempts"] or 0) >= 5:
                return False, "attempts"
            if not hmac.compare_digest(str(row["code_hash"]), code_hash):
                await conn.execute("UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1", row["id"])
                return False, "invalid"
            await conn.execute("UPDATE admin_otps SET consumed_at = NOW() WHERE id = $1", row["id"])
            return True, "ok"


async def create_admin_session(admin_id: UUID, token_hash: str, ip_address: str, user_agent: str, device_fingerprint: str) -> UUID:
    session_id = uuid4()
    await _get_pool().execute(
        """
        INSERT INTO admin_sessions (id, admin_id, token_hash, ip_address, user_agent, device_fingerprint, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '8 hours')
        """,
        session_id, admin_id, token_hash, ip_address, user_agent, device_fingerprint,
    )
    return session_id


async def admin_from_session(token_hash: str) -> dict[str, Any] | None:
    async with _get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT a.id, a.email, a.name, a.role, a.permissions, a.status, a.suspended
            FROM admin_sessions s
            JOIN admin_accounts a ON a.id = s.admin_id
            WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
            """,
            token_hash,
        )
        if row is None or row["status"] != "active" or row["suspended"]:
            return None
        await conn.execute("UPDATE admin_sessions SET last_seen_at = NOW() WHERE token_hash = $1", token_hash)
        return dict(row)


async def revoke_admin_session(token_hash: str) -> bool:
    result = await _get_pool().execute("UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL", token_hash)
    return result != "UPDATE 0"


async def log_admin_event(actor_id: UUID, action: str, metadata: dict[str, Any] | None = None, target_id: str | None = None) -> None:
    # Admin records normally use a real users.id. If a root admin was seeded
    # before its user row existed, keep authentication working and leave the
    # nullable audit actor unset rather than failing the login request.
    actor_exists = await _get_pool().fetchval("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)", actor_id)
    await _get_pool().execute(
        "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
        actor_id if actor_exists else None,
        action,
        "admin",
        target_id,
        json.dumps(metadata or {}),
    )


async def list_admin_staff() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch("SELECT id, email, name, role, status, suspended FROM admin_accounts ORDER BY lower(email)")
    return [dict(row) for row in rows]


async def create_admin_invite(invite_id: UUID, email: str, name: str, token_hash: str, role: str, permissions: dict[str, bool], expires_at: Any, created_by: UUID) -> None:
    await _get_pool().execute(
        "INSERT INTO admin_invites (id, email, name, token_hash, role, permissions, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
        invite_id, email, name, token_hash, role, json.dumps(permissions), expires_at, created_by,
    )


async def accept_admin_invite(token_hash: str) -> dict[str, Any] | None:
    async with _get_pool().acquire() as conn:
        async with conn.transaction():
            invite = await conn.fetchrow("SELECT * FROM admin_invites WHERE token_hash = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE", token_hash)
            if invite is None:
                return None
            account_id = uuid4()
            await conn.execute("INSERT INTO admin_accounts (id, email, name, role, permissions) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, permissions = EXCLUDED.permissions, status = 'active', suspended = FALSE, updated_at = NOW()", account_id, invite["email"], invite["name"], invite["role"], json.dumps(invite["permissions"] or {}))
            await conn.execute("UPDATE admin_invites SET accepted_at = NOW() WHERE id = $1", invite["id"])
            row = await conn.fetchrow("SELECT id, email, name, role, permissions, status, suspended FROM admin_accounts WHERE lower(email) = lower($1)", invite["email"])
            return dict(row) if row else None


async def list_admin_invites() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch("SELECT id, email, name, role, permissions, expires_at, accepted_at, revoked_at, created_at FROM admin_invites ORDER BY created_at DESC")
    return [dict(row) for row in rows]


async def revoke_admin_invite(admin_id: UUID, invite_id: UUID) -> bool:
    result = await _get_pool().execute("UPDATE admin_invites SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL", invite_id)
    return result != "UPDATE 0"


async def list_admin_sessions() -> list[dict[str, Any]]:
    rows = await _get_pool().fetch("SELECT s.id, s.admin_id, a.email, s.ip_address, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at FROM admin_sessions s JOIN admin_accounts a ON a.id = s.admin_id ORDER BY s.created_at DESC")
    return [dict(row) for row in rows]


async def revoke_admin_session_by_id(admin_id: UUID, session_id: UUID) -> bool:
    result = await _get_pool().execute("UPDATE admin_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL", session_id)
    return result != "UPDATE 0"


async def revoke_admin_sessions_for_admin(actor_id: UUID, admin_id: UUID) -> int:
    result = await _get_pool().execute("UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL", admin_id)
    return int(result.rsplit(" ", 1)[-1]) if result.rsplit(" ", 1)[-1].isdigit() else 0
