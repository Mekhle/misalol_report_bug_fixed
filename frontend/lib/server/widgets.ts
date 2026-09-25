import "server-only";
import { createHash } from "node:crypto";
import { safePublicUrl } from "./network-safety";
import { redis } from "./redis";

const CACHE_TTL = 600;
const TIME_TTL = 30;
const HANDLE = /^[A-Za-z0-9_.-]{2,64}$/;
const INVITE = /^[A-Za-z0-9-]{2,32}$/;
const CITY = /^[A-Za-z0-9 .,'-]{2,80}$/;

const WEATHER_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  61: "Rain",
  71: "Snow",
  80: "Showers",
  95: "Thunderstorm",
};

export type ResolvedWidget = {
  id?: string;
  type: string;
  value: string;
  status: "ok" | "empty" | "error";
  title: string;
  subtitle: string;
  image: string | null;
  href: string | null;
  meta: Record<string, unknown>;
};

function httpsUrl(url: unknown): string | null {
  const text = String(url || "").trim();
  if (!text || text.length > 500) return null;
  return safePublicUrl(text, { httpsOnly: true });
}

function parseHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cacheKey(kind: string, value: string): string {
  const digest = createHash("sha256").update(`${kind}:${value.toLowerCase()}`).digest("hex").slice(0, 32);
  return `widget:${kind}:${digest}`;
}

async function withCache(
  kind: string,
  value: string,
  ttl: number,
  loader: () => Promise<Omit<ResolvedWidget, "id" | "type" | "value">>
): Promise<Omit<ResolvedWidget, "id" | "type" | "value">> {
  const key = cacheKey(kind, value);
  const client = redis();
  if (client) {
    try {
      const cached = await client.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch {
      // cache miss / redis down
    }
  }

  const data = await loader();
  const keepFor = data.status === "error" ? 120 : ttl;
  if (client && data.status !== "empty") {
    try {
      await client.set(key, JSON.stringify(data), "EX", keepFor);
    } catch {
      // ignore cache write error
    }
  }
  return data;
}

async function httpGet(url: string, params?: Record<string, string>): Promise<Response | null> {
  const target = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  }
  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "misa.lol profile widgets" },
      signal: AbortSignal.timeout(8000),
    });
    return res;
  } catch {
    return null;
  }
}

async function httpPost(url: string, body: unknown): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "misa.lol profile widgets" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res;
  } catch {
    return null;
  }
}

// 1. YouTube
function youtubeUrl(value: string): string | null {
  const text = value.includes("://") ? value : `https://${value}`;
  const host = parseHost(text);
  if (host === "youtu.be" || host === "www.youtu.be") return text;
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com") || host.endsWith(".youtube-nocookie.com")) {
    return text;
  }
  return null;
}

