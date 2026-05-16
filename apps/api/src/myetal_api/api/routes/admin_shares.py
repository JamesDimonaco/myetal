"""/admin/shares/* — Stage 3 share moderation.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 3.

Every endpoint is gated by ``AdminUser`` (= ``Depends(require_admin)``)
and rate-limited at ``ADMIN_LIMIT``. Every write action writes an
``admin_audit`` row in the SAME transaction as the underlying share
mutation — :mod:`services.admin_audit` flushes-not-commits so the
audit + change land together or neither does.

Endpoints:
* ``GET  /admin/shares``               list + search/filter/sort/paginate
* ``GET  /admin/shares/{id}``          detail (items, views 90d, reports,
                                       similar snapshot, audit log)
* ``POST /admin/shares/{id}/tombstone``   ``{reason: str}`` REQUIRED
* ``POST /admin/shares/{id}/restore``     reverse tombstone
* ``POST /admin/shares/{id}/unpublish``   keep alive, drop discovery
* ``POST /admin/shares/{id}/rebuild-similar``   debug helper —
                                       recompute similar/trending rows
                                       for one share

The Stage-0 ``/admin/reports`` queue stays at its existing path
(``api/routes/admin.py``); the share-detail page surfaces any open
reports against the share inline (see the ``reports`` field on the
detail payload).
"""

from __future__ import annotations

import logging
import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select, text

from myetal_api.api.deps import AdminUser, DbSession
from myetal_api.api.routes.admin import reset_overview_cache
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.models import (
    Share,
    SharePaper,
    ShareSimilar,
    ShareView,
    TrendingShare,
)
from myetal_api.schemas.admin import (
    AdminActionResponse,
    AdminShareDetail,
    AdminShareListResponse,
    TombstoneRequest,
)
from myetal_api.services import admin_audit as admin_audit_service
from myetal_api.services import admin_shares as admin_shares_service

logger = logging.getLogger(__name__)

ADMIN_LIMIT = "600/minute"

router = APIRouter(prefix="/admin/shares", tags=["admin-shares"])


# ---- Read -------------------------------------------------------------------


@router.get("", response_model=AdminShareListResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def list_shares(
    request: Request,
    _admin: AdminUser,
    db: DbSession,
    q: str | None = Query(default=None, max_length=200),
    filter_: str = Query(default="all", alias="filter"),
    type_: str | None = Query(default=None, alias="type"),
    age: str = Query(default="all"),
    cursor: str | None = Query(default=None, max_length=200),
    sort: str = Query(default="created_desc"),
) -> dict[str, Any]:
    """Paginated admin share list."""
    return await admin_shares_service.list_shares(
        db,
        q=q,
        filter_=filter_,
        type_=type_,
        age=age,
        cursor=cursor,
        sort=sort,
    )


@router.get("/{share_id}", response_model=AdminShareDetail)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def get_share_detail(
    request: Request,
    share_id: uuid.UUID,
    _admin: AdminUser,
    db: DbSession,
) -> dict[str, Any]:
    detail = await admin_shares_service.get_share_detail(db, share_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="share not found",
        )
    return detail


# ---- Write helpers ---------------------------------------------------------


async def _load_share(db: DbSession, share_id: uuid.UUID) -> Share:
    share = await db.get(Share, share_id)
    if share is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="share not found",
        )
    return share


# ---- Write endpoints -------------------------------------------------------


@router.post("/{share_id}/tombstone", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def tombstone(
    request: Request,
    share_id: uuid.UUID,
    body: TombstoneRequest,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Force-tombstone a share. Reason REQUIRED (audit-trail-load-bearing)."""
    share = await _load_share(db, share_id)
    if share.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="share already tombstoned",
        )
    await admin_shares_service.tombstone_share_row(db, share)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="tombstone_share",
        target_share_id=share.id,
        target_user_id=share.owner_user_id,
        details={"reason": body.reason},
    )
    await db.commit()
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Share /c/{share.short_code} tombstoned.",
    )


@router.post("/{share_id}/restore", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def restore(
    request: Request,
    share_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Reverse a tombstone — NULL ``deleted_at`` back."""
    share = await _load_share(db, share_id)
    if share.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="share is not tombstoned",
        )
    await admin_shares_service.restore_share_row(db, share)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="restore_share",
        target_share_id=share.id,
        target_user_id=share.owner_user_id,
    )
    await db.commit()
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Share /c/{share.short_code} restored.",
    )


