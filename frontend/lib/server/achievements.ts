import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "./postgres";

export type DatabaseClient = {
  query: <R = any>(text: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;
};

export const FEATURED_LIMIT = 5;
export const BADGE_ID_REGEX = /^[a-z0-9-]{2,64}$/;

export type Requirement = {
  type: string;
  operator?: "gte" | "lte" | "eq";
  value?: number;
  rank?: string;
  key?: string;
};

export type UserMetrics = {
  profile_views: number;
  link_clicks: number;
  account_age_days: number;
  profile_completion: number;
  music_activity: number;
  ranks: Set<string>;
};

function parseJson<T>(val: unknown, fallback: T): T {
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return (val != null ? val : fallback) as T;
}

export function profileCompletion(config: unknown): number {
  if (!config || typeof config !== "object") return 0;
  const root = (config as Record<string, unknown>).config && typeof (config as Record<string, unknown>).config === "object"
    ? ((config as Record<string, unknown>).config as Record<string, unknown>)
    : (config as Record<string, unknown>);

  const profile = (root.profile && typeof root.profile === "object" ? root.profile : {}) as Record<string, unknown>;
  const assets = (root.assets && typeof root.assets === "object" ? root.assets : {}) as Record<string, unknown>;
  const socials = Array.isArray(root.socials) ? root.socials : [];

  const checks = [
    Boolean(profile.displayName),
    Boolean(profile.description),
    Boolean((assets.avatar as Record<string, unknown> | undefined)?.url),
    Boolean((assets.background as Record<string, unknown> | undefined)?.url),
    socials.some((item) => item && typeof item === "object" && item.enabled && item.value),
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export async function getUserMetrics(userId: string, db: DatabaseClient = database()): Promise<UserMetrics> {
  const row = (await db.query<{
    created_at: Date | string | null;
    views: number;
    clicks: number;
    config: unknown;
    music: number;
  }>(`
    SELECT u.created_at,
           COALESCE(s.views, 0)::int AS views,
           COALESCE(s.clicks, 0)::int AS clicks,
           p.config,
           COALESCE((SELECT COUNT(*) FROM profile_events e WHERE e.user_id = u.id AND e.kind IN ('audio', 'music', 'track_play')), 0)::int AS music
    FROM users u
    LEFT JOIN profile_stats s ON s.user_id = u.id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = $1
  `, [userId])).rows[0];

  if (!row) throw new Error("USER_NOT_FOUND");

  const rankRows = (await db.query<{ id: string; slug: string }>(`
    SELECT r.id, r.slug
    FROM rank_awards a
    JOIN ranks r ON r.id = a.rank_id
    WHERE a.user_id = $1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > NOW())
  `, [userId])).rows;

  const rankKeys = new Set<string>();
  for (const r of rankRows) {
    rankKeys.add(String(r.id));
    rankKeys.add(String(r.slug));
  }

  const createdAt = row.created_at ? new Date(row.created_at) : new Date();
  const ageDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    profile_views: Number(row.views || 0),
    link_clicks: Number(row.clicks || 0),
    account_age_days: ageDays,
    profile_completion: profileCompletion(row.config),
    music_activity: Number(row.music || 0),
    ranks: rankKeys,
  };
}

export function requirementMet(requirement: Requirement, metrics: UserMetrics): boolean {
  const kind = String(requirement.type || "").toLowerCase();
  if (["manual", "purchase", "custom"].includes(kind)) return false;
  if (kind === "rank") {
    return metrics.ranks.has(String(requirement.rank || ""));
  }

  const metricMap: Record<string, keyof Omit<UserMetrics, "ranks">> = {
    profile_views: "profile_views",
    account_age: "account_age_days",
    link_clicks: "link_clicks",
    profile_completion: "profile_completion",
    music_activity: "music_activity",
  };

  const key = metricMap[kind];
  if (!key) return false;

  const current = Number(metrics[key] || 0);
  const target = Number(requirement.value || 0);
  const op = requirement.operator || "gte";

  if (op === "gte") return current >= target;
  if (op === "lte") return current <= target;
  if (op === "eq") return current === target;
  return false;
}

export function requirementsMet(requirementsRaw: unknown, metrics: UserMetrics): boolean {
  const list = parseJson<Requirement[]>(requirementsRaw, []);
  return list.length > 0 && list.every((req) => requirementMet(req, metrics));
}

function progressForRequirements(requirementsRaw: unknown, metrics: UserMetrics): {
  current: number;
  target: number;
  label: string;
  percent: number;
} | null {
  const list = parseJson<Requirement[]>(requirementsRaw, []);
  for (const req of list) {
    const kind = String(req.type || "").toLowerCase();
    const metricMap: Record<string, { key: keyof Omit<UserMetrics, "ranks">; label: string }> = {
      profile_views: { key: "profile_views", label: "views" },
      account_age: { key: "account_age_days", label: "days" },
      link_clicks: { key: "link_clicks", label: "clicks" },
      profile_completion: { key: "profile_completion", label: "% complete" },
      music_activity: { key: "music_activity", label: "plays" },
    };

    if (metricMap[kind]) {
      const { key, label } = metricMap[kind];
      const current = Number(metrics[key] || 0);
      const target = Number(req.value || 0);
      const percent = target <= 0 ? 100 : Math.min(100, Math.round((current / target) * 100));
      return { current, target, label, percent };
    }

    if (kind === "rank") {
      const met = requirementMet(req, metrics);
      return { current: met ? 1 : 0, target: 1, label: "rank", percent: met ? 100 : 0 };
    }
  }
  return null;
}

export async function evaluateUser(userId: string): Promise<{ badges: number; ranks: number }> {
  const db = database();
  const awarded = { badges: 0, ranks: 0 };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`achievements:${userId}`]);

    const metrics = await getUserMetrics(userId, client);

    const now = new Date();
    const ranks = (await client.query<{
      id: string;
      slug: string;
      requirements: unknown;
      limited: boolean;
      max_awards: number | null;
      available_from: Date | string | null;
      expires_at: Date | string | null;
      active: boolean;
    }>(`
      SELECT id, slug, requirements, limited, max_awards, available_from, expires_at, active
      FROM ranks
      WHERE active = TRUE AND automatic_award = TRUE
      ORDER BY level, display_order, name
    `)).rows;

    for (const rank of ranks) {
      if (rank.available_from && new Date(rank.available_from) > now) continue;
      if (rank.expires_at && new Date(rank.expires_at) <= now) continue;
      if (!requirementsMet(rank.requirements, metrics)) continue;

      const locked = (await client.query<{ id: string; limited: boolean; max_awards: number | null }>(`
        SELECT id, limited, max_awards FROM ranks WHERE id = $1 FOR UPDATE
      `, [rank.id])).rows[0];
      if (!locked) continue;

      if (locked.limited) {
        const countRow = (await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM rank_awards WHERE rank_id = $1 AND revoked_at IS NULL
        `, [rank.id])).rows[0];
        if (Number(countRow?.count || 0) >= Number(locked.max_awards || 0)) continue;
      }

      const res = await client.query(`
        INSERT INTO rank_awards (id, rank_id, user_id, source, reason)
        VALUES ($1, $2, $3, 'AUTOMATIC', 'Requirements completed')
        ON CONFLICT (user_id, rank_id) WHERE revoked_at IS NULL DO NOTHING
      `, [randomUUID(), rank.id, userId]);

      if ((res.rowCount ?? 0) > 0) {
        awarded.ranks++;
        metrics.ranks.add(String(rank.id));
        metrics.ranks.add(String(rank.slug));

        const linkedBadges = (await client.query<{ badge_id: string }>(`
          SELECT badge_id FROM rank_badges WHERE rank_id = $1 AND included = TRUE
        `, [rank.id])).rows;

        for (const item of linkedBadges) {
          await client.query(`
            INSERT INTO badge_awards (id, badge_id, user_id, source, reason, display_order)
            VALUES ($1, $2, $3, 'AUTOMATIC', $4, COALESCE((SELECT max(display_order) + 1 FROM badge_awards WHERE user_id = $3), 0))
            ON CONFLICT (user_id, badge_id) WHERE revoked_at IS NULL DO NOTHING
          `, [randomUUID(), item.badge_id, userId, `Included with rank ${rank.id}`]);

          await client.query(`
            INSERT INTO user_badges (user_id, badge_id, enabled, granted_by, granted_at)
            VALUES ($1, $2, FALSE, NULL, NOW())
            ON CONFLICT (user_id, badge_id) DO NOTHING
          `, [userId, item.badge_id]);
        }
      }
    }

    const badges = (await client.query<{
      id: string;
      requirements: unknown;
      limited: boolean;
      max_awards: number | null;
      available_from: Date | string | null;
      expires_at: Date | string | null;
      active: boolean;
    }>(`
      SELECT id, requirements, limited, max_awards, available_from, expires_at, active
      FROM badges
      WHERE active = TRUE AND automatic_award = TRUE
      ORDER BY display_order, name
    `)).rows;

    for (const badge of badges) {
      if (badge.available_from && new Date(badge.available_from) > now) continue;
      if (badge.expires_at && new Date(badge.expires_at) <= now) continue;
      if (!requirementsMet(badge.requirements, metrics)) continue;

      const locked = (await client.query<{ id: string; limited: boolean; max_awards: number | null }>(`
        SELECT id, limited, max_awards FROM badges WHERE id = $1 FOR UPDATE
      `, [badge.id])).rows[0];
      if (!locked) continue;

      if (locked.limited) {
        const countRow = (await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM badge_awards WHERE badge_id = $1 AND revoked_at IS NULL
        `, [badge.id])).rows[0];
        if (Number(countRow?.count || 0) >= Number(locked.max_awards || 0)) continue;
      }

      const res = await client.query(`
        INSERT INTO badge_awards (id, badge_id, user_id, source, reason, display_order)
        VALUES ($1, $2, $3, 'AUTOMATIC', 'Requirements completed', COALESCE((SELECT max(display_order) + 1 FROM badge_awards WHERE user_id = $3), 0))
        ON CONFLICT (user_id, badge_id) WHERE revoked_at IS NULL DO NOTHING
      `, [randomUUID(), badge.id, userId]);

      if ((res.rowCount ?? 0) > 0) {
        awarded.badges++;
        await client.query(`
          INSERT INTO user_badges (user_id, badge_id, enabled, granted_by, granted_at)
          VALUES ($1, $2, FALSE, NULL, NOW())
          ON CONFLICT (user_id, badge_id) DO NOTHING
        `, [userId, badge.id]);
      }
    }

    await client.query("COMMIT");
    return awarded;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function collectionForUser(userId: string) {
  await evaluateUser(userId);
  const metrics = await getUserMetrics(userId);
  const db = database();

  const categories = (await db.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    display_order: number;
  }>(`
    SELECT id, slug, name, description, display_order
    FROM badge_categories
    WHERE active = TRUE
    ORDER BY display_order, name
  `)).rows;

  const badgeRows = (await db.query<Record<string, unknown>>(`
    SELECT b.id, b.slug, b.name, b.description, b.color, b.rarity, b.display_order,
           b.icon, b.asset_url, b.preview_url, b.animated, b.requirements, b.purchasable,
           b.price_minor, b.currency, b.visibility,
           c.slug AS category_slug, c.name AS category_name,
           a.id AS award_id, a.source, a.earned_at, a.featured, a.display_order AS featured_order
    FROM badges b
    LEFT JOIN badge_categories c ON c.id = b.category_id
    LEFT JOIN badge_awards a ON a.badge_id = b.id AND a.user_id = $1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > NOW())
    WHERE b.active = TRUE AND (b.visibility = 'PUBLIC' OR a.id IS NOT NULL)
    ORDER BY b.display_order, b.name
  `, [userId])).rows;

  const rankRows = (await db.query<Record<string, unknown>>(`
    SELECT r.id, r.slug, r.name, r.description, r.level, r.display_order, r.color,
           r.requirements, r.purchasable, r.price_minor, r.currency, r.visibility,
           a.id AS award_id, a.source, a.earned_at,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'previewUrl', b.preview_url, 'assetUrl', b.asset_url))
              FROM rank_badges rb JOIN badges b ON b.id = rb.badge_id WHERE rb.rank_id = r.id AND rb.included = TRUE),
             '[]'::jsonb
           ) AS badges
    FROM ranks r
    LEFT JOIN rank_awards a ON a.rank_id = r.id AND a.user_id = $1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > NOW())
    WHERE r.active = TRUE AND (r.visibility = 'PUBLIC' OR a.id IS NOT NULL)
    ORDER BY r.level, r.display_order, r.name
  `, [userId])).rows;

  const badges = badgeRows.map((row) => {
    const item = { ...row };
    const owned = Boolean(item.award_id);
    delete item.award_id;
    return {
      ...item,
      owned,
      progress: owned ? null : progressForRequirements(item.requirements, metrics),
    };
  });

  const ranks = rankRows.map((row) => {
    const item = { ...row };
    const owned = Boolean(item.award_id);
    delete item.award_id;
    return {
      ...item,
      owned,
      progress: owned ? null : progressForRequirements(item.requirements, metrics),
    };
  });

  const currentRank = [...ranks].reverse().find((item) => item.owned) || null;

  return {
    categories,
    badges,
    ranks,
    currentRank,
    metrics: {
      profile_views: metrics.profile_views,
      link_clicks: metrics.link_clicks,
      account_age_days: metrics.account_age_days,
      profile_completion: metrics.profile_completion,
      music_activity: metrics.music_activity,
    },
    featuredLimit: FEATURED_LIMIT,
  };
}