async function resolveYoutube(value: string) {
  const url = youtubeUrl(value);
  if (!url) return { status: "error" as const, title: "YouTube", subtitle: "Use a YouTube video or channel URL.", image: null, href: null, meta: {} };

  const res = await httpGet("https://www.youtube.com/oembed", { url, format: "json" });
  if (!res || !res.ok) {
    try {
      const path = new URL(url).pathname;
      if (["/@", "/channel/", "/c/", "/user/"].some((prefix) => path.startsWith(prefix)) && httpsUrl(url)) {
        return {
          status: "ok" as const,
          title: path.replace(/\/+$/, "").split("/").pop()!.slice(0, 80),
          subtitle: "YouTube channel · open profile",
          image: null,
          href: httpsUrl(url),
          meta: { provider: "YouTube" },
        };
      }
    } catch {
      // invalid URL
    }
    return { status: "error" as const, title: "YouTube", subtitle: "YouTube did not return that page.", image: null, href: null, meta: {} };
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return {
    status: "ok" as const,
    title: String(data?.title || "YouTube").slice(0, 80),
    subtitle: String(data?.author_name || "YouTube").slice(0, 80),
    image: httpsUrl(data?.thumbnail_url),
    href: httpsUrl(url),
    meta: { provider: "YouTube" },
  };
}

// 2. Spotify
function spotifyUrl(value: string): string | null {
  const text = value.includes("://") ? value : `https://${value}`;
  if (parseHost(text) !== "open.spotify.com") return null;
  return text;
}

async function resolveSpotify(value: string) {
  const url = spotifyUrl(value);
  if (!url) return { status: "error" as const, title: "Spotify", subtitle: "Use an open.spotify.com link.", image: null, href: null, meta: {} };

  const res = await httpGet("https://open.spotify.com/oembed", { url, format: "json" });
  if (!res || !res.ok) {
    return { status: "error" as const, title: "Spotify", subtitle: "Spotify did not return that link.", image: null, href: null, meta: {} };
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return {
    status: "ok" as const,
    title: String(data?.title || "Spotify").slice(0, 80),
    subtitle: "Spotify",
    image: httpsUrl(data?.thumbnail_url),
    href: httpsUrl(url),
    meta: { provider: "Spotify" },
  };
}

// 3. Discord
function discordInviteCode(value: string): string | null {
  const text = value.trim();
  if (INVITE.test(text)) return text;
  try {
    const parsed = new URL(text.includes("://") ? text : `https://${text}`);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((host === "discord.gg" || host === "www.discord.gg") && parts.length > 0) {
      return INVITE.test(parts[0]) ? parts[0] : null;
    }
    if ((host === "discord.com" || host === "www.discord.com") && parts.length >= 2 && parts[0] === "invite") {
      return INVITE.test(parts[1]) ? parts[1] : null;
    }
  } catch {
    // not a valid URL
  }
  return null;
}

async function resolveDiscord(value: string) {
  const code = discordInviteCode(value);
  if (!code) return { status: "error" as const, title: "Discord", subtitle: "Use a discord.gg invite.", image: null, href: null, meta: {} };

  const res = await httpGet(`https://discord.com/api/v10/invites/${code}`, { with_counts: "true" });
  if (!res || !res.ok) {
    return { status: "error" as const, title: "Discord", subtitle: "That invite is invalid or expired.", image: null, href: null, meta: {} };
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const guild = (data?.guild as Record<string, unknown>) || {};
  let icon: string | null = null;
  if (guild.id && guild.icon) {
    icon = httpsUrl(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`);
  }
  const members = data?.approximate_member_count;
  const subtitle = typeof members === "number" ? `${members.toLocaleString()} members` : "Discord server";

  return {
    status: "ok" as const,
    title: String(guild.name || "Discord server").slice(0, 80),
    subtitle,
    image: icon,
    href: httpsUrl(`https://discord.gg/${code}`),
    meta: { provider: "Discord" },
  };
}

// 4. Telegram
function telegramHandle(value: string): string | null {
  let text = value.trim().replace(/^@+/, "");
  try {
    const parsed = new URL(text.includes("://") ? text : `https://${text}`);
    if (["t.me", "www.t.me", "telegram.me"].includes(parsed.hostname.toLowerCase())) {
      const parts = parsed.pathname.split("/").filter((p) => p && p !== "s" && p !== "joinchat");
      text = parts[0] || "";
    }
  } catch {
    // not a URL
  }
  return HANDLE.test(text) ? text : null;
}

async function resolveTelegram(value: string) {
  const handle = telegramHandle(value);
  if (!handle) return { status: "error" as const, title: "Telegram", subtitle: "Use a @username or t.me link.", image: null, href: null, meta: {} };

  const href = httpsUrl(`https://t.me/${handle}`);
  const botToken = process.env.MISA_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    const res = await httpGet(`https://api.telegram.org/bot${botToken}/getChat`, { chat_id: `@${handle}` });
    if (res && res.ok) {
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const chat = payload?.result as Record<string, unknown> | undefined;
      if (chat && typeof chat === "object") {
        const title = String(chat.title || chat.username || handle).slice(0, 80);
        const subtitle = String(chat.type || "Telegram").slice(0, 40);
        return { status: "ok" as const, title, subtitle, image: null, href, meta: { provider: "Telegram" } };
      }
    }
  }
  return { status: "ok" as const, title: `@${handle}`, subtitle: "Telegram", image: null, href, meta: { provider: "Telegram" } };
}

// 5. Roblox
async function resolveRoblox(value: string) {
  const text = value.trim();
  let userId: string | null = null;
  let username = text;

  try {
    const parsed = new URL(text.includes("://") ? text : `https://${text}`);
    if (parsed.hostname.includes("roblox.com") && parsed.pathname.includes("/users/")) {
      const parts = parsed.pathname.split("/");
      const idx = parts.indexOf("users");
      if (idx !== -1 && idx + 1 < parts.length && /^\d+$/.test(parts[idx + 1])) {
        userId = parts[idx + 1];
      }
    }
  } catch {
    // not a URL
  }

  if (!userId) {
    const candidate = username.split("/").pop() || "";
    if (!HANDLE.test(candidate)) {
      return { status: "error" as const, title: "Roblox", subtitle: "Use a Roblox username.", image: null, href: null, meta: {} };
    }
    const res = await httpPost("https://users.roblox.com/v1/usernames/users", {
      usernames: [candidate],
      excludeBannedUsers: true,
    });
    if (!res || !res.ok) {
      return { status: "error" as const, title: "Roblox", subtitle: "That Roblox user was not found.", image: null, href: null, meta: {} };
    }
    const data = ((await res.json().catch(() => null)) as { data?: { id?: number; name?: string }[] })?.data;
    if (!data || !data.length || !data[0].id) {
      return { status: "error" as const, title: "Roblox", subtitle: "That Roblox user was not found.", image: null, href: null, meta: {} };
    }
    userId = String(data[0].id);
    username = data[0].name || username;
  }

  const [profileRes, thumbRes] = await Promise.all([
    httpGet(`https://users.roblox.com/v1/users/${userId}`),
    httpGet("https://thumbnails.roblox.com/v1/users/avatar-headshot", {
      userIds: userId,
      size: "150x150",
      format: "Png",
      isCircular: "false",
    }),
  ]);

  if (!profileRes || !profileRes.ok) {
    return { status: "error" as const, title: "Roblox", subtitle: "That Roblox user was not found.", image: null, href: null, meta: {} };
  }

  const info = (await profileRes.json().catch(() => null)) as Record<string, unknown> | null;
  let image: string | null = null;
  if (thumbRes && thumbRes.ok) {
    const thumbData = ((await thumbRes.json().catch(() => null)) as { data?: { imageUrl?: string }[] })?.data;
    if (thumbData && thumbData.length && thumbData[0].imageUrl) {
      image = httpsUrl(thumbData[0].imageUrl);
    }
  }

  return {
    status: "ok" as const,
    title: String(info?.displayName || info?.name || username).slice(0, 80),
    subtitle: `@${info?.name || username}`,
    image,
    href: httpsUrl(`https://www.roblox.com/users/${userId}/profile`),
    meta: { provider: "Roblox" },
  };
}

// 6. GitHub
async function resolveGithub(value: string) {
  let login = value.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(login.includes("://") ? login : `https://${login}`);
    if (parsed.hostname.includes("github.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      login = parts[0] || "";
    }
  } catch {
    // not a URL
  }

  if (!HANDLE.test(login)) {
    return { status: "error" as const, title: "GitHub", subtitle: "Use a GitHub username.", image: null, href: null, meta: {} };
  }

  const res = await httpGet(`https://api.github.com/users/${login}`);
  if (!res || !res.ok) {
    return { status: "error" as const, title: "GitHub", subtitle: "That GitHub user was not found.", image: null, href: null, meta: {} };
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const repos = Number(data?.public_repos || 0);
  const followers = Number(data?.followers || 0);

  return {
    status: "ok" as const,
    title: String(data?.name || data?.login || login).slice(0, 80),
    subtitle: `${repos} repos · ${followers} followers`,
    image: httpsUrl(data?.avatar_url),
    href: httpsUrl(data?.html_url || `https://github.com/${login}`),
    meta: { provider: "GitHub" },
  };
}

// 7. Last.fm
async function resolveLastfm(value: string) {
  const key = process.env.MISA_LASTFM_API_KEY || process.env.LASTFM_API_KEY;
  if (!key) {
    return { status: "error" as const, title: "Last.fm", subtitle: "Last.fm is not configured on the server.", image: null, href: null, meta: {} };
  }

  let user = value.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(user.includes("://") ? user : `https://${user}`);
    if (parsed.hostname.includes("last.fm")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      user = parts.length >= 2 && parts[0] === "user" ? parts[1] : parts[0] || "";
    }
  } catch {
    // not a URL
  }

  if (!HANDLE.test(user)) {
    return { status: "error" as const, title: "Last.fm", subtitle: "Use a Last.fm username.", image: null, href: null, meta: {} };
  }

  const res = await httpGet("https://ws.audioscrobbler.com/2.0/", {
    method: "user.getrecenttracks",
    user,
    api_key: key,
    format: "json",
    limit: "1",
  });
  if (!res || !res.ok) {
    return { status: "error" as const, title: "Last.fm", subtitle: "Last.fm did not return that user.", image: null, href: null, meta: {} };
  }

  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const recent = payload?.recenttracks as Record<string, unknown> | undefined;
  const trackList = Array.isArray(recent?.track) ? recent.track : recent?.track ? [recent.track] : [];
  const track = trackList[0] as Record<string, unknown> | undefined;

  if (!track || typeof track !== "object") {
    return {
      status: "ok" as const,
      title: user,
      subtitle: "No recent tracks",
      image: null,
      href: httpsUrl(`https://www.last.fm/user/${user}`),
      meta: { provider: "Last.fm" },
    };
  }

  let image: string | null = null;
  if (Array.isArray(track.image)) {
    for (const item of track.image) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).size === "large") {
        image = httpsUrl((item as Record<string, unknown>)["#text"]);
      }
    }
  }

  const artistObj = track.artist as Record<string, unknown> | string | undefined;
  const artistName = typeof artistObj === "object" ? String(artistObj?.["#text"] || "") : String(artistObj || "");
  const now = (track["@attr"] as Record<string, unknown> | undefined)?.nowplaying === "true";

  return {
    status: "ok" as const,
    title: String(track.name || "Last.fm").slice(0, 80),
    subtitle: `${now ? "Now playing" : "Last played"} · ${artistName || user}`.slice(0, 80),
    image,
    href: httpsUrl(track.url || `https://www.last.fm/user/${user}`),
    meta: { provider: "Last.fm" },
  };
}

