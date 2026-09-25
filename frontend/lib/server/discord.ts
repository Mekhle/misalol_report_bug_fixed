import "server-only";
import { database, one } from "./postgres";
import { redis } from "./redis";
import { decryptDiscordSecret, encryptDiscordSecret } from "./discord-secrets";
import { withinLimit } from "./rate-limit";
import type { User } from "./users";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_CDN = "https://cdn.discordapp.com";
const SNOWFLAKE = /^\d{16,22}$/;
const ASSET = /^[a-zA-Z0-9_]{8,80}$/;
const CACHE_TTL = 60;
const PRESENCE_KEY_PREFIX = "discord:presence:";
const PRESENCE_STATUSES = new Set(["online", "idle", "dnd", "offline"]);

export type DiscordPresenceStatus = "online" | "idle" | "dnd" | "offline" | null;

export type DiscordPrefs = {
  showAvatar: boolean;
  showDecoration: boolean;
  showGuildTag: boolean;
  showStatus: boolean;
};

export type DiscordCard = {
  username: string;
  globalName: string;
  avatar: string | null;
  accountAvatar: string | null;
  decoration: string | null;
  guildTag: { tag: string; badge: string | null } | null;
  status?: DiscordPresenceStatus;
};

export type DiscordState = {
  connected: boolean;
  needsReconnect: boolean;
  canDisconnect: boolean;
  username: string;
  status: DiscordPresenceStatus;
  serverInvite: string;
  prefs: DiscordPrefs;
  card: DiscordCard;
};

export function canUnlinkDiscord(user: User): boolean {
  return Boolean(user.password_hash || user.google_id || user.telegram_id);
}

export function discordServerInviteUrl(): string {
  const text = String(process.env.DISCORD_SERVER_INVITE || "").trim();
  if (text.startsWith("https://discord.gg/") || text.startsWith("https://discord.com/invite/")) {
    return text.slice(0, 160);
  }
  return "";
}

export function discordAvatarCdn(userId: string, avatar: string | null | undefined): string | null {
  if (!SNOWFLAKE.test(userId)) return null;
  if (avatar && ASSET.test(avatar)) {
    const ext = avatar.startsWith("a_") ? "gif" : "png";
    return `${DISCORD_CDN}/avatars/${userId}/${avatar}.${ext}?size=256`;
  }
  try {
    const index = Number((BigInt(userId) >> BigInt(22)) % BigInt(6));
    return `${DISCORD_CDN}/embed/avatars/${index}.png`;
  } catch {
    return null;
  }
}

export function discordDecorationCdn(asset: string | null | undefined): string | null {
  if (!asset || !ASSET.test(asset)) return null;
  return `${DISCORD_CDN}/avatar-decoration-presets/${asset}.png?size=240&passthrough=true`;
}

export function discordGuildBadgeCdn(guildId: string | null | undefined, badge: string | null | undefined): string | null {
  if (!guildId || !badge || !SNOWFLAKE.test(guildId) || !ASSET.test(badge)) return null;
  return `${DISCORD_CDN}/clan-badges/${guildId}/${badge}.png?size=64`;
}