export async function currentRankForUser(userId: string) {
  const db = database();
  const row = (await db.query<{
    id: string;
    slug: string;
    name: string;
    color: string;
    level: number;
  }>(`
    SELECT r.id, r.slug, r.name, r.color, r.level
    FROM rank_awards a
    JOIN ranks r ON r.id = a.rank_id
    WHERE a.user_id = $1 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > NOW()) AND r.active = TRUE
    ORDER BY r.level DESC, a.earned_at DESC
    LIMIT 1
  `, [userId])).rows[0];

  return row ? { id: row.id, slug: row.slug, name: row.name, color: row.color, level: row.level } : null;
}

export async function setFeatured(userId: string, badgeIds: string[]): Promise<string[]> {
  const ordered = Array.from(new Set(badgeIds.map((item) => String(item))));
  if (ordered.length > FEATURED_LIMIT) {
    throw new Error("FEATURED_LIMIT");
  }

  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (ordered.length > 0) {
      const rows = (await client.query<{ badge_id: string }>(`
        SELECT badge_id
        FROM badge_awards
        WHERE user_id = $1 AND revoked_at IS NULL AND badge_id = ANY($2::text[])
      `, [userId, ordered])).rows;

      const ownedSet = new Set(rows.map((r) => r.badge_id));
      if (!ordered.every((id) => ownedSet.has(id))) {
        throw new Error("NOT_OWNED");
      }
    }

    await client.query(`
      UPDATE badge_awards SET featured = FALSE WHERE user_id = $1 AND revoked_at IS NULL
    `, [userId]);

    for (let index = 0; index < ordered.length; index++) {
      const badgeId = ordered[index];
      await client.query(`
        UPDATE badge_awards SET featured = TRUE, display_order = $3
        WHERE user_id = $1 AND badge_id = $2 AND revoked_at IS NULL
      `, [userId, badgeId, index]);

      await client.query(`
        UPDATE user_badges SET enabled = TRUE WHERE user_id = $1 AND badge_id = $2
      `, [userId, badgeId]);
    }

    if (ordered.length > 0) {
      await client.query(`
        UPDATE user_badges SET enabled = FALSE WHERE user_id = $1 AND badge_id <> ALL($2::text[])
      `, [userId, ordered]);
    } else {
      await client.query(`
        UPDATE user_badges SET enabled = FALSE WHERE user_id = $1
      `, [userId]);
    }

    await client.query("COMMIT");
    return ordered;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getBadgeIcon(badgeId: string): Promise<{
  type: "redirect" | "data";
  url?: string;
  buffer?: Buffer;
  contentType?: string;
} | null> {
  const db = database();
  const row = (await db.query<{ preview_url: string | null; asset_url: string | null; icon: string | null }>(`
    SELECT preview_url, asset_url, icon
    FROM badges
    WHERE id = $1 AND active = TRUE
  `, [badgeId])).rows[0];

  if (!row) return null;

  const remote = String(row.preview_url || row.asset_url || "");
  if (remote.startsWith("https://")) {
    try {
      const parsed = new URL(remote);
      if (parsed.hostname && !parsed.username && !parsed.password) {
        return { type: "redirect", url: remote };
      }
    } catch {
      // Fall through to icon
    }
  }

  const icon = String(row.icon || "");
  if (icon.startsWith("data:")) {
    const match = icon.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const contentType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      return { type: "data", buffer, contentType };
    }
  }

  return null;
}