@router.post("/{share_id}/unpublish", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def unpublish(
    request: Request,
    share_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Drop from discovery — keep the URL alive (no tombstone)."""
    share = await _load_share(db, share_id)
    if share.published_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="share is not published",
        )
    previous = share.published_at.isoformat() if share.published_at else None
    await admin_shares_service.unpublish_share_row(db, share)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="unpublish_share",
        target_share_id=share.id,
        target_user_id=share.owner_user_id,
        details={"previous_published_at": previous},
    )
    await db.commit()
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Share /c/{share.short_code} unpublished.",
    )


# ---- Rebuild similar/trending (debug helper) -------------------------------


async def _rebuild_similar_for_share(
    db: DbSession, share_id: uuid.UUID
) -> int:
    """Recompute ``share_similar`` rows touching the given share.

    Deletes the existing rows where the share appears on either side,
    then INSERTs the canonical-ordered fresh rows derived from
    ``share_papers``. Mirrors the global ``refresh_similar_shares.py``
    cron but scoped to one share — useful for debug after an admin
    publishes/unpublishes content under the share and wants the
    similar-shares panel to reflect it without waiting for the nightly
    cron.

    Returns the number of pairs inserted.
    """
    # Delete the existing rows for this share (both directions).
    await db.execute(
        text("DELETE FROM share_similar WHERE share_id_a = :s OR share_id_b = :s").bindparams(
            s=share_id
        )
    )

    # Insert fresh canonical pairs from share_papers — same predicates as
    # the global cron. Use a dialect-portable SQLAlchemy core query
    # rather than raw SQL so the SQLite test path works too.
    sp_self = SharePaper.__table__.alias("sp_self")
    sp_other = SharePaper.__table__.alias("sp_other")
    s_other = Share.__table__.alias("s_other")
    s_self = Share.__table__.alias("s_self")

    pairs_stmt = (
        select(
            sp_self.c.share_id.label("self_id"),
            sp_other.c.share_id.label("other_id"),
            func.count().label("papers_in_common"),
        )
        .select_from(
            sp_self.join(
                sp_other,
                (sp_self.c.paper_id == sp_other.c.paper_id)
                & (sp_self.c.share_id != sp_other.c.share_id),
            )
            .join(s_self, s_self.c.id == sp_self.c.share_id)
            .join(s_other, s_other.c.id == sp_other.c.share_id)
        )
        .where(
            sp_self.c.share_id == share_id,
            s_self.c.is_public.is_(True),
            s_self.c.published_at.is_not(None),
            s_self.c.deleted_at.is_(None),
            s_other.c.is_public.is_(True),
            s_other.c.published_at.is_not(None),
            s_other.c.deleted_at.is_(None),
        )
        .group_by(sp_self.c.share_id, sp_other.c.share_id)
    )
    rows = (await db.execute(pairs_stmt)).all()

    inserted = 0
    now = datetime.now(UTC)
    for row in rows:
        # Canonical ordering — share_id_a < share_id_b. UUIDs compare
        # lexicographically; SQLAlchemy/PG/SQLite all agree on this.
        a, b = sorted([row.self_id, row.other_id])
        sim = ShareSimilar(
            share_id_a=a,
            share_id_b=b,
            papers_in_common=int(row.papers_in_common),
            refreshed_at=now,
        )
        db.add(sim)
        inserted += 1

    return inserted


async def _rebuild_trending_for_share(
    db: DbSession, share_id: uuid.UUID
) -> None:
    """Recompute the single ``trending_shares`` row for the given share.

    Same time-decayed score as the global cron, scoped to one share.
    Uses Python-side exponential math so the SQLite test path works (no
    ``EXTRACT(EPOCH FROM ...)``).
    """
    now = datetime.now(UTC)
    fourteen_days_ago = now - timedelta(days=14)
    seven_days_ago = now - timedelta(days=7)

    rows = (
        await db.execute(
            select(ShareView.viewed_at).where(
                ShareView.share_id == share_id,
                ShareView.viewed_at >= fourteen_days_ago,
            )
        )
    ).all()

    if not rows:
        # No views in the window — drop the trending row so the
        # downstream consumer doesn't show stale data.
        existing = await db.get(TrendingShare, share_id)
        if existing is not None:
            await db.delete(existing)
        return

    score = 0.0
    view_count_7d = 0
    for r in rows:
        viewed = r.viewed_at
        if viewed.tzinfo is None:
            viewed = viewed.replace(tzinfo=UTC)
        delta_s = (now - viewed).total_seconds()
        score += math.exp(-delta_s / 259200.0)
        if viewed >= seven_days_ago:
            view_count_7d += 1

    existing = await db.get(TrendingShare, share_id)
    if existing is None:
        db.add(
            TrendingShare(
                share_id=share_id,
                score=score,
                view_count_7d=view_count_7d,
                refreshed_at=now,
            )
        )
    else:
        existing.score = score
        existing.view_count_7d = view_count_7d
        existing.refreshed_at = now


@router.post("/{share_id}/rebuild-similar", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def rebuild_similar(
    request: Request,
    share_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Recompute similar + trending rows for this single share.

    Useful for debug — admins sometimes want to verify "did the panel
    actually update after publish/unpublish" without waiting for the
    nightly cron.
    """
    share = await _load_share(db, share_id)
    similar_count = await _rebuild_similar_for_share(db, share.id)
    await _rebuild_trending_for_share(db, share.id)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="rebuild_similar_for_share",
        target_share_id=share.id,
        target_user_id=share.owner_user_id,
        details={"similar_pairs_inserted": similar_count},
    )
    await db.commit()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Recomputed precompute for /c/{share.short_code} ({similar_count} similar pairs).",
    )