export function parseDiscordCard(user: Record<string, unknown>): {
  username: string;
  globalName: string;
  avatar: string | null;
  decoration: string | null;
  guildTag: { tag: string; badge: string | null } | null;
} {
  const userId = String(user.id || "");
  const avatar = discordAvatarCdn(userId, user.avatar as string | undefined);
  const decorationRaw = (user.avatar_decoration_data && typeof user.avatar_decoration_data === "object")
    ? (user.avatar_decoration_data as Record<string, unknown>)
    : null;
  const decoration = discordDecorationCdn(decorationRaw?.asset as string | undefined);

  const clan = (user.primary_guild && typeof user.primary_guild === "object")
    ? (user.primary_guild as Record<string, unknown>)
    : (user.clan && typeof user.clan === "object")
    ? (user.clan as Record<string, unknown>)
    : null;

  let guildTag: { tag: string; badge: string | null } | null = null;
  if (clan && clan.identity_enabled) {
    const tag = String(clan.tag || "").trim().slice(0, 4);
    if (tag && !/[<>&"']/.test(tag)) {
      const badge = discordGuildBadgeCdn(
        clan.identity_guild_id as string | undefined,
        clan.badge as string | undefined
      );
      guildTag = { tag, badge };
    }
  }

  return {
    username: String(user.username || "").slice(0, 32),
    globalName: String(user.global_name || "").slice(0, 32),
    avatar,
    decoration,
    guildTag,
  };
}

export function applyDiscordPrefs(
  card: { username: string; globalName: string; avatar: string | null; decoration: string | null; guildTag: { tag: string; badge: string | null } | null },
  prefs: { show_avatar: boolean; show_decoration: boolean; show_guild_tag: boolean }
): DiscordCard {
  return {
    username: card.username || "",
    globalName: card.globalName || "",
    avatar: prefs.show_avatar ? card.avatar : null,
    accountAvatar: card.avatar,
    decoration: prefs.show_decoration ? card.decoration : null,
    guildTag: prefs.show_guild_tag ? card.guildTag : null,
  };
}

export function normalizePresenceStatus(value: unknown): DiscordPresenceStatus {
  let status = String(value || "").trim().toLowerCase();
  if (status === "invisible") status = "offline";
  return PRESENCE_STATUSES.has(status) ? (status as DiscordPresenceStatus) : null;
}

export async function getDiscordPresence(discordId: string | null | undefined): Promise<DiscordPresenceStatus> {
  const userId = String(discordId || "").trim();
  if (!SNOWFLAKE.test(userId)) return null;
  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    const raw = await client.get(`${PRESENCE_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return normalizePresenceStatus(data.status);
  } catch {
    return null;
  }
}

export function emptyDiscordState(user: User): DiscordState {
  return {
    connected: false,
    needsReconnect: false,
    canDisconnect: false,
    username: "",
    status: null,
    serverInvite: discordServerInviteUrl(),
    prefs: { showAvatar: false, showDecoration: false, showGuildTag: false, showStatus: false },
    card: { username: "", globalName: "", avatar: null, accountAvatar: null, decoration: null, guildTag: null, status: null },
  };
}

async function withPresence(user: User, state: DiscordState): Promise<DiscordState> {
  const show = Boolean(state.prefs?.showStatus ?? true);
  const presence = show ? await getDiscordPresence(user.discord_id) : null;
  const next: DiscordState = {
    ...state,
    status: presence,
    serverInvite: discordServerInviteUrl(),
    card: { ...state.card, status: presence },
  };
  return next;
}

export async function invalidateDiscordCache(userId: string): Promise<void> {
  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    await client.del(`discord:live:${userId}`);
  } catch {
    // Ignore cache clear error
  }
}

async function cacheGet(userId: string): Promise<DiscordState | null> {
  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    const raw = await client.get(`discord:live:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DiscordState) : null;
  } catch {
    return null;
  }
}

async function cacheSet(userId: string, payload: DiscordState): Promise<void> {
  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    await client.set(`discord:live:${userId}`, JSON.stringify(payload), "EX", CACHE_TTL);
  } catch {
    // Ignore cache set error
  }
}

async function refreshDiscordAccess(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number } | null> {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "misa.lol (https://misa.lol)",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return payload && payload.access_token ? payload : null;
  } catch {
    return null;
  }
}

