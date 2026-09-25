"""Small async-friendly Cloudflare R2 storage adapter with local development fallback."""

import asyncio
import os
from pathlib import Path
from urllib.parse import quote

from app.core.config import Settings

LOCAL_STORAGE_DIR = Path(os.getenv("MISA_LOCAL_STORAGE_DIR", "/tmp/misa_uploads"))


class R2Storage:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def r2_configured(self) -> bool:
        return bool(
            self.settings.r2_endpoint
            and self.settings.r2_bucket
            and self.settings.r2_access_key_id
            and self.settings.r2_secret_access_key
            and self.settings.r2_public_base_url
        )

    @property
    def enabled(self) -> bool:
        return True

    def public_url(self, key: str) -> str:
        if self.r2_configured:
            return f"{self.settings.r2_public_base_url.rstrip('/')}/{quote(key, safe='/')}"
        return f"/api/v1/profile/uploads/{quote(key, safe='/')}"

    def _client(self):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise RuntimeError("R2 support is not installed.") from exc
        return boto3.client(
            "s3",
            endpoint_url=self.settings.r2_endpoint,
            aws_access_key_id=self.settings.r2_access_key_id,
            aws_secret_access_key=self.settings.r2_secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4", max_pool_connections=4),
        )

    async def put(self, key: str, body: bytes, content_type: str) -> None:
        if self.r2_configured:
            def write() -> None:
                self._client().put_object(
                    Bucket=self.settings.r2_bucket,
                    Key=key,
                    Body=body,
                    ContentType=content_type,
                    CacheControl="public, max-age=31536000, immutable",
                )
            await asyncio.to_thread(write)
            return

        def write_local() -> None:
            target = (LOCAL_STORAGE_DIR / key).resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            meta = target.with_suffix(target.suffix + ".meta")
            meta.write_text(content_type, encoding="utf-8")

        await asyncio.to_thread(write_local)

    async def delete(self, key: str) -> None:
        if self.r2_configured:
            def remove() -> None:
                self._client().delete_object(Bucket=self.settings.r2_bucket, Key=key)
            await asyncio.to_thread(remove)
            return

        def remove_local() -> None:
            target = (LOCAL_STORAGE_DIR / key).resolve()
            if target.exists():
                target.unlink()
            meta = target.with_suffix(target.suffix + ".meta")
            if meta.exists():
                meta.unlink()

        await asyncio.to_thread(remove_local)


def get_r2_storage(settings: Settings) -> R2Storage:
    return R2Storage(settings)