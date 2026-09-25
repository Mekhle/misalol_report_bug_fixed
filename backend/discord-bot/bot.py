"""Misa Discord presence bot.

Stays connected to one or more guilds, writes each member's Discord status
into Redis, and the website reads that on live cards.

Env:
  MISA_DISCORD_BOT_TOKEN   bot token (required to connect)
  MISA_DISCORD_GUILD_ID    optional comma-separated guild ids to watch
  DRAGONFLY_URL            redis://... (same store the API uses)
  DISCORD_PRESENCE_TTL     seconds to keep a presence key (default 3 days)

In the Discord developer portal enable Privileged Gateway Intents:
  Server Members Intent, Presence Intent.
Invite the bot with the Server Members intent (guild members + presence).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import discord
import redis.asyncio as redis

log = logging.getLogger("misa.discord-bot")

PRESENCE_PREFIX = "discord:presence:"
STATUSES = {"online", "idle", "dnd", "offline"}
DEFAULT_TTL = 60 * 60 * 24 * 3


def env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def watched_guilds() -> set[int]:
    raw = env("MISA_DISCORD_GUILD_ID", "DISCORD_GUILD_ID")
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return ids


def normalize_status(value: object) -> str:
    status = str(getattr(value, "value", value) or "offline").lower()
    if status == "invisible":
        return "offline"
    return status if status in STATUSES else "offline"


def presence_key(user_id: int | str) -> str:
    return f"{PRESENCE_PREFIX}{user_id}"


class PresenceBot(discord.Client):
    def __init__(self, store: redis.Redis, guild_ids: set[int], ttl: int) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.members = True
        intents.presences = True
        super().__init__(intents=intents, chunk_guilds_at_startup=True)
        self.store = store
        self.guild_ids = guild_ids
        self.ttl = ttl

    def watches(self, guild_id: int | None) -> bool:
        if guild_id is None:
            return False
        return not self.guild_ids or guild_id in self.guild_ids

    async def write_member(self, member: discord.Member) -> None:
        if member.bot:
            return
        payload = {
            "status": normalize_status(member.status),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        await self.store.set(presence_key(member.id), json.dumps(payload), ex=self.ttl)

    async def drop_member(self, user_id: int) -> None:
        await self.store.delete(presence_key(user_id))

    async def snapshot_guild(self, guild: discord.Guild) -> int:
        written = 0
        for member in guild.members:
            await self.write_member(member)
            written += 1
        return written

    async def setup_hook(self) -> None:
        log.info("discord gateway starting")

    async def on_ready(self) -> None:
        log.info("logged in as %s", self.user)
        for guild in self.guilds:
            if not self.watches(guild.id):
                log.info("skipping guild %s (%s)", guild.name, guild.id)
                continue
            count = await self.snapshot_guild(guild)
            log.info("cached %s members from %s (%s)", count, guild.name, guild.id)

    async def on_presence_update(self, _before: discord.Member, after: discord.Member) -> None:
        if after.guild and self.watches(after.guild.id):
            await self.write_member(after)

    async def on_member_join(self, member: discord.Member) -> None:
        if member.guild and self.watches(member.guild.id):
            await self.write_member(member)

    async def on_member_remove(self, member: discord.Member) -> None:
        if member.guild and self.watches(member.guild.id):
            await self.drop_member(member.id)


async def run() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    token = env("MISA_DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN")
    redis_url = env("DRAGONFLY_URL", "REDIS_URL", default="redis://127.0.0.1:6379/0")
    ttl = max(60, int(env("DISCORD_PRESENCE_TTL", default=str(DEFAULT_TTL)) or DEFAULT_TTL))
    if not token:
        log.warning("MISA_DISCORD_BOT_TOKEN is empty; presence bot idle")
        await asyncio.Event().wait()
        return
    store = redis.from_url(redis_url, decode_responses=True)
    await store.ping()
    log.info("redis ready")
    bot = PresenceBot(store, watched_guilds(), ttl)
    try:
        await bot.start(token)
    finally:
        await bot.close()
        await store.aclose()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
