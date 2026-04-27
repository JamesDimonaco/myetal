#!/usr/bin/env python3
"""Recompute the `share_similar` precompute table.

Per discovery ticket D9 + D-S-Iss1. Truncate-then-rebuild from `share_papers`,
storing only canonical-ordered pairs (`share_id_a < share_id_b`) — the read
query unions both directions.

Run from cron @nightly. The truncate creates a brief empty window during
the rebuild; the read paths tolerate this (panel renders empty for the
fraction of a second the cron holds the table). For a real concurrency
story we'd build into a staging table and rename — premature for v1.

Exit code 0 on success, non-zero on failure.

Usage:
    uv run python -m scripts.refresh_similar_shares
    # or
    docker exec myetal-api python -m scripts.refresh_similar_shares
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings

_REBUILD_SQL = text(
    """
    TRUNCATE TABLE share_similar;

    INSERT INTO share_similar (share_id_a, share_id_b, papers_in_common, refreshed_at)
    SELECT
        sp1.share_id AS share_id_a,
        sp2.share_id AS share_id_b,
        COUNT(*)     AS papers_in_common,
        now()        AS refreshed_at
    FROM share_papers sp1
    JOIN share_papers sp2
        ON sp1.paper_id = sp2.paper_id
       AND sp1.share_id < sp2.share_id  -- canonical ordering, halves work
    JOIN shares s1 ON s1.id = sp1.share_id
    JOIN shares s2 ON s2.id = sp2.share_id
    WHERE s1.is_public = TRUE
      AND s1.published_at IS NOT NULL
      AND s1.deleted_at IS NULL
      AND s2.is_public = TRUE
      AND s2.published_at IS NOT NULL
      AND s2.deleted_at IS NULL
    GROUP BY sp1.share_id, sp2.share_id;
    """
)


async def refresh() -> int:
    """Returns row count inserted."""
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as session:
            await session.execute(_REBUILD_SQL)
            await session.commit()
            count_row = await session.execute(text("SELECT COUNT(*) FROM share_similar"))
            return count_row.scalar_one()
    finally:
        await engine.dispose()


def main() -> int:
    try:
        rows = asyncio.run(refresh())
    except Exception as exc:  # noqa: BLE001
        print(f"refresh_similar_shares FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"share_similar now has {rows} canonical pairs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
