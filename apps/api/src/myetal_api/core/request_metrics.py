"""In-process per-minute request/error aggregator + flush loop.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

The middleware does NOT write a row per request. Instead it buckets
counts in a process-local dict and flushes once per minute to the
``request_metrics`` table. Trade-off: restart loses the current
bucket's counts. Acceptable — these are operational hints, not audit.

Why not redis: keeping the system narrow. A single uvicorn worker per
the deploy doc means one aggregator per process is plenty; we don't
need a cross-process consensus story for "rough request rate over the
last 24 hours."

Route prefixes are computed from the first path segment:
    /admin/users/abc → /admin
    /me/library      → /me
    /                → /_root
    /c/abc           → /c
    everything else  → its leading segment

Errors are 5xx-only. 4xx is excluded — it's usually client error
(unauthenticated, bad-request) and would drown the real-error signal.

The flush helper is exposed for tests so they can advance the clock
without waiting 60 wall-seconds. In prod it's driven by an asyncio
task started at FastAPI lifespan startup; we lazy-start it on first
request so test environments that don't run a lifespan still work.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from myetal_api.core.database import SessionLocal
from myetal_api.models import RequestMetric

logger = logging.getLogger(__name__)

# In-memory aggregator. Keyed by (bucket_iso_minute, route_prefix) →
# {request_count, error_count, latency_ms_sum}. Reset on flush.
_AGGREGATOR: dict[tuple[str, str], dict[str, int]] = {}
_AGG_LOCK = asyncio.Lock()
_FLUSH_TASK: asyncio.Task[None] | None = None
_FLUSH_INTERVAL_SECONDS = 60.0


def _route_prefix(path: str) -> str:
    """Collapse a request path to its leading segment.

    Stage-4 dashboard shows traffic grouped by area, not individual
    routes, so the segment is enough signal.
    """
    if path in ("", "/"):
        return "/_root"
    # Strip leading slash, take first segment, restore the slash.
    first = path.lstrip("/").split("/", 1)[0]
    if not first:
        return "/_root"
    return f"/{first}"


def _bucket_key(now: datetime) -> str:
    """Floor `now` to the minute and return its ISO key."""
    return now.replace(second=0, microsecond=0).isoformat()


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    """Increment per-(bucket, prefix) counters on every request.

    Sits AFTER the RequestID middleware so a request_id is already on
    the request when we observe (no behavioural dependency — we don't
    log per request — but consistent middleware order is cheap).
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # Skip docs/openapi/health — they're hit frequently by uptime
        # pingers and would skew the rates without adding signal.
        path = request.url.path
        if path in ("/docs", "/redoc", "/openapi.json", "/health", "/healthz"):
            return await call_next(request)

        _ensure_flush_task()

        start = time.perf_counter()
        prefix = _route_prefix(path)
        status_code = 500  # default to 5xx if call_next blows up
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            # Defensive wrap: _record is async-locked + does a dict bump,
            # so it's practically inert, but if it ever raised the
            # exception would propagate out of `finally` and lose the
            # response. Operational telemetry must never break the
            # request hot path.
            try:
                await _record(prefix, status_code, elapsed_ms)
            except Exception:
                logger.exception("RequestMetricsMiddleware._record failed")


async def _record(prefix: str, status_code: int, elapsed_ms: int) -> None:
    """Bump the in-memory aggregator for the current minute."""
    bucket = _bucket_key(datetime.now(UTC))
    key = (bucket, prefix)
    async with _AGG_LOCK:
        slot = _AGGREGATOR.setdefault(
            key,
            {"request_count": 0, "error_count": 0, "latency_ms_sum": 0},
        )
        slot["request_count"] += 1
        if status_code >= 500:
            slot["error_count"] += 1
        slot["latency_ms_sum"] += elapsed_ms


def _ensure_flush_task() -> None:
    """Lazily start the background flush loop.

    We don't rely on FastAPI lifespan because some test environments
    skip the lifespan startup hook. Starting on first request keeps
    behaviour consistent across environments at the cost of one
    pointer comparison per request.
    """
    global _FLUSH_TASK
    if _FLUSH_TASK is not None and not _FLUSH_TASK.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _FLUSH_TASK = loop.create_task(_flush_loop())


async def _flush_loop() -> None:
    """Periodically flush the aggregator to the DB.

    Sleeps in chunks so a task cancel takes effect quickly. Errors
    inside the flush are logged but don't crash the loop — operational
    telemetry shouldn't take the API down with it.
    """
    try:
        while True:
            await asyncio.sleep(_FLUSH_INTERVAL_SECONDS)
            try:
                await flush_now()
            except Exception as exc:  # noqa: BLE001 — keep the loop alive
                logger.warning("request_metrics flush failed: %s", exc)
    except asyncio.CancelledError:
        # One last flush so we don't lose the current minute on shutdown.
        try:
            await flush_now()
        except Exception as exc:  # noqa: BLE001 — shutdown shouldn't raise
            logger.warning("request_metrics shutdown flush failed: %s", exc)


async def flush_now() -> int:
    """Flush whatever's currently in the aggregator. Returns rows touched.

    Drains the aggregator under the lock, then writes outside it so
    inflight request increments don't pile up against the DB call.
    The upsert is dialect-aware (PG uses ON CONFLICT; SQLite test path
    INSERT-OR-UPDATEs manually).
    """
    async with _AGG_LOCK:
        if not _AGGREGATOR:
            return 0
        drained = dict(_AGGREGATOR)
        _AGGREGATOR.clear()

    written = 0
    async with SessionLocal() as session:
        for (bucket_iso, prefix), counts in drained.items():
            bucket_dt = datetime.fromisoformat(bucket_iso)
            existing = (
                await session.execute(
                    select(RequestMetric).where(
                        RequestMetric.bucket_start == bucket_dt,
                        RequestMetric.route_prefix == prefix,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    RequestMetric(
                        bucket_start=bucket_dt,
                        route_prefix=prefix,
                        request_count=counts["request_count"],
                        error_count=counts["error_count"],
                        latency_ms_sum=counts["latency_ms_sum"],
                    )
                )
            else:
                existing.request_count += counts["request_count"]
                existing.error_count += counts["error_count"]
                existing.latency_ms_sum += counts["latency_ms_sum"]
            written += 1
        await session.commit()
    return written


def _reset_for_tests() -> None:
    """Clear the in-memory aggregator + the flush-task ref. Test-only."""
    global _FLUSH_TASK
    _AGGREGATOR.clear()
    if _FLUSH_TASK is not None:
        _FLUSH_TASK.cancel()
        _FLUSH_TASK = None


def _peek_for_tests() -> dict[tuple[str, str], dict[str, int]]:
    """Return a copy of the aggregator for tests to inspect."""
    return {k: dict(v) for k, v in _AGGREGATOR.items()}


def _snapshot_for_tests() -> dict[str, Any]:
    return {
        "aggregator": _peek_for_tests(),
        "flush_task_alive": _FLUSH_TASK is not None and not _FLUSH_TASK.done(),
    }