async function fetchDiscordMe(accessToken: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "misa.lol (https://misa.lol)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export async function revokeDiscordToken(token: string): Promise<boolean> {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";
  if (!clientId || !clientSecret || !token) return false;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: "refresh_token",
    });
    const res = await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "misa.lol (https://misa.lol)",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function liveDiscordState(user: User): Promise<DiscordState> {
  let discordId = user.discord_id;
  if (!discordId) {
    const userRow = await one<{ discord_id: string | null }>("SELECT discord_id FROM users WHERE id = $1", [user.id]);
    discordId = userRow?.discord_id || null;
    user.discord_id = discordId;
  }

  if (!discordId) {
    return emptyDiscordState(user);
  }

  let cached = await cacheGet(user.id);
  const cachedCard = cached?.card;
  if (cached && !cached.needsReconnect && cachedCard && (!cachedCard.username || !cachedCard.accountAvatar)) {
    cached = null;
  }

  if (cached) {
    cached.canDisconnect = canUnlinkDiscord(user);
    return withPresence(user, cached);
  }

  const link = await one<{
    user_id: string;
    discord_id: string;
    refresh_token: string | null;
    access_token: string | null;
    access_expires_at: Date | string | null;
    show_avatar: boolean;
    show_decoration: boolean;
    show_guild_tag: boolean;
    show_status: boolean;
  }>("SELECT * FROM discord_links WHERE user_id = $1", [user.id]);

  const prefs: DiscordPrefs = {
    showAvatar: link ? Boolean(link.show_avatar) : true,
    showDecoration: link ? Boolean(link.show_decoration) : true,
    showGuildTag: link ? Boolean(link.show_guild_tag) : true,
    showStatus: link ? Boolean(link.show_status) : true,
  };

  if (!link) {
    const state: DiscordState = {
      connected: true,
      needsReconnect: true,
      canDisconnect: canUnlinkDiscord(user),
      username: "",
      status: null,
      serverInvite: discordServerInviteUrl(),
      prefs,
      card: { username: "", globalName: "", avatar: null, accountAvatar: null, decoration: null, guildTag: null, status: null },
    };
    await cacheSet(user.id, state);
    return withPresence(user, state);
  }

  const refreshRaw = link.refresh_token ? decryptDiscordSecret(link.refresh_token) : null;
  const accessValid = Boolean(
    link.access_expires_at &&
    new Date(link.access_expires_at).getTime() > Date.now() + 30000
  );
  let access = accessValid && link.access_token ? decryptDiscordSecret(link.access_token) : null;

  if (!access && refreshRaw) {
    const tokens = await refreshDiscordAccess(refreshRaw);
    if (tokens && tokens.access_token) {
      access = tokens.access_token;
      const newRefresh = tokens.refresh_token || refreshRaw;
      const expires = Number(tokens.expires_in || 604800);
      const expiresAt = new Date(Date.now() + Math.max(60, expires - 60) * 1000);

      await database().query(`
        INSERT INTO discord_links (user_id, discord_id, refresh_token, access_token, access_expires_at, show_avatar, show_decoration, show_guild_tag, show_status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
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
      `, [
        user.id,
        link.discord_id || discordId,
        encryptDiscordSecret(newRefresh),
        encryptDiscordSecret(access),
        expiresAt,
        Boolean(link.show_avatar),
        Boolean(link.show_decoration),
        Boolean(link.show_guild_tag),
        Boolean(link.show_status),
      ]);
    }
  }

  const me = access ? await fetchDiscordMe(access) : null;
  if (!me) {
    const state: DiscordState = {
      connected: true,
      needsReconnect: true,
      canDisconnect: canUnlinkDiscord(user),
      username: "",
      status: null,
      serverInvite: discordServerInviteUrl(),
      prefs,
      card: { username: "", globalName: "", avatar: null, accountAvatar: null, decoration: null, guildTag: null, status: null },
    };
    await cacheSet(user.id, state);
    return withPresence(user, state);
  }

  const cardParsed = parseDiscordCard(me);
  const card = applyDiscordPrefs(cardParsed, {
    show_avatar: prefs.showAvatar,
    show_decoration: prefs.showDecoration,
    show_guild_tag: prefs.showGuildTag,
  });

  const state: DiscordState = {
    connected: true,
    needsReconnect: false,
    canDisconnect: canUnlinkDiscord(user),
    username: cardParsed.username || "",
    status: null,
    serverInvite: discordServerInviteUrl(),
    prefs,
    card,
  };

  await cacheSet(user.id, state);
  return withPresence(user, state);
}