// 8. Timezone
function resolveTimezone(value: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: value,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const now = new Date();
    const title = formatter.format(now);
    return Promise.resolve({
      status: "ok" as const,
      title,
      subtitle: value.replace(/_/g, " "),
      image: null,
      href: null,
      meta: { provider: "Timezone", iso: now.toISOString(), timezone: value },
    });
  } catch {
    return Promise.resolve({
      status: "error" as const,
      title: "Time",
      subtitle: "Use an IANA timezone like Europe/London.",
      image: null,
      href: null,
      meta: {},
    });
  }
}

// 9. Weather
async function resolveWeather(value: string) {
  const city = value.trim();
  if (!CITY.test(city)) {
    return { status: "error" as const, title: "Weather", subtitle: "Use a city name.", image: null, href: null, meta: {} };
  }

  const geoRes = await httpGet("https://geocoding-api.open-meteo.com/v1/search", {
    name: city,
    count: "1",
    language: "en",
    format: "json",
  });
  if (!geoRes || !geoRes.ok) {
    return { status: "error" as const, title: "Weather", subtitle: "That city was not found.", image: null, href: null, meta: {} };
  }

  const geoData = ((await geoRes.json().catch(() => null)) as { results?: Record<string, unknown>[] })?.results;
  if (!geoData || !geoData.length) {
    return { status: "error" as const, title: "Weather", subtitle: "That city was not found.", image: null, href: null, meta: {} };
  }

  const place = geoData[0];
  const forecastRes = await httpGet("https://api.open-meteo.com/v1/forecast", {
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,weather_code",
    timezone: "auto",
  });

  if (!forecastRes || !forecastRes.ok) {
    return { status: "error" as const, title: "Weather", subtitle: "Weather is unavailable right now.", image: null, href: null, meta: {} };
  }

  const forecastData = ((await forecastRes.json().catch(() => null)) as { current?: Record<string, unknown> })?.current;
  const code = Number(forecastData?.weather_code || 0);
  const temp = forecastData?.temperature_2m != null ? Number(forecastData.temperature_2m) : null;
  const label = WEATHER_LABELS[code] || "Weather";
  const nameParts = [place.name, place.country_code].filter(Boolean);
  const name = nameParts.join(", ");

  return {
    status: "ok" as const,
    title: temp !== null ? `${Math.round(temp)}°` : label,
    subtitle: `${label} · ${name}`.slice(0, 80),
    image: null,
    href: null,
    meta: { provider: "Weather" },
  };
}

