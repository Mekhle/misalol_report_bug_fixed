import "server-only";
import { database } from "./postgres";
import { redis } from "./redis";

export const RANGES: Record<string, number | null> = {
  "7D": 7,
  "30D": 30,
  ALL: null,
};
export const METRICS = new Set(["views"]);
export const SORTS = new Set(["popular"]);
export const LIMIT = 50;
export const CACHE_TTL = 45;

const LIVE_PROFILE = "u.username IS NOT NULL AND length(u.username) >= 3 AND u.suspended_at IS NULL";

export type LeaderboardEntry = {
  rank: number;
  username: string;
  displayName: string;
  views: number;
  clicks: number;
  avatar: string;
};

export type LeaderboardResponse = {
  range: string;
  metric: string;
  sort: string;
  entries: LeaderboardEntry[];
  you: (Omit<LeaderboardEntry, "rank"> & { rank: number | null }) | null;
};

function formatPublicRow(rank: number, row: { username?: string; display_name?: string; displayName?: string; views?: number; clicks?: number }): LeaderboardEntry {
  const username = String(row.username || "");
  return {
    rank,
    username,
    displayName: String(row.display_name || row.displayName || username),
    views: Number(row.views || 0),
    clicks: Number(row.clicks || 0),
    avatar: username ? `/api/v1/profile/${username}/assets/avatar` : "",
  };
}

export async function fetchLeaderboardRows(kind: string, start: Date | null, limit = 50): Promise<Array<{
  user_id: string;
  username: string;
  display_name: string;
  views: number;
  clicks: number;
}>> {
  const db = database();
  const cappedLimit = Math.max(1, Math.min(limit, 50));

  try {
    if (!start) {
      const rows = (await db.query<{
        user_id: string;
        username: string;
        display_name: string;
        views: number;
        clicks: number;
      }>(`
        SELECT u.id::text AS user_id,
               u.username,
               COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
               s.views::int AS views,
               s.clicks::int AS clicks
        FROM profile_stats s
        JOIN users u ON u.id = s.user_id
        WHERE ${LIVE_PROFILE} AND s.views > 0
        ORDER BY s.views DESC, u.username ASC
        LIMIT $1
      `, [cappedLimit])).rows;
      return rows;
    } else {
      const rows = (await db.query<{
        user_id: string;
        username: string;
        display_name: string;
        views: number;
        clicks: number;
      }>(`
        SELECT u.id::text AS user_id,
               u.username,
               COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
               COUNT(*) FILTER (WHERE e.kind = 'view')::int AS views,
               COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks
        FROM profile_events e
        JOIN users u ON u.id = e.user_id
        WHERE e.occurred_at >= $2 AND ${LIVE_PROFILE}
        GROUP BY u.id, u.username, u.display_name
        HAVING COUNT(*) FILTER (WHERE e.kind = 'view') > 0
        ORDER BY COUNT(*) FILTER (WHERE e.kind = 'view') DESC, u.username ASC
        LIMIT $1
      `, [cappedLimit, start])).rows;
      return rows;
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "42P01") {
      return [];
    }
    throw err;
  }
}

async function getCachedRows(window: string, kind: string, start: Date | null): Promise<Array<{
  user_id: string;
  username: string;
  display_name: string;
  views: number;
  clicks: number;
}>> {
  const key = `leaderboard:${window}:${kind}`;
  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    const raw = await client.get(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch {
    // Ignore Dragonfly cache miss / error
  }

  const rows = await fetchLeaderboardRows(kind, start, LIMIT);

  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    await client.set(key, JSON.stringify(rows), "EX", CACHE_TTL);
  } catch {
    // Ignore cache set error
  }

  return rows;
}

export async function getLeaderboardScore(userId: string, kind: string, start: Date | null): Promise<{
  username: string;
  displayName: string;
  views: number;
  clicks: number;
  rank: number | null;
} | null> {
  const db = database();

  try {
    if (!start) {
      const row = (await db.query<{
        username: string;
        display_name: string;
        views: number;
        clicks: number;
      }>(`
        SELECT u.username,
               COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
               COALESCE(s.views, 0)::int AS views,
               COALESCE(s.clicks, 0)::int AS clicks
        FROM users u
        LEFT JOIN profile_stats s ON s.user_id = u.id
        WHERE u.id = $1 AND ${LIVE_PROFILE}
      `, [userId])).rows[0];

      if (!row) return null;
      const score = Number(row.views || 0);

      const aheadRow = (await db.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM profile_stats s
        JOIN users u ON u.id = s.user_id
        WHERE ${LIVE_PROFILE} AND s.views > $1
      `, [score])).rows[0];

      const ahead = Number(aheadRow?.count || 0);
      return {
        username: row.username,
        displayName: row.display_name,
        views: score,
        clicks: Number(row.clicks || 0),
        rank: score > 0 ? ahead + 1 : null,
      };
    } else {
      const row = (await db.query<{
        username: string;
        display_name: string;
        views: number;
        clicks: number;
      }>(`
        SELECT u.username,
               COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
               COUNT(*) FILTER (WHERE e.kind = 'view')::int AS views,
               COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks
        FROM users u
        LEFT JOIN profile_events e ON e.user_id = u.id AND e.occurred_at >= $2
        WHERE u.id = $1 AND ${LIVE_PROFILE}
        GROUP BY u.username, u.display_name
      `, [userId, start])).rows[0];

      if (!row) return null;
      const score = Number(row.views || 0);

      const aheadRow = (await db.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count FROM (
          SELECT e.user_id
          FROM profile_events e
          JOIN users u ON u.id = e.user_id
          WHERE e.occurred_at >= $2 AND e.kind = 'view' AND ${LIVE_PROFILE}
          GROUP BY e.user_id
          HAVING COUNT(*) > $1
        ) ranked
      `, [score, start])).rows[0];

      const ahead = Number(aheadRow?.count || 0);
      return {
        username: row.username,
        displayName: row.display_name,
        views: score,
        clicks: Number(row.clicks || 0),
        rank: score > 0 ? ahead + 1 : null,
      };
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "42P01") {
      return null;
    }
    throw err;
  }
}

export async function leaderboard(
  rangeKey = "7D",
  metric = "views",
  sortKey = "popular",
  viewerId?: string | null
): Promise<LeaderboardResponse> {
  const window = rangeKey.toUpperCase() in RANGES ? rangeKey.toUpperCase() : "7D";
  const kind = "views";
  const days = RANGES[window];
  const start = days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  const rows = await getCachedRows(window, kind, start);
  const entries = rows.map((row, index) => formatPublicRow(index + 1, row));

  let you: (Omit<LeaderboardEntry, "rank"> & { rank: number | null }) | null = null;
  if (viewerId) {
    const foundIndex = rows.findIndex((row) => String(row.user_id) === viewerId);
    if (foundIndex !== -1) {
      you = entries[foundIndex];
    } else {
      const score = await getLeaderboardScore(viewerId, kind, start);
      if (score) {
        you = {
          rank: score.rank,
          username: score.username,
          displayName: score.displayName,
          views: score.views,
          clicks: score.clicks,
          avatar: score.username ? `/api/v1/profile/${score.username}/assets/avatar` : "",
        };
      }
    }
  }

  return {
    range: window,
    metric: kind,
    sort: "popular",
    entries,
    you,
  };
}
