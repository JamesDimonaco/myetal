"""/admin/system/* — Stage 4 operational observability.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

A single read-only endpoint that returns everything the
``/dashboard/admin/system`` page needs. 30-second in-process cache
because the underlying queries (24h request_metrics roll-up + R2 LIST
+ DB pool snapshot + auth tally) collectively take real time and the
page is the kind admins refresh repeatedly during an incident.

No write endpoints in v1 — the system view is observability, not
configuration. ``request_metrics`` is written by the middleware
(:mod:`core.request_metrics`), not by a route handler. ``script_runs``
is written by the cron wrapper helper (:mod:`scripts._wrapper`).
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request, Response

from myetal_api.api.deps import AdminUser, DbSession
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.schemas.admin import SystemMetricsResponse
from myetal_api.services import admin_system as admin_system_service

ADMIN_LIMIT = "600/minute"

router = APIRouter(prefix="/admin/system", tags=["admin-system"])


# 30-second TTL cache. The aggregated queries (24h request_metrics
# roll-up + R2 LIST + DB pool snapshot) are individually cheap but
# collectively chunky enough to skip across a 1-min auto-refresh.
_METRICS_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
_METRICS_TTL = 30.0


@router.get("/metrics", response_model=SystemMetricsResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def get_system_metrics(
    request: Request,
    response: Response,
    _admin: AdminUser,
    db: DbSession,
) -> dict[str, Any]:
    """Return the full Stage 4 system-metrics payload."""
    now = time.monotonic()
    if (
        _METRICS_CACHE["payload"] is not None
        and now - _METRICS_CACHE["at"] < _METRICS_TTL
    ):
        response.headers["Cache-Control"] = f"private, max-age={int(_METRICS_TTL)}"
        return _METRICS_CACHE["payload"]

    payload = await admin_system_service.build_metrics(db)
    _METRICS_CACHE["at"] = now
    _METRICS_CACHE["payload"] = payload
    response.headers["Cache-Control"] = f"private, max-age={int(_METRICS_TTL)}"
    return payload


def reset_metrics_cache() -> None:
    """Flush the in-memory 30s metrics cache. Test-only."""
    _METRICS_CACHE["at"] = 0.0
    _METRICS_CACHE["payload"] = None