export async function resolveWidget(item: Record<string, unknown>): Promise<ResolvedWidget> {
  const kind = String(item.type || "").toLowerCase();
  const value = String(item.value || "").trim();
  const base: ResolvedWidget = {
    id: item.id ? String(item.id) : undefined,
    type: kind,
    value,
    status: "empty",
    title: "",
    subtitle: "",
    image: null,
    href: null,
    meta: {},
  };

  if (!value) {
    return { ...base, status: "empty", subtitle: "Add a value in Customize." };
  }

  try {
    let result: Omit<ResolvedWidget, "id" | "type" | "value">;
    if (kind === "timezone") {
      result = await withCache(kind, value, TIME_TTL, () => resolveTimezone(value));
    } else {
      result = await withCache(kind, value, CACHE_TTL, async () => {
        switch (kind) {
          case "youtube": return resolveYoutube(value);
          case "spotify": return resolveSpotify(value);
          case "discord": return resolveDiscord(value);
          case "telegram": return resolveTelegram(value);
          case "roblox": return resolveRoblox(value);
          case "github": return resolveGithub(value);
          case "lastfm": return resolveLastfm(value);
          case "weather": return resolveWeather(value);
          default: return { status: "error" as const, title: "Widget", subtitle: "Unknown widget.", image: null, href: null, meta: {} };
        }
      });
    }
    return { ...base, ...result };
  } catch {
    return { ...base, status: "error", title: kind.charAt(0).toUpperCase() + kind.slice(1), subtitle: "Could not load this widget." };
  }
}

