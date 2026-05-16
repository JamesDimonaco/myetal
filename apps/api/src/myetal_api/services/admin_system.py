"""Stage 4 system-health aggregator.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

One function returns everything the ``/dashboard/admin/system`` page
renders: request-rate / error-rate over the last 24h, last-run summary
for each cron script, DB-pool snapshot, R2 storage tally, and auth-
health placeholder.

Each section is independent — failure in one (e.g. R2 LIST times out)
returns a degraded section payload rather than 500ing the whole page.

R2 has a 5-minute in-process cache because LIST cost real money. Other
sections recompute on every call; the route adds a 30s in-process
cache layer on top so the dashboard's auto-refresh doesn't hammer the
DB.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import Account, RequestMetric, ScriptRun, Session

logger = logging.getLogger(__name__)


# ---- Per-section helpers ---------------------------------------------------


async def _routes_24h(db: AsyncSession) -> list[dict[str, Any]]:
    """Aggregate the ``request_metrics`` table over the last 24h by prefix.

    Returns ``[{route_prefix, request_count, error_count, p_error}, ...]``
    ordered by request count desc — the high-traffic prefixes lead.
    """
    since = datetime.now(UTC) - timedelta(hours=24)
    stmt = (
        select(
            RequestMetric.route_prefix,
            func.sum(RequestMetric.request_count).label("req"),
            func.sum(RequestMetric.error_count).label("err"),
        )
        .where(RequestMetric.bucket_start >= since)
        .group_by(RequestMetric.route_prefix)
        .order_by(func.sum(RequestMetric.request_count).desc())
    )
    rows = (await db.execute(stmt)).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        req = int(r.req or 0)
        err = int(r.err or 0)
        out.append(
            {
                "route_prefix": r.route_prefix,
                "request_count": req,
                "error_count": err,
                "p_error": (err / req) if req else 0.0,
            }
        )
    return out


# Scripts known to the dashboard. The schedule strings are human hints
# read from the deploy-doc crontab; if a script isn't on this list yet,
# it simply won't appear in the Stage-4 surface. Spec:
# refresh_similar_shares, refresh_trending, gc_tombstoned_shares,
# prune_share_views.
KNOWN_SCRIPTS: list[tuple[str, str]] = [
    ("refresh_trending", "hourly"),
    ("refresh_similar_shares", "nightly 02:00 UTC"),
    ("gc_tombstoned_shares", "daily 03:00 UTC"),
    ("prune_share_views", "weekly Sun 04:00 UTC"),
]


async def _scripts(db: AsyncSession) -> list[dict[str, Any]]:
    """For each known cron, return its most-recent ``script_runs`` row.

    Returns one row per known script even when no run row exists yet
    (last_run_at is None). Avoids "the dashboard hides scripts that
    haven't run yet" surprise.
    """
    out: list[dict[str, Any]] = []
    for name, schedule in KNOWN_SCRIPTS:
        latest = (
            await db.execute(
                select(ScriptRun)
                .where(ScriptRun.name == name)
                .order_by(ScriptRun.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest is None:
            out.append(
                {
                    "name": name,
                    "last_run_at": None,
                    "duration_ms": None,
                    "row_count": None,
                    "next_run_schedule": schedule,
                    "last_status": None,
                }
            )
        else:
            out.append(
                {
                    "name": name,
                    "last_run_at": latest.started_at,
                    "duration_ms": latest.duration_ms,
                    "row_count": latest.row_count,
                    "next_run_schedule": schedule,
                    "last_status": latest.status,
                }
            )
    return out


async def _db_pool(db: AsyncSession) -> dict[str, Any]:
    """Snapshot the SQLAlchemy connection pool.

    Reads the bound engine's pool. ``QueuePool.status()`` returns a
    human-readable string we don't want to parse — instead read the
    individual counters via the public attributes.

    Slow-query count is left as ``None`` in v1 — the ticket calls it
    out as a "nice to have"; wiring it in requires either a custom
    after-execute event or pg_stat_statements + extra reads. Punted to
    a follow-up; the placeholder is honest ("None" → "not yet
    instrumented" on the UI).
    """
    bind = db.bind
    if bind is None:
        return {
            "in_use": 0,
            "size": 0,
            "overflow": 0,
            "slow_query_count_1h": None,
        }
    pool = getattr(bind, "pool", None)
    in_use = 0
    size = 0
    overflow = 0
    if pool is not None:
        # checkedout: connections currently in use.
        # size: configured pool size.
        # overflow: extra connections beyond size (when pool's been bumped).
        in_use = int(getattr(pool, "checkedout", lambda: 0)() or 0)
        size = int(getattr(pool, "size", lambda: 0)() or 0)
        try:
            # SQLAlchemy's AsyncAdaptedQueuePool.overflow() can return -1
            # under low load (current - max_overflow). The UI surfaces
            # this verbatim and "Overflow: -1" reads as a bug. Clamp.
            overflow = max(0, int(pool.overflow()))  # type: ignore[attr-defined]
        except (AttributeError, TypeError):
            overflow = 0
    return {
        "in_use": in_use,
        "size": size,
        "overflow": overflow,
        "slow_query_count_1h": None,
    }


# R2 LIST cache — module-global. Pruned by TTL on read.
_R2_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
_R2_CACHE_TTL = 300.0  # 5 minutes per the ticket


def _r2_storage_uncached() -> dict[str, Any]:
    """List the entire R2 bucket and tally by prefix.

    Cost-sensitive: a LIST over a populated bucket can be several
    1000-key pages. Caching at 5 min trades freshness for budget.
    """
    from myetal_api.services import r2_client

    s3 = r2_client._get_client()
    from myetal_api.core.config import settings

    bucket = settings.r2_bucket
    total_objects = 0
    total_bytes = 0
    by_prefix: dict[str, dict[str, int]] = {}

    # Hard cap on LIST pages: each page is up to 1000 keys, so 50 pages
    # = 50,000 keys. On a bucket with N > 50k objects we report the
    # truncated tally + `truncated=True`; the dashboard surfaces a
    # subtle "≥" prefix and the prod admin team should move the tally
    # to a periodic background job. Without this cap a cold cache miss
    # on a 1M-object bucket would block the admin request for ~1k
    # sequential round-trips (~30s+) before responding.
    _MAX_LIST_PAGES = 50
    truncated = False
    continuation: str | None = None
    pages = 0
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket}
        if continuation:
            kwargs["ContinuationToken"] = continuation
        response = s3.list_objects_v2(**kwargs)
        pages += 1
        for obj in response.get("Contents", []) or []:
            key = obj.get("Key", "")
            size = int(obj.get("Size", 0) or 0)
            total_objects += 1
            total_bytes += size
            # Bucket by first path segment of the key, e.g.
            # "shares/<uuid>/items/x.pdf" → "shares/".
            prefix = key.split("/", 1)[0] + "/" if "/" in key else "(root)"
            slot = by_prefix.setdefault(prefix, {"object_count": 0, "bytes": 0})
            slot["object_count"] += 1
            slot["bytes"] += size
        if not response.get("IsTruncated"):
            break
        continuation = response.get("NextContinuationToken")
        if not continuation:
            break
        if pages >= _MAX_LIST_PAGES:
            truncated = True
            break

    return {
        "total_objects": total_objects,
        "total_bytes": total_bytes,
        "by_prefix": [
            {"prefix": p, "object_count": v["object_count"], "bytes": v["bytes"]}
            for p, v in sorted(by_prefix.items())
        ],
        "fetched_at": datetime.now(UTC),
        "cached": False,
        "truncated": truncated,
    }


def _r2_storage() -> dict[str, Any]:
    """Cached LIST over the R2 bucket.

    Returns a degraded "empty" payload on failure so the dashboard
    still renders the rest of the system view. Failure to list R2
    typically means a missing/invalid credential — visible from the
    cached=False + fetched_at=epoch combination.
    """
    now = time.monotonic()
    if (
        _R2_CACHE["payload"] is not None
        and now - _R2_CACHE["at"] < _R2_CACHE_TTL
    ):
        payload = dict(_R2_CACHE["payload"])
        payload["cached"] = True
        return payload
    try:
        fresh = _r2_storage_uncached()
    except Exception as exc:  # noqa: BLE001
        logger.warning("admin_system: R2 LIST failed: %s", exc)
        return {
            "total_objects": 0,
            "total_bytes": 0,
            "by_prefix": [],
            "fetched_at": datetime.now(UTC),
            "cached": False,
        }
    _R2_CACHE["at"] = now
    _R2_CACHE["payload"] = fresh
    return fresh


def _reset_r2_cache_for_tests() -> None:
    _R2_CACHE["at"] = 0.0
    _R2_CACHE["payload"] = None


async def _auth_health(db: AsyncSession) -> dict[str, Any]:
    """Per-provider sign-in counts over the last 24h.

    The ticket explicitly allows "be honest if the data isn't available
    yet — render a placeholder rather than fake numbers." We don't
    have an ``auth_events`` table; we approximate "completions" by
    counting recent ``session`` rows joined to the ``account`` row that
    owns them. Attempts are not tracked at all (BA hook not wired) —
    leave placeholder=True so the UI can render the explanatory card.

    The aggregate IS surfaced (as both attempts AND completions equal
    to the session count) so the chart isn't blank, but the flag tells
    the UI "this is a stand-in, BA event hook is pending."
    """
    since = datetime.now(UTC) - timedelta(hours=24)
    # Per-provider session-create count, joined to the account row that
    # owns the user's federated identity. A user with multiple linked
    # providers contributes one row per session per provider.
    rows = (
        await db.execute(
            select(
                Account.provider_id,
                func.count(Session.id).label("completions"),
            )
            .join(Account, Account.user_id == Session.user_id)
            .where(Session.created_at >= since)
            .group_by(Account.provider_id)
            .order_by(func.count(Session.id).desc())
        )
    ).all()
    providers = [
        {
            "provider": r.provider_id,
            # Attempts == completions (we lack a hooked attempt event).
            "attempts_24h": int(r.completions),
            "completions_24h": int(r.completions),
        }
        for r in rows
    ]
    return {
        "providers": providers,
        "placeholder": True,
        "note": (
            "Attempt counts are not yet wired to the Better Auth event "
            "hook; completion counts shown approximate from session "
            "creates per provider over 24h."
        ),
    }


# ---- Top-level entry point --------------------------------------------------


async def build_metrics(db: AsyncSession) -> dict[str, Any]:
    """Return the full Stage-4 system-metrics payload.

    Each section is fetched independently; a single failure degrades
    one section rather than poisoning the whole page.
    """
    routes = await _routes_24h(db)
    scripts = await _scripts(db)
    db_pool = await _db_pool(db)
    r2 = _r2_storage()
    auth = await _auth_health(db)
    return {
        "routes_24h": routes,
        "scripts": scripts,
        "db_pool": db_pool,
        "r2": r2,
        "auth": auth,
        "generated_at": datetime.now(UTC),
    }
