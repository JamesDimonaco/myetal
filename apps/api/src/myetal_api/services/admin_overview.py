"""Stage 1 dashboard — single big overview payload.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 1. One
function that returns every section in one go so the page is a single
fetch. Cached at the route layer for 60s; the queries themselves are
all index-friendly (COUNT WHERE, ORDER BY DESC LIMIT 10).

Section structure mirrors the page layout from top to bottom:
1. counters     — headline COUNTs
2. growth       — daily-bucket bar chart data (signups + share creates)
3. top_lists    — most-active owners, most-viewed shares, most-used tags
4. recent       — last 20 signups / feedback / reports
5. storage      — R2 PDF tally + top-5 PG table sizes + last cron runs

All datetime arithmetic uses Python-side ``datetime.now(UTC) - timedelta``
rather than Postgres ``interval`` literals so the SQLite test suite
exercises the same code path the prod server runs.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import (
    Feedback,
    OrcidSyncRun,
    Share,
    ShareItem,
    ShareReport,
    ShareSimilar,
    ShareView,
    Tag,
    TrendingShare,
    User,
)

# ---- Counters ---------------------------------------------------------------


async def _counters(db: AsyncSession) -> dict[str, int]:
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    new_users_7d = (
        await db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= week_ago)
        )
    ) or 0
    new_users_30d = (
        await db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= month_ago)
        )
    ) or 0

    # "Total shares (published only)" per the ticket.
    total_published_shares = (
        await db.scalar(
            select(func.count())
            .select_from(Share)
            .where(
                Share.published_at.is_not(None),
                Share.deleted_at.is_(None),
            )
        )
    ) or 0
    total_draft_shares = (
        await db.scalar(
            select(func.count())
            .select_from(Share)
            .where(
                Share.published_at.is_(None),
                Share.deleted_at.is_(None),
            )
        )
    ) or 0
    total_items = await db.scalar(select(func.count()).select_from(ShareItem)) or 0
    views_7d = (
        await db.scalar(
            select(func.count())
            .select_from(ShareView)
            .where(ShareView.viewed_at >= week_ago)
        )
    ) or 0
    views_30d = (
        await db.scalar(
            select(func.count())
            .select_from(ShareView)
            .where(ShareView.viewed_at >= month_ago)
        )
    ) or 0

    return {
        "total_users": int(total_users),
        "new_users_7d": int(new_users_7d),
        "new_users_30d": int(new_users_30d),
        "total_published_shares": int(total_published_shares),
        "total_draft_shares": int(total_draft_shares),
        "total_items": int(total_items),
        "views_7d": int(views_7d),
        "views_30d": int(views_30d),
    }


# ---- Growth charts (daily bars over last 30 days) ---------------------------


async def _daily_buckets(
    db: AsyncSession,
    column,
    where=None,
    days: int = 30,
) -> list[dict[str, Any]]:
    """Return ``[{date: 'YYYY-MM-DD', count: N}]`` for the last ``days`` days.

    ``column`` is the datetime column to bucket on. ``where`` is an
    optional extra filter list. Days with zero rows are NOT padded — the
    caller does that so the bucketing query stays cheap.
    """
    now = datetime.now(UTC)
    floor = now - timedelta(days=days)
    # ``func.date`` works on both Postgres (returns ``date``) and SQLite
    # (returns ISO string when fed an ISO-string-stored datetime). We
    # coerce both shapes to ``str`` on the Python side rather than relying
    # on SQLAlchemy's processor, which can't always infer the result type
    # of a cross-dialect builtin and crashes on a Date round-trip from
    # SQLite.
    bucket = func.date(column).label("date")
    stmt = (
        select(bucket, func.count().label("count"))
        .where(column >= floor)
        .group_by(bucket)
        .order_by(bucket)
    )
    if where is not None:
        for clause in where:
            stmt = stmt.where(clause)
    rows = (await db.execute(stmt)).all()
    return [{"date": str(r.date), "count": int(r.count)} for r in rows]


def _pad_buckets(
    buckets: list[dict[str, Any]], days: int = 30
) -> list[dict[str, Any]]:
    """Fill in zero-count days so the chart has a continuous x-axis.

    ``buckets`` arrives sorted ascending. We walk through the last
    ``days`` calendar dates and emit `{date, count}` for each, pulling
    the count from the input map.
    """
    today = datetime.now(UTC).date()
    by_date = {b["date"]: b["count"] for b in buckets}
    result: list[dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        key = d.isoformat()
        result.append({"date": key, "count": by_date.get(key, 0)})
    return result


async def _growth(db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
    signups = await _daily_buckets(db, User.created_at, days=30)
    creates = await _daily_buckets(
        db,
        Share.created_at,
        where=[Share.deleted_at.is_(None)],
        days=30,
    )
    return {
        "daily_signups_30d": _pad_buckets(signups, days=30),
        "daily_share_creates_30d": _pad_buckets(creates, days=30),
    }


# ---- Top lists --------------------------------------------------------------


async def _top_owners(db: AsyncSession) -> list[dict[str, Any]]:
    """Top 10 owners by published-share count."""
    stmt = (
        select(
            User.id,
            User.email,
            User.name,
            func.count(Share.id).label("share_count"),
        )
        .join(Share, Share.owner_user_id == User.id)
        .where(
            Share.published_at.is_not(None),
            Share.deleted_at.is_(None),
        )
        .group_by(User.id, User.email, User.name)
        .order_by(func.count(Share.id).desc())
        .limit(10)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "user_id": str(r.id),
            "email": r.email,
            "name": r.name,
            "share_count": int(r.share_count),
        }
        for r in rows
    ]


async def _top_shares_30d(db: AsyncSession) -> list[dict[str, Any]]:
    """Top 10 shares by view count over the last 30 days."""
    floor = datetime.now(UTC) - timedelta(days=30)
    stmt = (
        select(
            Share.id,
            Share.short_code,
            Share.name,
            func.count(ShareView.id).label("view_count"),
        )
        .join(ShareView, ShareView.share_id == Share.id)
        .where(
            ShareView.viewed_at >= floor,
            Share.deleted_at.is_(None),
        )
        .group_by(Share.id, Share.short_code, Share.name)
        .order_by(func.count(ShareView.id).desc())
        .limit(10)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "share_id": str(r.id),
            "short_code": r.short_code,
            "name": r.name,
            "view_count_30d": int(r.view_count),
        }
        for r in rows
    ]


async def _top_tags(db: AsyncSession) -> list[dict[str, Any]]:
    """Top 10 tags by current `usage_count` (denormalised, see Tag model)."""
    stmt = (
        select(Tag.slug, Tag.label, Tag.usage_count)
        .where(Tag.usage_count > 0)
        .order_by(Tag.usage_count.desc())
        .limit(10)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {"slug": r.slug, "label": r.label, "usage_count": int(r.usage_count)} for r in rows
    ]


# ---- Recent activity --------------------------------------------------------


async def _recent_signups(db: AsyncSession) -> list[dict[str, Any]]:
    stmt = (
        select(User.id, User.email, User.name, User.avatar_url, User.image, User.created_at)
        .order_by(User.created_at.desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "user_id": str(r.id),
            "email": r.email,
            "name": r.name,
            # Prefer the BA-managed `image`, fall back to the legacy `avatar_url`.
            "avatar_url": r.avatar_url or r.image,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


async def _recent_feedback(db: AsyncSession) -> list[dict[str, Any]]:
    stmt = (
        select(
            Feedback.id,
            Feedback.user_id,
            Feedback.type,
            Feedback.title,
            Feedback.description,
            Feedback.created_at,
        )
        .order_by(Feedback.created_at.desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": str(r.id),
            "user_id": str(r.user_id) if r.user_id else None,
            "type": r.type,
            "title": r.title,
            # Trim long descriptions — the dashboard wants a preview, not the
            # whole thing. Caller can re-fetch if a deeper view ships later.
            "description_preview": (r.description or "")[:200],
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


async def _recent_reports(db: AsyncSession) -> list[dict[str, Any]]:
    stmt = (
        select(
            ShareReport.id,
            ShareReport.share_id,
            ShareReport.reason,
            ShareReport.status,
            ShareReport.created_at,
            Share.short_code,
            Share.name,
        )
        .join(Share, Share.id == ShareReport.share_id)
        .order_by(ShareReport.created_at.desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "report_id": str(r.id),
            "share_id": str(r.share_id),
            "share_short_code": r.short_code,
            "share_name": r.name,
            "reason": r.reason.value if hasattr(r.reason, "value") else r.reason,
            "status": r.status.value if hasattr(r.status, "value") else r.status,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ---- Storage + health snapshot ---------------------------------------------


# Tables we surface size for. Picked by hand because they're the only
# ones that grow proportional to user activity; everything else is bounded.
_STORAGE_TABLES: tuple[str, ...] = (
    "share_views",
    "share_items",
    "shares",
    "papers",
    "users",
)


async def _storage(db: AsyncSession) -> dict[str, Any]:
    """Surface R2 PDF tally + PG table sizes + last cron timestamps.

    PG-only — ``pg_total_relation_size`` returns NULL on SQLite, in which
    case we degrade to per-table row COUNTs as a best-effort fallback so
    tests don't crash.
    """
    # R2 PDF count + cumulative bytes (from the share_items rows).
    pdf_row = (
        await db.execute(
            select(
                func.count().label("count"),
                func.coalesce(func.sum(ShareItem.file_size_bytes), 0).label("bytes"),
            ).where(ShareItem.kind == "pdf")
        )
    ).one()

    # Postgres-specific table size lookup. SQLite has no equivalent, so
    # we catch and degrade. ``pg_total_relation_size('table_name')`` returns
    # bytes including indexes + toast.
    table_sizes: list[dict[str, Any]] = []
    dialect = db.bind.dialect.name if db.bind else "postgresql"
    if dialect == "postgresql":
        for table in _STORAGE_TABLES:
            # Parametric quoting — ``func.pg_total_relation_size`` takes the
            # table name as a regclass; passing the literal table name as a
            # string is the documented regclass-cast path.
            size = await db.scalar(select(func.pg_total_relation_size(table)))
            table_sizes.append(
                {
                    "table": table,
                    "bytes": int(size) if size is not None else None,
                }
            )
    else:
        # SQLite test path: still emit a row per table with NULL bytes so the
        # response shape is stable.
        for table in _STORAGE_TABLES:
            table_sizes.append({"table": table, "bytes": None})

    # Last cron timestamps. The trending + similar tables stamp `refreshed_at`
    # on every row of the most-recent run, so MAX(refreshed_at) is the
    # last-run sentinel.
    last_trending = await db.scalar(select(func.max(TrendingShare.refreshed_at)))
    last_similar = await db.scalar(select(func.max(ShareSimilar.refreshed_at)))
    last_orcid_sync = await db.scalar(select(func.max(OrcidSyncRun.started_at)))

    return {
        "r2_pdf_count": int(pdf_row.count or 0),
        "r2_pdf_bytes": int(pdf_row.bytes or 0),
        "table_sizes": table_sizes,
        "trending_last_run_at": last_trending.isoformat() if last_trending else None,
        "similar_last_run_at": last_similar.isoformat() if last_similar else None,
        "orcid_sync_last_run_at": last_orcid_sync.isoformat() if last_orcid_sync else None,
    }


# ---- Top-level entry point --------------------------------------------------


async def build_overview(db: AsyncSession) -> dict[str, Any]:
    """Return the full overview payload — every section in one go.

    Caller (the route) wraps this in a 60-second TTL cache so the
    aggregate cost is amortised across rapid refreshes from the admin
    dashboard.
    """
    return {
        "counters": await _counters(db),
        "growth": await _growth(db),
        "top_lists": {
            "owners_by_shares": await _top_owners(db),
            "shares_by_views_30d": await _top_shares_30d(db),
            "tags_by_usage": await _top_tags(db),
        },
        "recent": {
            "signups": await _recent_signups(db),
            "feedback": await _recent_feedback(db),
            "reports": await _recent_reports(db),
        },
        "storage": await _storage(db),
        "generated_at": datetime.now(UTC).isoformat(),
    }
