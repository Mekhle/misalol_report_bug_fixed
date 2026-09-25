-- Dynamic Badge + Rank platform. This migration is additive and preserves all legacy grants.
CREATE TABLE IF NOT EXISTS badge_categories (
    id UUID PRIMARY KEY, slug VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(96) NOT NULL,
    description TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE badges ADD COLUMN IF NOT EXISTS slug VARCHAR(64);
ALTER TABLE badges ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES badge_categories(id) ON DELETE SET NULL;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS rarity VARCHAR(32) NOT NULL DEFAULT 'COMMON';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS asset_url TEXT NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS preview_url TEXT NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS asset_key TEXT NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS preview_key TEXT NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS asset_mime VARCHAR(96) NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS animated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS automatic_award BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS manual_assignment_allowed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS limited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS max_awards INTEGER;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS purchasable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS price_minor BIGINT;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE badges SET slug = id WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS badges_slug_unique_idx ON badges (slug);
CREATE INDEX IF NOT EXISTS badges_catalog_order_idx ON badges (active, display_order, name);

CREATE TABLE IF NOT EXISTS ranks (
    id UUID PRIMARY KEY, slug VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL DEFAULT '', level INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0, color VARCHAR(32) NOT NULL DEFAULT '#9b87f5',
    requirements JSONB NOT NULL DEFAULT '[]'::jsonb, automatic_award BOOLEAN NOT NULL DEFAULT FALSE,
    manual_assignment_allowed BOOLEAN NOT NULL DEFAULT TRUE, visibility VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
    limited BOOLEAN NOT NULL DEFAULT FALSE, max_awards INTEGER, available_from TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, purchasable BOOLEAN NOT NULL DEFAULT FALSE, price_minor BIGINT,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD', active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ranks_catalog_order_idx ON ranks (active, level, display_order, name);

CREATE TABLE IF NOT EXISTS rank_badges (
    rank_id UUID NOT NULL REFERENCES ranks(id) ON DELETE CASCADE,
    badge_id VARCHAR(64) NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    included BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (rank_id, badge_id)
);

CREATE TABLE IF NOT EXISTS purchase_records (
    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type VARCHAR(16) NOT NULL CHECK (item_type IN ('BADGE', 'RANK')),
    badge_id VARCHAR(64) REFERENCES badges(id) ON DELETE RESTRICT,
    rank_id UUID REFERENCES ranks(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED','CANCELLED')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0), currency VARCHAR(3) NOT NULL,
    provider VARCHAR(64) NOT NULL DEFAULT '', provider_reference VARCHAR(255),
    idempotency_key VARCHAR(128) UNIQUE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CHECK ((item_type='BADGE' AND badge_id IS NOT NULL AND rank_id IS NULL) OR (item_type='RANK' AND rank_id IS NOT NULL AND badge_id IS NULL))
);
CREATE INDEX IF NOT EXISTS purchase_records_user_time_idx ON purchase_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_records_status_time_idx ON purchase_records (status, created_at DESC);

CREATE TABLE IF NOT EXISTS badge_awards (
    id UUID PRIMARY KEY, badge_id VARCHAR(64) NOT NULL REFERENCES badges(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(16) NOT NULL CHECK (source IN ('AUTOMATIC','MANUAL','PURCHASE')),
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), assigned_by UUID, reason TEXT NOT NULL DEFAULT '',
    purchase_id UUID REFERENCES purchase_records(id) ON DELETE SET NULL,
    featured BOOLEAN NOT NULL DEFAULT FALSE, display_order INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, revoked_by UUID, revoke_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS badge_awards_active_unique_idx ON badge_awards (user_id,badge_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS badge_awards_user_active_idx ON badge_awards (user_id,earned_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS badge_awards_badge_time_idx ON badge_awards (badge_id,earned_at DESC);

CREATE TABLE IF NOT EXISTS rank_awards (
    id UUID PRIMARY KEY, rank_id UUID NOT NULL REFERENCES ranks(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(16) NOT NULL CHECK (source IN ('AUTOMATIC','MANUAL','PURCHASE')),
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), assigned_by UUID, reason TEXT NOT NULL DEFAULT '',
    purchase_id UUID REFERENCES purchase_records(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, revoked_by UUID, revoke_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS rank_awards_active_unique_idx ON rank_awards (user_id,rank_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS rank_awards_user_active_idx ON rank_awards (user_id,earned_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS rank_awards_rank_time_idx ON rank_awards (rank_id,earned_at DESC);

INSERT INTO badge_awards (id,badge_id,user_id,source,earned_at,assigned_by,featured,display_order)
SELECT md5(ub.user_id::text||':'||ub.badge_id)::uuid, ub.badge_id, ub.user_id,
       CASE WHEN ub.granted_by IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END,
       ub.granted_at, ub.granted_by, ub.enabled,
       row_number() OVER (PARTITION BY ub.user_id ORDER BY ub.granted_at,ub.badge_id)::integer
FROM user_badges ub ON CONFLICT DO NOTHING;

INSERT INTO ranks (id,slug,name,description,level,display_order,active)
SELECT pr.id,pr.slug,pr.name,'Migrated from the legacy premium rank system.',
       row_number() OVER (ORDER BY pr.created_at,pr.name)::integer,
       row_number() OVER (ORDER BY pr.created_at,pr.name)::integer,TRUE
FROM premium_ranks pr ON CONFLICT (slug) DO NOTHING;

INSERT INTO rank_awards (id,rank_id,user_id,source,earned_at,assigned_by,expires_at,revoked_at)
SELECT md5(pe.id::text||':'||r.id::text)::uuid,r.id,pe.user_id,
       CASE WHEN pe.granted_by IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END,
       pe.created_at,pe.granted_by,pe.expires_at,CASE WHEN pe.active THEN NULL ELSE pe.created_at END
FROM premium_entitlements pe JOIN ranks r ON lower(pe.plan)=lower(r.slug) ON CONFLICT DO NOTHING;
-- badge_awards_featured_limit_migration: retain at most five legacy featured badges per user.
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY display_order, earned_at, badge_id) AS position
    FROM badge_awards WHERE revoked_at IS NULL AND featured=TRUE
)
UPDATE badge_awards SET featured=FALSE WHERE id IN (SELECT id FROM ranked WHERE position > 5);