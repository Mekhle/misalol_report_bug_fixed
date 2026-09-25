#!/usr/bin/env python3
"""One-time, repeatable migration of Base64 profile media to Cloudflare R2.

The command is a dry run unless --apply is supplied. It never deletes database
rows or R2 objects and replaces only supported Base64 media strings in the
existing profile JSON document.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import copy
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
import re
import sys
from typing import Any, Iterable


# Running ``python /app/scripts/migrate_media_to_r2.py`` sets sys.path[0] to
# /app/scripts. Add /app so the same app package used by the API is importable.
APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))


REQUIRED_R2_BUCKET = "misa-media"
REQUIRED_R2_PUBLIC_BASE_URL = "https://r2.misa.lol"
R2_URL_PREFIX = f"{REQUIRED_R2_PUBLIC_BASE_URL}/"
DATA_URL_RE = re.compile(r"^data:([^;,]+);base64,(.*)$", re.IGNORECASE | re.DOTALL)

# Match the media types already accepted by the profile API/sanitizer. Unknown
# Base64 data URLs are reported and left untouched.
MEDIA_TYPES: dict[str, tuple[str, str]] = {
    "image/png": ("image", ".png"),
    "image/jpeg": ("image", ".jpg"),
    "image/jpg": ("image", ".jpg"),
    "image/webp": ("image", ".webp"),
    "image/gif": ("image", ".gif"),
    "image/x-icon": ("image", ".ico"),
    "image/vnd.microsoft.icon": ("image", ".ico"),
    "video/mp4": ("video", ".mp4"),
    "video/webm": ("video", ".webm"),
    "video/quicktime": ("video", ".mov"),
    "video/x-m4v": ("video", ".m4v"),
    "audio/mpeg": ("audio", ".mp3"),
    "audio/mp3": ("audio", ".mp3"),
    "audio/wav": ("audio", ".wav"),
    "audio/x-wav": ("audio", ".wav"),
    "audio/ogg": ("audio", ".ogg"),
    "audio/webm": ("audio", ".webm"),
    "audio/mp4": ("audio", ".m4a"),
    "audio/x-m4a": ("audio", ".m4a"),
    "audio/m4a": ("audio", ".m4a"),
    "audio/aac": ("audio", ".aac"),
    "font/woff": ("font", ".woff"),
    "font/woff2": ("font", ".woff2"),
    "font/ttf": ("font", ".ttf"),
    "font/otf": ("font", ".otf"),
    "font/opentype": ("font", ".otf"),
    "font/sfnt": ("font", ".ttf"),
    "application/font-woff": ("font", ".woff"),
    "application/font-woff2": ("font", ".woff2"),
    "application/x-font-woff": ("font", ".woff"),
    "application/x-font-ttf": ("font", ".ttf"),
    "application/x-font-otf": ("font", ".otf"),
    "application/vnd.ms-opentype": ("font", ".eot"),
}


JsonPath = tuple[str | int, ...]


@dataclass(frozen=True)
class MediaCandidate:
    path: JsonPath
    mime: str
    category: str
    extension: str
    body: bytes
    digest: str


@dataclass
class ScanResult:
    candidates: list[MediaCandidate] = field(default_factory=list)
    already_r2: int = 0
    unsupported_data_urls: int = 0
    invalid_data_urls: list[tuple[JsonPath, str]] = field(default_factory=list)


@dataclass
class Totals:
    scanned_profiles: int = 0
    profiles_with_legacy_media: int = 0
    migrated_profiles: int = 0
    migrated_assets: int = 0
    uploaded_objects: int = 0
    already_r2: int = 0
    unsupported_data_urls: int = 0
    failed_profiles: int = 0
    failed_assets: int = 0


def json_path(path: JsonPath) -> str:
    parts = ["$"]
    for item in path:
        if isinstance(item, int):
            parts.append(f"[{item}]")
        elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", item):
            parts.append(f".{item}")
        else:
            parts.append(f"[{item!r}]")
    return "".join(parts)


def _decode_media_data_url(value: str) -> tuple[str, str, str, bytes] | None:
    match = DATA_URL_RE.match(value.strip())
    if not match:
        return None
    mime = match.group(1).lower()
    media = MEDIA_TYPES.get(mime)
    if media is None:
        return mime, "", "", b""
    encoded = re.sub(r"\s+", "", match.group(2))
    try:
        body = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("invalid Base64 payload") from None
    if not body:
        raise ValueError("empty Base64 payload")
    return mime, media[0], media[1], body


def scan_profile_document(document: Any) -> ScanResult:
    """Find supported media recursively without changing the input document."""
    result = ScanResult()

    def visit(value: Any, path: JsonPath) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                visit(nested, path + (str(key),))
            return
        if isinstance(value, list):
            for index, nested in enumerate(value):
                visit(nested, path + (index,))
            return
        if not isinstance(value, str):
            return
        text = value.strip()
        if text.startswith(R2_URL_PREFIX):
            result.already_r2 += 1
            return
        if not text.lower().startswith("data:") or ";base64," not in text[:256].lower():
            return
        try:
            decoded = _decode_media_data_url(text)
        except ValueError as exc:
            header = text.split(",", 1)[0][:120]
            result.invalid_data_urls.append((path, f"{header}: {exc}"))
            return
        if decoded is None:
            return
        mime, category, extension, body = decoded
        if not category:
            result.unsupported_data_urls += 1
            return
        result.candidates.append(
            MediaCandidate(
                path=path,
                mime=mime,
                category=category,
                extension=extension,
                body=body,
                digest=sha256(body).hexdigest(),
            )
        )

    visit(document, ())
    return result


def object_key(user_id: str, candidate: MediaCandidate) -> str:
    return (
        f"profiles/{user_id}/legacy/{candidate.category}/"
        f"{candidate.digest[:2]}/{candidate.digest}{candidate.extension}"
    )


def replace_paths(document: Any, replacements: Iterable[tuple[JsonPath, str]]) -> Any:
    """Return a deep copy with only the selected scalar paths replaced."""
    updated = copy.deepcopy(document)
    for path, replacement in replacements:
        target = updated
        for component in path[:-1]:
            target = target[component]
        target[path[-1]] = replacement
    return updated


def _validate_configuration(settings: Any, storage: Any) -> None:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured in the API container.")
    if not storage.enabled:
        raise RuntimeError("R2 is not fully configured in the API container.")
    if settings.r2_bucket != REQUIRED_R2_BUCKET:
        raise RuntimeError(
            f"R2_BUCKET must be {REQUIRED_R2_BUCKET!r}; got {settings.r2_bucket!r}."
        )
    configured_base = settings.r2_public_base_url.rstrip("/")
    if configured_base != REQUIRED_R2_PUBLIC_BASE_URL:
        raise RuntimeError(
            "R2_PUBLIC_BASE_URL must be "
            f"{REQUIRED_R2_PUBLIC_BASE_URL!r}; got {configured_base!r}."
        )


async def migrate_profile(
    *,
    user_id: str,
    config: dict[str, Any],
    apply: bool,
    storage: Any,
    admin_db: Any,
    totals: Totals,
) -> None:
    scan = scan_profile_document(config)
    totals.already_r2 += scan.already_r2
    totals.unsupported_data_urls += scan.unsupported_data_urls
    if scan.invalid_data_urls:
        totals.failed_profiles += 1
        totals.failed_assets += len(scan.invalid_data_urls)
        for path, error in scan.invalid_data_urls:
            print(f"ERROR user={user_id} path={json_path(path)} {error}")
        return
    if not scan.candidates:
        return

    totals.profiles_with_legacy_media += 1
    replacements: list[tuple[JsonPath, str]] = []
    unique_uploads: dict[str, MediaCandidate] = {}
    for candidate in scan.candidates:
        key = object_key(user_id, candidate)
        url = storage.public_url(key)
        if not url.startswith(R2_URL_PREFIX):
            totals.failed_profiles += 1
            totals.failed_assets += 1
            print(f"ERROR user={user_id} generated an invalid public URL: {url}")
            return
        replacements.append((candidate.path, url))
        unique_uploads.setdefault(key, candidate)
        action = "MIGRATE" if apply else "WOULD_MIGRATE"
        print(
            f"{action} user={user_id} path={json_path(candidate.path)} "
            f"mime={candidate.mime} bytes={len(candidate.body)} url={url}"
        )

    if not apply:
        totals.migrated_profiles += 1
        totals.migrated_assets += len(scan.candidates)
        return

    try:
        for key, candidate in unique_uploads.items():
            await storage.put(key, candidate.body, candidate.mime)
            totals.uploaded_objects += 1
    except Exception as exc:
        totals.failed_profiles += 1
        totals.failed_assets += len(scan.candidates)
        print(f"ERROR user={user_id} R2 upload failed: {type(exc).__name__}: {exc}")
        return

    updated = replace_paths(config, replacements)
    try:
        replaced = await admin_db.replace_profile_config_for_media_migration(
            user_id,
            config,
            updated,
        )
    except Exception as exc:
        totals.failed_profiles += 1
        totals.failed_assets += len(scan.candidates)
        print(f"ERROR user={user_id} database update failed: {type(exc).__name__}: {exc}")
        return
    if not replaced:
        totals.failed_profiles += 1
        totals.failed_assets += len(scan.candidates)
        print(
            f"ERROR user={user_id} profile changed during migration; "
            "database update was skipped and can be retried safely."
        )
        return

    totals.migrated_profiles += 1
    totals.migrated_assets += len(scan.candidates)


async def run(args: argparse.Namespace) -> int:
    from app.core.config import get_settings
    from app.core.r2_storage import get_r2_storage
    from app.db import admin_db

    settings = get_settings()
    storage = get_r2_storage(settings)
    _validate_configuration(settings, storage)
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"mode={mode} bucket={settings.r2_bucket} "
        f"public_base={settings.r2_public_base_url.rstrip('/')}"
    )
    if not args.apply:
        print("No R2 objects or database rows will be changed.")

    totals = Totals()
    await admin_db.init_admin_db(settings.database_url, initialize_schema=False)
    try:
        after_user_id: str | None = None
        while True:
            profiles = await admin_db.list_profiles_for_media_migration(
                after_user_id=after_user_id,
                limit=args.batch_size,
            )
            if not profiles:
                break
            for profile in profiles:
                user_id = str(profile["user_id"])
                after_user_id = user_id
                config = profile.get("config")
                totals.scanned_profiles += 1
                if not isinstance(config, dict):
                    totals.failed_profiles += 1
                    print(f"ERROR user={user_id} profile config is not a JSON object; skipped.")
                    continue
                await migrate_profile(
                    user_id=user_id,
                    config=config,
                    apply=args.apply,
                    storage=storage,
                    admin_db=admin_db,
                    totals=totals,
                )
    finally:
        await admin_db.close_admin_db()

    label = "migrated" if args.apply else "would_migrate"
    print("\nMigration summary")
    print(f"  mode: {mode}")
    print(f"  scanned_profiles: {totals.scanned_profiles}")
    print(f"  profiles_with_legacy_media: {totals.profiles_with_legacy_media}")
    print(f"  {label}_profiles: {totals.migrated_profiles}")
    print(f"  {label}_assets: {totals.migrated_assets}")
    print(f"  uploaded_objects: {totals.uploaded_objects}")
    print(f"  skipped_already_r2: {totals.already_r2}")
    print(f"  skipped_unsupported_data_urls: {totals.unsupported_data_urls}")
    print(f"  failed_profiles: {totals.failed_profiles}")
    print(f"  failed_assets: {totals.failed_assets}")
    return 1 if totals.failed_profiles else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="inspect and report only (default)",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="upload media and atomically replace Base64 values in profile JSON",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        choices=range(1, 501),
        metavar="1-500",
        help="number of profile rows read per database batch (default: 100)",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        print("Interrupted; no cleanup or deletion was performed.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Migration stopped: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
