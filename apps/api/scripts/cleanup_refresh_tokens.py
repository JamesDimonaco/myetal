#!/usr/bin/env python3
"""Delete revoked or expired refresh tokens.

Run from cron @daily — the `refresh_tokens` table grows monotonically
otherwise (every login + every refresh adds a row, and rotated tokens are
left in place for replay-detection auditing).

Exit code 0 on success, non-zero on failure. Prints the deleted count to
stdout (so cron-mailto / journalctl shows something useful).

Usage:
    uv run python -m scripts.cleanup_refresh_tokens
    # or
    docker exec myetal-api python -m scripts.cleanup_refresh_tokens
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime

from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings
from myetal_api.models import RefreshToken


async def cleanup() -> int:
    """Delete revoked OR expired refresh tokens. Returns row count."""
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as session:
            result = await session.execute(
                delete(RefreshToken).where(
                    or_(
                        RefreshToken.revoked.is_(True),
                        RefreshToken.expires_at < datetime.now(UTC),
                    )
                )
            )
            await session.commit()
            # rowcount is -1 on some drivers; treat that as 'unknown' rather than crashing
            return result.rowcount or 0
    finally:
        await engine.dispose()


def main() -> int:
    try:
        deleted = asyncio.run(cleanup())
    except Exception as exc:  # noqa: BLE001 — top-level CLI, log + exit
        print(f"cleanup_refresh_tokens FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"deleted {deleted} refresh token rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
