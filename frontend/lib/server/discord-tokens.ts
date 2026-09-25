import "server-only";
import { database } from "./postgres";
import { redis } from "./redis";
import { encryptDiscordSecret } from "./discord-secrets";
export async function storeDiscordTokens(userId: string, discordId: string, tokens: Record<string,unknown>) {
  if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) return;
  const access = typeof tokens.access_token === "string" && tokens.access_token ? encryptDiscordSecret(tokens.access_token) : null;
  const seconds = Number(tokens.expires_in || 604800);
  if (!Number.isFinite(seconds)) throw new Error("Invalid token lifetime");
  // Preserve existing display preferences on relinking; new links default to hidden.
  await database().query(`INSERT INTO discord_links (user_id,discord_id,refresh_token,access_token,access_expires_at,show_avatar,show_decoration,show_guild_tag,updated_at)
    VALUES ($1,$2,$3,$4,$5,FALSE,FALSE,FALSE,NOW()) ON CONFLICT(user_id) DO UPDATE SET discord_id=EXCLUDED.discord_id,refresh_token=EXCLUDED.refresh_token,access_token=EXCLUDED.access_token,access_expires_at=EXCLUDED.access_expires_at,updated_at=NOW()`,[userId,discordId,encryptDiscordSecret(tokens.refresh_token),access,new Date(Date.now()+Math.max(60,seconds-60)*1000)]);
  const client=redis(); if(client.status==="wait")await client.connect(); await client.del(`discord:live:${userId}`);
}
