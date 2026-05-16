"""/admin/* — overview dashboard + moderation surface.

Stage 1 of `docs/tickets/to-do/admin-analytics-dashboard.md` lives in
this file (`GET /admin/overview`); Stage 2 user management lives in
`api/routes/admin_users.py`. The legacy moderation queue
(`GET /admin/reports`, `POST /admin/reports/{id}/action`) stays here —
the ticket's Stage 3 will absorb it into a wider share-moderation
section, but for v1 it keeps working as-is.

All routes are gated by ``AdminUser`` (email allowlist via
``settings.admin_emails`` — see ``api/deps.py::require_admin``) and
rate-limited at ``ADMIN_LIMIT`` to defend against compromised admin
tokens.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from myetal_api.api.deps import AdminUser, DbSession
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.models import Share, ShareReport, ShareReportReason, ShareReportStatus
from myetal_api.schemas.admin import OverviewResponse
from myetal_api.services import admin_audit as admin_audit_service
from myetal_api.services import admin_overview as overview_service
from myetal_api.services import share as share_service

router = APIRouter(prefix="/admin", tags=["admin"])

# Rate limit chosen per the ticket ("600/min/admin"). slowapi can't currently
# resolve a per-user key without a Request param being explicit on every route
# handler, so each handler that opts in declares it directly.
ADMIN_LIMIT = "600/minute"


# ---- Overview (Stage 1) -----------------------------------------------------

# In-process TTL cache. 60-second window per the ticket; the dashboard is
# read-heavy and the underlying COUNT(*) WHERE… queries are index-friendly
# but still touch every published row, so caching saves real planner work
# under refresh-storms.
_OVERVIEW_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
_OVERVIEW_TTL_SECONDS = 60.0


@router.get("/overview", response_model=OverviewResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def get_overview(
    request: Request,
    response: Response,
    _admin: AdminUser,
    db: DbSession,
) -> dict[str, Any]:
    """Return the Stage 1 overview payload in one shot."""
    now = time.monotonic()
    if (
        _OVERVIEW_CACHE["payload"] is not None
        and now - _OVERVIEW_CACHE["at"] < _OVERVIEW_TTL_SECONDS
    ):
        # Surface cache-hit through a Cache-Control header so a reverse
        # proxy could in theory short-circuit too. We're not behind one
        # for the admin path today, so the in-process cache is doing the
        # real work.
        response.headers["Cache-Control"] = (
            f"private, max-age={int(_OVERVIEW_TTL_SECONDS)}"
        )
        return _OVERVIEW_CACHE["payload"]

    payload = await overview_service.build_overview(db)
    _OVERVIEW_CACHE["at"] = now
    _OVERVIEW_CACHE["payload"] = payload
    response.headers["Cache-Control"] = (
        f"private, max-age={int(_OVERVIEW_TTL_SECONDS)}"
    )
    return payload


def _reset_overview_cache_for_tests() -> None:
    """Test hook — flushes the in-memory TTL cache.

    Test fixtures create + verify counts within a single second; the
    cache would otherwise hand them stale zeros across subsequent
    requests. Mirrors the same-named helpers in `share_view_dedup.py`
    and `ba_security.py`.
    """
    _OVERVIEW_CACHE["at"] = 0.0
    _OVERVIEW_CACHE["payload"] = None


# ---- Moderation queue (legacy — same shape as PR-D / D16) ------------------


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    share_id: uuid.UUID
    share_short_code: str
    share_name: str
    share_deleted_at: datetime | None
    reporter_user_id: uuid.UUID | None
    reason: ShareReportReason
    details: str | None
    status: ShareReportStatus
    created_at: datetime
    actioned_at: datetime | None
    actioned_by: uuid.UUID | None


class ReportAction(BaseModel):
    decision: Literal["actioned", "dismissed"] = Field(
        description=(
            "actioned = report was justified and acted on; dismissed = false "
            "positive / not a problem. Both close the report; actioned is the "
            "audit trail signal that we did something."
        )
    )
    tombstone_share: bool = Field(
        default=False,
        description=(
            "If true (and the share isn't already tombstoned), soft-delete the "
            "underlying share. Typically paired with decision='actioned' for "
            "copyright/abuse cases."
        ),
    )


@router.get("/reports", response_model=list[ReportOut])
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def list_reports(
    request: Request,
    _admin: AdminUser,
    db: DbSession,
    status_filter: ShareReportStatus | None = Query(
        default=ShareReportStatus.OPEN,
        alias="status",
        description="Filter by status. Default: only open reports.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ReportOut]:
    """The moderation queue — newest open reports first by default."""
    stmt = select(ShareReport, Share).join(Share, Share.id == ShareReport.share_id)
    if status_filter is not None:
        stmt = stmt.where(ShareReport.status == status_filter)
    stmt = stmt.order_by(ShareReport.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).all()

    return [
        ReportOut(
            id=report.id,
            share_id=share.id,
            share_short_code=share.short_code,
            share_name=share.name,
            share_deleted_at=share.deleted_at,
            reporter_user_id=report.reporter_user_id,
            reason=report.reason,
            details=report.details,
            status=report.status,
            created_at=report.created_at,
            actioned_at=report.actioned_at,
            actioned_by=report.actioned_by,
        )
        for report, share in rows
    ]


@router.post("/reports/{report_id}/action", response_model=ReportOut)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def action_report(
    request: Request,
    report_id: uuid.UUID,
    body: ReportAction,
    admin: AdminUser,
    db: DbSession,
) -> ReportOut:
    """Close a report. Optionally tombstones the underlying share in the
    same transaction (typical for `decision=actioned + reason in (copyright,
    abuse)` cases)."""
    report = await db.get(ShareReport, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    if report.status != ShareReportStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"report already {report.status.value}",
        )

    share = await db.get(Share, report.share_id)
    if share is None:
        # Unusual — report's share got hard-deleted somehow.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="report's share no longer exists",
        )

    tombstoned = False
    if body.tombstone_share and share.deleted_at is None:
        await share_service.tombstone_share(db, share)
        tombstoned = True

    report.status = ShareReportStatus(body.decision)
    report.actioned_at = datetime.now(UTC)
    report.actioned_by = admin.id

    # Audit row — single transaction with the status flip.
    await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="action_report",
        target_share_id=share.id,
        details={
            "decision": body.decision,
            "tombstoned": tombstoned,
            "report_id": str(report.id),
        },
    )
    await db.commit()
    await db.refresh(report)
    await db.refresh(share)

    return ReportOut(
        id=report.id,
        share_id=share.id,
        share_short_code=share.short_code,
        share_name=share.name,
        share_deleted_at=share.deleted_at,
        reporter_user_id=report.reporter_user_id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        created_at=report.created_at,
        actioned_at=report.actioned_at,
        actioned_by=report.actioned_by,
    )
