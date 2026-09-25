from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class User:
    id: str
    account_id: str | None = None
    email: str | None = None
    email_verified: bool = False
    password_hash: str | None = None
    username: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    google_id: str | None = None
    discord_id: str | None = None
    telegram_id: str | None = None
    telegram_username: str | None = None
    apple_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    last_login_at: str | None = None
    is_admin: bool = False
    suspended_at: str | None = None
    suspension_reason: str | None = None
    suspended_until: str | None = None

    @property
    def currently_suspended(self) -> bool:
        if not self.suspended_at:
            return False
        if not self.suspended_until:
            return True
        try:
            until = datetime.fromisoformat(self.suspended_until.replace("Z", "+00:00"))
            return until > utcnow()
        except ValueError:
            return True

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> User:
        return cls(
            id=str(data["id"]),
            account_id=data.get("account_id"),
            email=data.get("email"),
            email_verified=bool(data.get("email_verified")),
            password_hash=data.get("password_hash"),
            username=data.get("username"),
            display_name=data.get("display_name"),
            avatar_url=data.get("avatar_url"),
            google_id=data.get("google_id"),
            discord_id=data.get("discord_id"),
            telegram_id=data.get("telegram_id"),
            telegram_username=data.get("telegram_username"),
            apple_id=data.get("apple_id"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
            last_login_at=data.get("last_login_at"),
            is_admin=bool(data.get("is_admin")),
            suspended_at=data.get("suspended_at"),
            suspension_reason=data.get("suspension_reason"),
            suspended_until=data.get("suspended_until"),
        )

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "email": self.email,
            "email_verified": self.email_verified,
            "username": self.username,
            "display_name": self.display_name,
            "avatar_url": self.avatar_url,
            "telegram_username": self.telegram_username,
            "providers": {
                "email": bool(self.password_hash),
                "google": bool(self.google_id),
                "discord": bool(self.discord_id),
                "telegram": bool(self.telegram_id),
                "apple": bool(self.apple_id),
            },
            "created_at": self.created_at,
            "last_login_at": self.last_login_at,
            "is_admin": self.is_admin,
            "suspended_at": self.suspended_at,
            "suspension_reason": self.suspension_reason,
            "suspended_until": self.suspended_until,
        }
