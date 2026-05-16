"""Small wrapper that records cron-script runs into ``script_runs``.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

Usage:

    # in scripts/refresh_trending.py
    from scripts._wrapper import run_script

    async def refresh() -> int:
        ...

    def main() -> int:
        return asyncio.run(run_script("refresh_trending", refresh))

The wrapper opens a fresh DB session, inserts a ``script_runs`` row in
``status="running"``, runs the body, and updates the row with the
finish state. On exception it records ``status="failed"`` with the
error message + still re-raises so the cron's exit code reflects
reality.

Designed to be drop-in for the existing scripts — body callable
returns ``int`` (the row count) per their existing signature, and the
return value becomes the script's exit code (0 on success).

If recording the run fails (DB unavailable) the wrapper LOGS but does
not block the script body. Operational telemetry should never take
down the work.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myetal_api.core.config import settings
from myetal_api.models import ScriptRun

logger = logging.getLogger(__name__)

T = TypeVar("T")


async def run_script(name: str, body: Callable[[], Awaitable[int]]) -> int:
    """Run `body()` and record start/finish into ``script_runs``.

    Returns the body's return value unchanged (typically the row count
    the script processed). Failures propagate after the row is updated.

    Engine is created inline rather than reused from
    ``core/database.SessionLocal`` because scripts run outside the
    FastAPI process (cron) and we want the connection cleaned up at
    function exit rather than living for the script's process lifetime.
    """
    engine = create_async_engine(settings.database_url)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    run_id = None
    started = datetime.now(UTC)
    t0 = time.perf_counter()
    try:
        try:
            async with SessionLocal() as session:
                row = ScriptRun(name=name, started_at=started, status="running")
                session.add(row)
                await session.commit()
                run_id = row.id
        except Exception as exc:  # noqa: BLE001
            logger.warning("script_runs insert failed for %s: %s", name, exc)

        rows_processed = await body()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if run_id is not None:
            try:
                async with SessionLocal() as session:
                    row = await session.get(ScriptRun, run_id)
                    if row is not None:
                        row.finished_at = datetime.now(UTC)
                        row.duration_ms = elapsed_ms
                        row.row_count = int(rows_processed)
                        row.status = "ok"
                        await session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("script_runs finalise failed for %s: %s", name, exc)
        return rows_processed
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        if run_id is not None:
            try:
                async with SessionLocal() as session:
                    row = await session.get(ScriptRun, run_id)
                    if row is not None:
                        row.finished_at = datetime.now(UTC)
                        row.duration_ms = elapsed_ms
                        row.status = "failed"
                        row.error = str(exc)[:1000]
                        await session.commit()
            except Exception as inner:  # noqa: BLE001
                logger.warning("script_runs failure-finalise blew up: %s", inner)
        raise
    finally:
        await engine.dispose()


async def get_latest_run(
    session: AsyncSession, name: str
) -> ScriptRun | None:
    """Return the most recent ``script_runs`` row for the named script.

    Reused by the admin-system metrics endpoint to render last-run
    summaries; lives here so the wrapper module is the single source
    of truth on the table shape.
    """
    return (
        await session.execute(
            select(ScriptRun)
            .where(ScriptRun.name == name)
            .order_by(ScriptRun.started_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
