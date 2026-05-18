#!/usr/bin/env python3
"""Delete share_views rows older than 90 days.

Per discovery ticket D3 + privacy policy retention. View events are kept
for 90 days so the trending cron has its 14-day window of history with
plenty of slack; beyond that they have no analytical value and stack up
storage cost.

Run from cron @daily.

Usage:
    uv run python -m scripts.prune_share_views
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings
from myetal_api.models import ShareView
from scripts._wrapper import run_script

_RETENTION = timedelta(days=90)


async def prune() -> int:
    cutoff = datetime.now(UTC) - _RETENTION
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as session:
            result = await session.execute(delete(ShareView).where(ShareView.viewed_at < cutoff))
            await session.commit()
            return result.rowcount or 0
    finally:
        await engine.dispose()


def main() -> int:
    try:
        deleted = asyncio.run(run_script("prune_share_views", prune))
    except Exception as exc:  # noqa: BLE001
        print(f"prune_share_views FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"deleted {deleted} share_views rows older than 90 days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