export function profileWidgetInputs(config: Record<string, unknown>): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const widgets = Array.isArray(config.widgets) ? config.widgets : [];
  for (const w of widgets) {
    if (w && typeof w === "object") items.push(w as Record<string, unknown>);
  }

  const sections = Array.isArray(config.sections) ? config.sections : [];
  for (const sec of sections) {
    if (!sec || typeof sec !== "object" || !(sec as Record<string, unknown>).enabled) continue;
    const s = sec as Record<string, unknown>;
    for (const [side, suffix] of [["leftCard", "l"], ["rightCard", "r"]] as const) {
      const card = s[side] as Record<string, unknown> | undefined;
      if (card && typeof card === "object" && card.enabled && card.type !== "presence") {
        items.push({ ...card, id: `${String(s.id || "").slice(0, 38)}-${suffix}` });
      }
    }
  }
  return items;
}

export async function resolveProfileWidgets(
  config: Record<string, unknown>,
  includeEmpty = false
): Promise<ResolvedWidget[]> {
  const pending: Record<string, unknown>[] = [];
  for (const item of profileWidgetInputs(config)) {
    if (!item.enabled) continue;
    if (!includeEmpty && !String(item.value || "").trim()) continue;
    pending.push(item);
  }

  if (!pending.length) return [];

  // Group unique (type, value) pairs so repeated items resolve in a single fetch
  const unique = new Map<string, Record<string, unknown>>();
  for (const item of pending) {
    const key = `${item.type}:${item.value}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  const resolvedMap = new Map<string, ResolvedWidget>();
  const resolvedList = await Promise.all(Array.from(unique.values()).map(resolveWidget));
  const uniqueKeys = Array.from(unique.keys());
  for (let i = 0; i < uniqueKeys.length; i++) {
    resolvedMap.set(uniqueKeys[i], resolvedList[i]);
  }

  return pending.map((item) => {
    const key = `${item.type}:${item.value}`;
    const res = resolvedMap.get(key)!;
    return { ...res, id: item.id ? String(item.id) : undefined };
  });
}
