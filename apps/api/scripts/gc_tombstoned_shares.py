#!/usr/bin/env python3
"""Permanently delete shares tombstoned more than 30 days ago.

Per discovery ticket D14. The 30-day window is enough for crawlers to
recrawl the URL, see the 410 Gone response, and drop the URL from their
index. After the actual DELETE, the FK CASCADE clears `share_items`,
`share_papers`, `share_views`, `share_similar`, `trending_shares`, and
`share_reports` rows for the gone share.

Run from cron @daily.

Usage:
    uv run python -m scripts.gc_tombstoned_shares
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings
from myetal_api.models import Share

_TOMBSTONE_GRACE = timedelta(days=30)


async def gc() -> int:
    cutoff = datetime.now(UTC) - _TOMBSTONE_GRACE
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as session:
            result = await session.execute(
                delete(Share).where(
                    Share.deleted_at.is_not(None),
                    Share.deleted_at < cutoff,
                )
            )
            await session.commit()
            return result.rowcount or 0
    finally:
        await engine.dispose()


def main() -> int:
    try:
        deleted = asyncio.run(gc())
    except Exception as exc:  # noqa: BLE001
        print(f"gc_tombstoned_shares FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"deleted {deleted} share rows tombstoned more than 30 days ago")
    return 0


if __name__ == "__main__":
    sys.exit(main())
