"""Stage 3 admin share-management read + action services.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 3.

Mirrors the Stage 2 user-management shape: a paginated list with
search + filter + sort, a detail endpoint surfacing every signal an
admin needs to act on a share (item list, view timeline, reports,
similar-snapshot, audit log), and the moderation actions live as small
mutators on the share row (``Share.deleted_at``, ``Share.published_at``).

Cursor encoding mirrors :mod:`services.admin_users` — ``"<iso>|<uuid>"``
base64'd. Human-debuggable on purpose.

Search expansion: name prefix + short_code exact + owner-email prefix +
paper-DOI substring inside the share's items + tag slug exact. We OR
the legs so a single search box covers the four spec'd lookups
without forcing the admin to remember which field to use.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import (
    AdminAudit,
    Share,
    ShareItem,
    ShareReport,
    ShareSimilar,
    ShareTag,
    ShareView,
    Tag,
    User,
)

PAGE_SIZE = 50


# ---- Cursor encoding --------------------------------------------------------


def _encode_cursor(created_at: datetime, share_id: uuid.UUID) -> str:
    truncated = created_at.replace(microsecond=0)
    raw = f"{truncated.isoformat()}|{share_id}"
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        iso, sep, sid = raw.partition("|")
        if not sep:
            return None
        return datetime.fromisoformat(iso), uuid.UUID(sid)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None


# ---- List -------------------------------------------------------------------


def _age_filter_clause(age: str | None) -> Any:
    """Return a Share-level WHERE clause for the age bucket chip."""
    if not age or age == "all":
        return None
    now = datetime.now(UTC)
    if age == "7d":
        return Share.created_at >= now - timedelta(days=7)
    if age == "30d":
        return Share.created_at >= now - timedelta(days=30)
    if age == "90d":
        return Share.created_at >= now - timedelta(days=90)
    if age == "older":
        return Share.created_at < now - timedelta(days=90)
    return None


async def list_shares(
    db: AsyncSession,
    *,
    q: str | None = None,
    filter_: str = "all",
    type_: str | None = None,
    age: str | None = None,
    cursor: str | None = None,
    sort: str = "created_desc",
    limit: int = PAGE_SIZE,
) -> dict[str, Any]:
    """Paginated admin share list with search/filter/sort.

    Tombstoned shares are INCLUDED by default (admins need to see what
    they tombstoned). The ``filter`` chip distinguishes:
    * ``all`` — every share, deleted or alive
    * ``published`` — ``published_at IS NOT NULL AND deleted_at IS NULL``
    * ``draft`` — ``published_at IS NULL AND deleted_at IS NULL``
    * ``tombstoned`` — ``deleted_at IS NOT NULL``
    """
    item_count_sub = (
        select(func.count(ShareItem.id))
        .where(ShareItem.share_id == Share.id)
        .correlate(Share)
        .scalar_subquery()
    )
    month_ago = datetime.now(UTC) - timedelta(days=30)
    view_count_sub = (
        select(func.count(ShareView.id))
        .where(
            ShareView.share_id == Share.id,
            ShareView.viewed_at >= month_ago,
        )
        .correlate(Share)
        .scalar_subquery()
    )

    stmt = select(
        Share,
        User.email.label("owner_email"),
        User.name.label("owner_name"),
        item_count_sub.label("item_count"),
        view_count_sub.label("view_count_30d"),
    ).join(User, User.id == Share.owner_user_id)

    # ---- search legs (ORed) ----
    if q:
        term = q.strip()
        like = f"{term.lower()}%"
        contains = f"%{term.lower()}%"
        # Subqueries for "share has item with DOI containing X" and
        # "share has tag with slug = X". EXISTS keeps the row count
        # bounded (no fan-out on JOIN duplication).
        doi_exists = (
            select(ShareItem.id)
            .where(
                ShareItem.share_id == Share.id,
                func.lower(ShareItem.doi).like(contains),
            )
            .exists()
        )
        tag_exists = (
            select(ShareTag.share_id)
            .join(Tag, Tag.id == ShareTag.tag_id)
            .where(
                ShareTag.share_id == Share.id,
                func.lower(Tag.slug) == term.lower(),
            )
            .exists()
        )
        stmt = stmt.where(
            or_(
                func.lower(Share.name).like(like),
                func.lower(Share.short_code) == term.lower(),
                func.lower(User.email).like(like),
                doi_exists,
                tag_exists,
            )
        )

    # ---- filter chips ----
    if filter_ == "published":
        stmt = stmt.where(
            Share.published_at.is_not(None),
            Share.deleted_at.is_(None),
        )
    elif filter_ == "draft":
        stmt = stmt.where(
            Share.published_at.is_(None),
            Share.deleted_at.is_(None),
        )
    elif filter_ == "tombstoned":
        stmt = stmt.where(Share.deleted_at.is_not(None))

    if type_:
        stmt = stmt.where(Share.type == type_)

    age_clause = _age_filter_clause(age)
    if age_clause is not None:
        stmt = stmt.where(age_clause)

    # ---- cursor ----
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            anchor_dt, anchor_id = decoded
            stmt = stmt.where(
                or_(
                    Share.created_at < anchor_dt,
                    (Share.created_at == anchor_dt) & (Share.id < anchor_id),
                )
            )

    # ---- sort ----
    if sort == "created_asc":
        stmt = stmt.order_by(Share.created_at.asc(), Share.id.asc())
    elif sort == "views_30d_desc":
        stmt = stmt.order_by(desc(view_count_sub), Share.id.desc())
    else:
        stmt = stmt.order_by(Share.created_at.desc(), Share.id.desc())

    stmt = stmt.limit(limit + 1)

    rows = (await db.execute(stmt)).all()
    have_more = len(rows) > limit
    rows = rows[:limit]

    # Fetch tag slugs for the page in one query — avoids N+1.
    share_ids = [r[0].id for r in rows]
    tags_by_share: dict[uuid.UUID, list[str]] = {}
    if share_ids:
        tag_rows = (
            await db.execute(
                select(ShareTag.share_id, Tag.slug)
                .join(Tag, Tag.id == ShareTag.tag_id)
                .where(ShareTag.share_id.in_(share_ids))
                .order_by(Tag.slug)
            )
        ).all()
        for tr in tag_rows:
            tags_by_share.setdefault(tr.share_id, []).append(tr.slug)

    items: list[dict[str, Any]] = []
    for r in rows:
        share: Share = r[0]
        items.append(
            {
                "id": share.id,
                "short_code": share.short_code,
                "name": share.name,
                "type": share.type.value if hasattr(share.type, "value") else str(share.type),
                "owner_user_id": share.owner_user_id,
                "owner_email": r.owner_email,
                "owner_name": r.owner_name,
                "is_public": share.is_public,
                "published_at": share.published_at,
                "deleted_at": share.deleted_at,
                "created_at": share.created_at,
                "item_count": int(r.item_count or 0),
                "view_count_30d": int(r.view_count_30d or 0),
                "tag_slugs": tags_by_share.get(share.id, []),
            }
        )

    next_cursor: str | None = None
    if have_more and items:
        last = items[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])

    # Total with the same filter set (without cursor).
    count_stmt = (
        select(func.count())
        .select_from(Share)
        .join(User, User.id == Share.owner_user_id)
    )
    if q:
        term = q.strip()
        like = f"{term.lower()}%"
        contains = f"%{term.lower()}%"
        doi_exists = (
            select(ShareItem.id)
            .where(
                ShareItem.share_id == Share.id,
                func.lower(ShareItem.doi).like(contains),
            )
            .exists()
        )
        tag_exists = (
            select(ShareTag.share_id)
            .join(Tag, Tag.id == ShareTag.tag_id)
            .where(
                ShareTag.share_id == Share.id,
                func.lower(Tag.slug) == term.lower(),
            )
            .exists()
        )
        count_stmt = count_stmt.where(
            or_(
                func.lower(Share.name).like(like),
                func.lower(Share.short_code) == term.lower(),
                func.lower(User.email).like(like),
                doi_exists,
                tag_exists,
            )
        )
    if filter_ == "published":
        count_stmt = count_stmt.where(
            Share.published_at.is_not(None), Share.deleted_at.is_(None)
        )
    elif filter_ == "draft":
        count_stmt = count_stmt.where(
            Share.published_at.is_(None), Share.deleted_at.is_(None)
        )
    elif filter_ == "tombstoned":
        count_stmt = count_stmt.where(Share.deleted_at.is_not(None))
    if type_:
        count_stmt = count_stmt.where(Share.type == type_)
    if age_clause is not None:
        count_stmt = count_stmt.where(age_clause)

    total = int(await db.scalar(count_stmt) or 0)

    return {"items": items, "next_cursor": next_cursor, "total": total}


# ---- Detail -----------------------------------------------------------------


async def get_share_detail(
    db: AsyncSession,
    share_id: uuid.UUID,
) -> dict[str, Any] | None:
    """Surface every signal the admin needs on the share-detail page."""
    share = await db.get(Share, share_id)
    if share is None:
        return None

    owner = await db.get(User, share.owner_user_id)

    # Items
    item_rows = (
        await db.execute(
            select(ShareItem)
            .where(ShareItem.share_id == share_id)
            .order_by(ShareItem.position)
        )
    ).scalars().all()
    items: list[dict[str, Any]] = []
    for it in item_rows:
        items.append(
            {
                "id": it.id,
                "kind": it.kind.value if hasattr(it.kind, "value") else str(it.kind),
                "title": it.title,
                "subtitle": it.subtitle,
                "url": it.url,
                "doi": it.doi,
                "authors": it.authors,
                "year": it.year,
                "notes": it.notes,
                "file_url": it.file_url,
                "file_size_bytes": it.file_size_bytes,
                "file_mime": it.file_mime,
                "thumbnail_url": it.thumbnail_url,
                "copyright_ack_at": it.copyright_ack_at,
            }
        )

    # Tags
    tag_rows = (
        await db.execute(
            select(Tag.slug, Tag.label)
            .join(ShareTag, ShareTag.tag_id == Tag.id)
            .where(ShareTag.share_id == share_id)
            .order_by(Tag.label)
        )
    ).all()
    tags = [{"slug": t.slug, "label": t.label} for t in tag_rows]

    # View counts (total, 7d, 30d)
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    ninety_ago = now - timedelta(days=90)

    view_total = int(
        await db.scalar(
            select(func.count()).select_from(ShareView).where(ShareView.share_id == share_id)
        )
        or 0
    )
    view_7d = int(
        await db.scalar(
            select(func.count())
            .select_from(ShareView)
            .where(ShareView.share_id == share_id, ShareView.viewed_at >= week_ago)
        )
        or 0
    )
    view_30d = int(
        await db.scalar(
            select(func.count())
            .select_from(ShareView)
            .where(ShareView.share_id == share_id, ShareView.viewed_at >= month_ago)
        )
        or 0
    )

    # Daily 90d view buckets — pad zero days for a continuous chart.
    bucket = func.date(ShareView.viewed_at).label("date")
    bucket_rows = (
        await db.execute(
            select(bucket, func.count().label("count"))
            .where(
                ShareView.share_id == share_id,
                ShareView.viewed_at >= ninety_ago,
            )
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    by_date = {str(b.date): int(b.count) for b in bucket_rows}
    daily_views_90d: list[dict[str, Any]] = []
    today = now.date()
    for offset in range(89, -1, -1):
        d = today - timedelta(days=offset)
        key = d.isoformat()
        daily_views_90d.append({"date": key, "count": by_date.get(key, 0)})

    # Reports against this share
    report_rows = (
        await db.execute(
            select(ShareReport)
            .where(ShareReport.share_id == share_id)
            .order_by(ShareReport.created_at.desc())
        )
    ).scalars().all()
    reports: list[dict[str, Any]] = []
    for rep in report_rows:
        reports.append(
            {
                "id": rep.id,
                "reporter_user_id": rep.reporter_user_id,
                "reason": rep.reason.value if hasattr(rep.reason, "value") else str(rep.reason),
                "details": rep.details,
                "status": rep.status.value if hasattr(rep.status, "value") else str(rep.status),
                "created_at": rep.created_at,
                "actioned_at": rep.actioned_at,
                "actioned_by": rep.actioned_by,
            }
        )

    # Similar-shares precompute snapshot
    # The table stores canonical pairs (a < b); union both directions.
    sim_a = (
        await db.execute(
            select(
                ShareSimilar.share_id_b.label("other_id"),
                ShareSimilar.papers_in_common,
                ShareSimilar.refreshed_at,
            ).where(ShareSimilar.share_id_a == share_id)
        )
    ).all()
    sim_b = (
        await db.execute(
            select(
                ShareSimilar.share_id_a.label("other_id"),
                ShareSimilar.papers_in_common,
                ShareSimilar.refreshed_at,
            ).where(ShareSimilar.share_id_b == share_id)
        )
    ).all()
    sim_rows = list(sim_a) + list(sim_b)
    other_ids = [r.other_id for r in sim_rows]
    similar_snapshot: list[dict[str, Any]] = []
    if other_ids:
        shares_map_rows = (
            await db.execute(
                select(Share.id, Share.short_code, Share.name).where(Share.id.in_(other_ids))
            )
        ).all()
        shares_map = {row.id: row for row in shares_map_rows}
        # Sort by papers_in_common desc to mirror the public read pattern.
        sim_rows_sorted = sorted(
            sim_rows, key=lambda r: r.papers_in_common, reverse=True
        )
        for sim in sim_rows_sorted:
            other = shares_map.get(sim.other_id)
            if other is None:
                continue
            similar_snapshot.append(
                {
                    "similar_share_id": sim.other_id,
                    "short_code": other.short_code,
                    "name": other.name,
                    "papers_in_common": int(sim.papers_in_common),
                    "refreshed_at": sim.refreshed_at,
                }
            )

    # Audit log filtered to this share
    audit_rows = (
        await db.execute(
            select(AdminAudit, User.email.label("admin_email"))
            .join(User, User.id == AdminAudit.admin_user_id)
            .where(AdminAudit.target_share_id == share_id)
            .order_by(AdminAudit.created_at.desc())
            .limit(100)
        )
    ).all()
    audit: list[dict[str, Any]] = []
    for row in audit_rows:
        a: AdminAudit = row[0]
        audit.append(
            {
                "id": a.id,
                "action": a.action,
                "admin_user_id": a.admin_user_id,
                "admin_email": row.admin_email,
                "target_user_id": a.target_user_id,
                "target_share_id": a.target_share_id,
                "details": a.details,
                "created_at": a.created_at,
            }
        )

    return {
        "id": share.id,
        "short_code": share.short_code,
        "name": share.name,
        "description": share.description,
        "type": share.type.value if hasattr(share.type, "value") else str(share.type),
        "is_public": share.is_public,
        "published_at": share.published_at,
        "deleted_at": share.deleted_at,
        "created_at": share.created_at,
        "updated_at": share.updated_at,
        "owner_user_id": share.owner_user_id,
        "owner_email": owner.email if owner else None,
        "owner_name": owner.name if owner else None,
        "item_count": len(items),
        "view_count_total": view_total,
        "view_count_7d": view_7d,
        "view_count_30d": view_30d,
        "items": items,
        "tags": tags,
        "daily_views_90d": daily_views_90d,
        "reports": reports,
        "similar_snapshot": similar_snapshot,
        "audit": audit,
    }


# ---- Action helpers --------------------------------------------------------


async def tombstone_share_row(db: AsyncSession, share: Share) -> None:
    """Set ``deleted_at`` without committing — caller commits alongside audit."""
    share.deleted_at = datetime.now(UTC)


async def restore_share_row(db: AsyncSession, share: Share) -> None:
    """NULL ``deleted_at`` (reverse a tombstone) without committing."""
    share.deleted_at = None


async def unpublish_share_row(db: AsyncSession, share: Share) -> None:
    """Set ``published_at = NULL`` without committing.

    Distinct from :func:`tombstone_share_row` — the URL stays alive but
    the share drops out of discovery surfaces. Useful for "violates
    guidelines, owner gets a chance to fix" cases per the ticket.
    """
    share.published_at = None
