"""/admin/* — minimal moderation surface.

Per discovery ticket D16. Currently just the take-down/abuse report queue
(GET list, POST action). All routes gated by `AdminUser` dep — email
allowlist via `settings.admin_emails`.

This is intentionally bare — at this stage of the product the admin is
the dev (James). Once we have multiple admins or actual abuse volume,
the right move is a proper admin UI (separate Next.js app, role-based
permissions, audit log per action). For v1: a JSON queue and a button.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from myetal_api.api.deps import AdminUser, DbSession
from myetal_api.models import Share, ShareReport, ShareReportReason, ShareReportStatus
from myetal_api.services import share as share_service

router = APIRouter(prefix="/admin", tags=["admin"])


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
async def list_reports(
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
async def action_report(
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

    if body.tombstone_share and share.deleted_at is None:
        await share_service.tombstone_share(db, share)

    report.status = ShareReportStatus(body.decision)
    report.actioned_at = datetime.now(UTC)
    report.actioned_by = admin.id
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
