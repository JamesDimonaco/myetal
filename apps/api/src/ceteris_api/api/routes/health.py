"""Health and readiness endpoints.

Split intentionally:
- /healthz  — liveness probe. Always 200 if the process is up. Never touches
              the DB. Used by Docker HEALTHCHECK and by external pingers
              (UptimeRobot etc.) that just want to know the container is alive.
- /readyz   — readiness probe. 200 only when the DB answers a `SELECT 1`.
              Used by orchestration / load-balancer health checks. A flaky
              DB returns 503 here, which is what /healthz CANNOT signal.
- /health   — backward-compat alias to /healthz so existing dashboards and
              the Dockerfile HEALTHCHECK keep working unchanged.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ceteris_api import __version__
from ceteris_api.api.deps import DbSession
from ceteris_api.core.config import settings

router = APIRouter(tags=["health"])


def _liveness_payload() -> dict[str, str]:
    return {"status": "ok", "env": settings.env, "version": __version__}


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return _liveness_payload()


@router.get("/health")
def health_alias() -> dict[str, str]:
    """Deprecated alias for /healthz — kept so the existing Dockerfile
    HEALTHCHECK and any external monitors continue to work."""
    return _liveness_payload()


@router.get("/readyz")
async def readyz(db: DbSession) -> JSONResponse:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — readiness probe must not raise
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unready", "reason": "database", "error": str(exc)},
        )
    return JSONResponse(content={"status": "ready"})
