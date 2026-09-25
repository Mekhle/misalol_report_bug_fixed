"""Connect Constellations to Misa's sessions, profile service, and account directory."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, Request

from app.core.profiles import resolve_public_profile
from app.core.rate_limit import client_ip, rate_limit
from app.core.sessions import get_user_from_request
from app.db import data_api
from app.models import User
from .repository import ConstellationRepository
from .router import create_router
from .web import install_constellation_web


def _active(user: User | None) -> User | None:
    if user is None or not user.username or user.currently_suspended:
        return None
    return user


def install_constellations(application, _database_path: str | Path | None = None) -> None:
    async def authenticate(request: Request) -> User:
        user = _active(await get_user_from_request(request))
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to manage Constellations.")
        await rate_limit(f"rl:constellations:{user.id}", 180, 300)
        return user

    async def lookup(username: str) -> User | None:
        return _active(await data_api.find_user(username=username.strip().lower()))

    repository = ConstellationRepository(profile_resolver=resolve_public_profile)
    application.include_router(create_router(repository, authenticate=authenticate, user_lookup=lookup))
    application.state.constellations = repository
    install_constellation_web(application)