export async function publicPresenceForUser(user: User): Promise<DiscordPresenceStatus> {
  let discordId = user.discord_id;
  if (!discordId) {
    const row = await one<{ discord_id: string | null }>("SELECT discord_id FROM users WHERE id = $1", [user.id]);
    discordId = row?.discord_id || null;
  }
  if (!discordId) return null;

  const link = await one<{ show_status: boolean }>("SELECT show_status FROM discord_links WHERE user_id = $1", [user.id]);
  if (link && !link.show_status) return null;

  return getDiscordPresence(discordId);
}

export async function updateDiscordPrefs(
  user: User,
  patch: { showAvatar?: boolean; showDecoration?: boolean; showGuildTag?: boolean; showStatus?: boolean }
): Promise<DiscordState> {
  if (!user.discord_id) {
    const row = await one<{ discord_id: string | null }>("SELECT discord_id FROM users WHERE id = $1", [user.id]);
    if (!row?.discord_id) {
      throw new Error("Connect Discord first.");
    }
    user.discord_id = row.discord_id;
  }

  const existing = await one<{
    show_avatar: boolean;
    show_decoration: boolean;
    show_guild_tag: boolean;
    show_status: boolean;
  }>("SELECT show_avatar, show_decoration, show_guild_tag, show_status FROM discord_links WHERE user_id = $1", [user.id]);

  if (!existing) {
    throw new Error("Reconnect Discord to change what appears on your card.");
  }

  const showAvatar = patch.showAvatar !== undefined ? Boolean(patch.showAvatar) : existing.show_avatar;
  const showDecoration = patch.showDecoration !== undefined ? Boolean(patch.showDecoration) : existing.show_decoration;
  const showGuildTag = patch.showGuildTag !== undefined ? Boolean(patch.showGuildTag) : existing.show_guild_tag;
  const showStatus = patch.showStatus !== undefined ? Boolean(patch.showStatus) : existing.show_status;

  await database().query(`
    UPDATE discord_links
    SET show_avatar = $2, show_decoration = $3, show_guild_tag = $4, show_status = $5, updated_at = NOW()
    WHERE user_id = $1
  `, [user.id, showAvatar, showDecoration, showGuildTag, showStatus]);

  await invalidateDiscordCache(user.id);
  return liveDiscordState(user);
}

export async function disconnectDiscord(user: User, clientIp: string): Promise<{ ok: boolean; connected: boolean }> {
  const ok = await withinLimit(`rl:auth:discord-disconnect:${clientIp}`, 8, 60);
  if (!ok) {
    throw new Error("RATE_LIMIT");
  }

  if (!user.discord_id) {
    const row = await one<{ discord_id: string | null }>("SELECT discord_id FROM users WHERE id = $1", [user.id]);
    if (!row?.discord_id) {
      throw new Error("Discord is not connected.");
    }
    user.discord_id = row.discord_id;
  }

  if (!canUnlinkDiscord(user)) {
    throw new Error("Add a password or another login method before disconnecting Discord.");
  }

  const link = await one<{ refresh_token: string | null }>("SELECT refresh_token FROM discord_links WHERE user_id = $1", [user.id]);
  if (link?.refresh_token) {
    const refresh = decryptDiscordSecret(link.refresh_token);
    if (refresh) {
      await revokeDiscordToken(refresh);
    }
  }

  await database().query("DELETE FROM discord_links WHERE user_id = $1", [user.id]);
  await database().query("UPDATE users SET discord_id = NULL, updated_at = NOW() WHERE id = $1", [user.id]);
  user.discord_id = null;
  await invalidateDiscordCache(user.id);

  return { ok: true, connected: false };
}
