"""User-submitted take-down / abuse reports against published shares.

Per discovery ticket D16. Anonymous submission allowed (reporter_user_id
on the row is nullable + ON DELETE SET NULL). Heavily rate-limited because
the admin queue is the dev's inbox and abuse here costs human attention,
not just compute.

Admin queue (`GET /admin/reports`, `POST /admin/reports/{id}/action`) lives
in chunk E.
"""

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from myetal_api.api.deps import DbSession, OptionalUser
from myetal_api.core.rate_limit import REPORT_LIMIT, limiter
from myetal_api.models import Share, ShareReport, ShareReportReason

router = APIRouter(tags=["reports"])


class ReportSubmit(BaseModel):
    reason: ShareReportReason
    details: str | None = Field(default=None, max_length=2000)


class ReportSubmitResponse(BaseModel):
    id: uuid.UUID
    status: str = "open"


@router.post(
    "/shares/{short_code}/report",
    response_model=ReportSubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(REPORT_LIMIT)
async def submit_report(
    short_code: str,
    body: ReportSubmit,
    request: Request,
    user: OptionalUser,
    db: DbSession,
) -> ReportSubmitResponse:
    """Submit a take-down / abuse report against a public share.

    Returns 201 + the report id on success. The report lands in the `open`
    queue for admin review. Rate-limited per IP via slowapi (3/hour) — the
    same limit applies whether anon or signed-in for v1, since Cloudflare
    is DNS-only and we don't have an edge layer to do user-aware limiting
    cheaply.
    """
    # Only published-and-live shares are reportable. Tombstoned shares are
    # already gone; private shares aren't visible to anon viewers anyway.
    share = await db.scalar(
        select(Share).where(
            Share.short_code == short_code,
            Share.is_public.is_(True),
            Share.deleted_at.is_(None),
        )
    )
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")

    report = ShareReport(
        share_id=share.id,
        reporter_user_id=user.id if user else None,
        reason=body.reason,
        details=body.details,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportSubmitResponse(id=report.id, status=report.status.value)
