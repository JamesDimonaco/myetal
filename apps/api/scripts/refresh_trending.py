#!/usr/bin/env python3
"""Recompute the `trending_shares` table from share_views.

Per discovery ticket D2. Time-decayed sum:

    score = SUM(EXP(-Δt_seconds / 259200.0))
            -- τ = 259200s (72h time constant; ~50h half-life)

over the last 14 days of share_views, only for `is_public + published_at IS
NOT NULL + deleted_at IS NULL`. INSERT ... ON CONFLICT DO UPDATE so the
table is idempotent — no truncate, no read-during-rebuild empty window.

In option 2 the table is populated but no UI reads from it yet (D6 — UI
deferred). It exists so when the trending homepage ships, history is
already there.

Run from cron @hourly (or @nightly — the τ=72h decay smooths short-window
flakiness).

Usage:
    uv run python -m scripts.refresh_trending
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings
from scripts._wrapper import run_script

_REFRESH_SQL = text(
    """
    INSERT INTO trending_shares (share_id, score, view_count_7d, refreshed_at)
    SELECT
        v.share_id,
        SUM(EXP(-EXTRACT(EPOCH FROM (now() - v.viewed_at)) / 259200.0)) AS score,
        COUNT(*) FILTER (WHERE v.viewed_at > now() - interval '7 days')  AS view_count_7d,
        now()                                                            AS refreshed_at
    FROM share_views v
    JOIN shares s ON s.id = v.share_id
    WHERE v.viewed_at > now() - interval '14 days'
      AND s.is_public = TRUE
      AND s.published_at IS NOT NULL
      AND s.deleted_at IS NULL
    GROUP BY v.share_id
    ON CONFLICT (share_id) DO UPDATE
        SET score         = EXCLUDED.score,
            view_count_7d = EXCLUDED.view_count_7d,
            refreshed_at  = EXCLUDED.refreshed_at;
    """
)


async def refresh() -> int:
    """Returns row count touched (insert + update)."""
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as session:
            result = await session.execute(_REFRESH_SQL)
            await session.commit()
            return result.rowcount or 0
    finally:
        await engine.dispose()


def main() -> int:
    try:
        touched = asyncio.run(run_script("refresh_trending", refresh))
    except Exception as exc:  # noqa: BLE001
        print(f"refresh_trending FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"trending_shares: {touched} rows refreshed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
