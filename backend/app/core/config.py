from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        case_sensitive=False,
        env_prefix="MISA_",
        populate_by_name=True,
    )

    app_name: str = "misa"
    app_version: str = "0.1.0"
    environment: str = "production"
    debug: bool = False
    instance_name: str = "api"
    api_v1_prefix: str = "/api/v1"
    domain: str = "misa.lol"
    public_base_url: str = "https://misa.lol"
    dashboard_url: str = "/dashboard"
    admin_public_url: str = "https://ukvhq.dev/m"
    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL", "MISA_DATABASE_URL"))

    data_api_url: str = Field(
        default="http://data-api:8080",
        validation_alias=AliasChoices("DATA_API_URL", "MISA_DATA_API_URL"),
    )
    data_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("DATA_API_KEY", "MISA_DATA_API_KEY"),
    )
    dragonfly_url: str = Field(
        default="redis://dragonfly:6379/0",
        validation_alias=AliasChoices("DRAGONFLY_URL", "MISA_DRAGONFLY_URL"),
    )

    cors_origins: str = "http://localhost,http://localhost:80,https://misa.lol,https://www.misa.lol"
    trusted_hosts: str = "misa.lol,www.misa.lol,ukvhq.dev,localhost,127.0.0.1,api"

    session_cookie_name: str = "misa_session"
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    session_remember_ttl_seconds: int = 60 * 60 * 24 * 30

    google_client_id: str = ""
    google_client_secret: str = ""
    discord_client_id: str = ""
    discord_client_secret: str = ""
    discord_server_invite: str = ""
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    apple_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_APPLE_CLIENT_ID", "APPLE_CLIENT_ID"),
    )
    apple_team_id: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_APPLE_TEAM_ID", "APPLE_TEAM_ID"),
    )
    apple_key_id: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_APPLE_KEY_ID", "APPLE_KEY_ID"),
    )
    apple_private_key: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_APPLE_PRIVATE_KEY", "APPLE_PRIVATE_KEY"),
    )
    apple_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_APPLE_CLIENT_SECRET", "APPLE_CLIENT_SECRET"),
    )
    lastfm_api_key: str = ""
    turnstile_site_key: str = ""
    turnstile_secret_key: str = ""
    admin_user_ids: str = ""
    admin_root_email: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_ADMIN_ROOT_EMAIL", "SUPER_ADMIN_EMAIL", "ADMIN_ROOT_EMAIL"),
    )
    admin_token_secret: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_ADMIN_TOKEN_SECRET", "ADMIN_TOKEN_SECRET"),
    )
    r2_account_id: str = Field(default="", validation_alias=AliasChoices("MISA_R2_ACCOUNT_ID", "R2_ACCOUNT_ID"))
    r2_bucket: str = Field(default="", validation_alias=AliasChoices("MISA_R2_BUCKET", "R2_BUCKET"))
    r2_access_key_id: str = Field(default="", validation_alias=AliasChoices("MISA_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"))
    r2_secret_access_key: str = Field(default="", validation_alias=AliasChoices("MISA_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"))
    r2_endpoint: str = Field(default="", validation_alias=AliasChoices("MISA_R2_ENDPOINT", "R2_ENDPOINT"))
    r2_public_base_url: str = Field(default="", validation_alias=AliasChoices("MISA_R2_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"))
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    storage_bucket: str = "misa-assets"
    media_fetch_hosts: str = ""
    email_api_url: str = Field(
        default="https://api.resend.com/emails",
        validation_alias=AliasChoices("MISA_EMAIL_API_URL", "EMAIL_API_URL"),
    )
    email_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MISA_EMAIL_API_KEY", "EMAIL_API_KEY"),
    )
    email_from: str = Field(
        default="Misa.lol <no-reply@misa.lol>",
        validation_alias=AliasChoices("MISA_EMAIL_FROM", "EMAIL_FROM"),
    )
    max_profile_tracks: int = 8
    max_track_upload_bytes: int = 40_000_000

    switcher_cookie_name: str = "misa_switcher"
    switcher_ttl_seconds: int = 60 * 60 * 24 * 90

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]

    @property
    def media_fetch_host_list(self) -> list[str]:
        return [host.strip() for host in self.media_fetch_hosts.split(",") if host.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def discord_enabled(self) -> bool:
        return bool(self.discord_client_id and self.discord_client_secret)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_bot_username)

    @property
    def apple_enabled(self) -> bool:
        return bool(self.apple_client_id)

    @property
    def telegram_bot_id(self) -> str:
        return self.telegram_bot_token.split(":", 1)[0] if self.telegram_bot_token else ""

    @property
    def admin_user_id_list(self) -> set[str]:
        return {value.strip() for value in self.admin_user_ids.split(",") if value.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
