from redis.asyncio import Redis

_client: Redis | None = None


def init_dragonfly(url: str) -> Redis:
    global _client
    _client = Redis.from_url(url, decode_responses=True)
    return _client


def get_dragonfly() -> Redis:
    if _client is None:
        raise RuntimeError("Dragonfly is not initialised")
    return _client


async def close_dragonfly() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None
