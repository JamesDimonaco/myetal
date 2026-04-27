import uuid
from datetime import UTC, datetime

from sqlalchemy import Date, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.core.security import generate_short_code
from myetal_api.models import Share, ShareItem, ShareView
from myetal_api.schemas.share import (
    DailyViewCount,
    ShareAnalyticsResponse,
    ShareCreate,
    ShareItemCreate,
    ShareUpdate,
)

_MAX_SHORT_CODE_ATTEMPTS = 10


class ShortCodeCollision(Exception):
    """Could not generate a unique short code after several attempts."""


async def create_share(
    db: AsyncSession,
    owner_id: uuid.UUID,
    payload: ShareCreate,
) -> Share:
    short_code = await _allocate_short_code(db)
    share = Share(
        owner_user_id=owner_id,
        short_code=short_code,
        name=payload.name,
        description=payload.description,
        type=payload.type,
        is_public=payload.is_public,
    )
    for index, item in enumerate(payload.items):
        share.items.append(_make_item(index, item))
    db.add(share)
    await db.commit()
    return await _reload_with_items(db, share.id)


async def list_user_shares(
    db: AsyncSession,
    owner_id: uuid.UUID,
    *,
    include_deleted: bool = False,
) -> list[Share]:
    """Owner's own shares. Tombstoned shares are excluded by default — set
    `include_deleted=True` for the (future) trash UI.

    Per discovery ticket D-BL2.
    """
    stmt = select(Share).options(selectinload(Share.items)).where(Share.owner_user_id == owner_id)
    if not include_deleted:
        stmt = stmt.where(Share.deleted_at.is_(None))
    result = await db.scalars(stmt.order_by(Share.created_at.desc()))
    return list(result.all())


async def get_share_for_owner(
    db: AsyncSession,
    share_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> Share | None:
    """Owner's own share — tombstoned shares INCLUDED.

    The owner can still see their tombstoned share (with a deleted banner
    rendered by the UI based on the `deleted_at` field). Per D-BL2.
    """
    return await db.scalar(
        select(Share)
        .options(selectinload(Share.items))
        .where(Share.id == share_id, Share.owner_user_id == owner_id)
    )


async def get_public_share(db: AsyncSession, short_code: str) -> Share | None:
    """Public read of a share by short_code. Tombstoned shares are EXCLUDED.

    Routes that need to distinguish 404 (never existed) from 410 (was
    tombstoned) should use `get_public_share_with_tombstone` instead.
    Per D-BL2 + D14.
    """
    return await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner))
        .where(
            Share.short_code == short_code,
            Share.is_public.is_(True),
            Share.deleted_at.is_(None),
        )
    )


async def get_public_share_with_tombstone(
    db: AsyncSession, short_code: str
) -> tuple[Share | None, bool]:
    """Returns (share, was_tombstoned).

    - (Share, False) → live share, render normally.
    - (None,  True)  → a share existed under this short_code but is tombstoned;
                       caller returns 410 Gone.
    - (None,  False) → no share has ever had this short_code; caller returns 404.

    Per D-BL2 + D14. Used by routes that want to give search engines a clean
    "this URL is gone" signal rather than a misleading 404.
    """
    share = await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner))
        .where(Share.short_code == short_code, Share.is_public.is_(True))
    )
    if share is None:
        return None, False
    if share.deleted_at is not None:
        return None, True
    return share, False


async def update_share(db: AsyncSession, share: Share, payload: ShareUpdate) -> Share:
    if payload.name is not None:
        share.name = payload.name
    if payload.description is not None:
        share.description = payload.description
    if payload.type is not None:
        share.type = payload.type
    if payload.is_public is not None:
        share.is_public = payload.is_public

    if payload.items is not None:
        # Replace strategy: clear the collection (delete-orphan cascade will
        # remove the existing rows on flush), then append the new items.
        share.items.clear()
        for index, item in enumerate(payload.items):
            share.items.append(_make_item(index, item))

    await db.commit()
    return await _reload_with_items(db, share.id)


async def tombstone_share(db: AsyncSession, share: Share) -> None:
    """Soft-delete: flips deleted_at = NOW().

    The row stays so future references (search-engine recrawl, social-media
    embeds, similar-shares panels on other shares) can return 410 Gone
    rather than 404. A separate cron permanently deletes rows where
    `deleted_at < now() - interval '30 days'` — by then crawlers have had
    time to drop the URL. Per D14.
    """
    share.deleted_at = datetime.now(UTC)
    await db.commit()


async def publish_share(db: AsyncSession, share: Share) -> Share:
    """Opt the share into discovery surfaces (sitemap, similar, future
    trending). Per D1 — sets `published_at = NOW()` if not already set."""
    if share.published_at is None:
        share.published_at = datetime.now(UTC)
        await db.commit()
    return share


async def unpublish_share(db: AsyncSession, share: Share) -> Share:
    """Reverse `publish_share` — keep the URL alive but drop from discovery."""
    if share.published_at is not None:
        share.published_at = None
        await db.commit()
    return share


async def get_share_analytics(
    db: AsyncSession,
    share_id: uuid.UUID,
) -> ShareAnalyticsResponse:
    """Compute view analytics for a share (D10).

    Two queries: one for the aggregate counts (total, 7d, 30d) and one for the
    daily breakdown over the last 30 days. Owner self-views are already excluded
    at write time so no filter is needed here.
    """
    now_expr = func.now()

    # Aggregate counts
    agg_stmt = select(
        func.count().label("total"),
        func.count()
        .filter(ShareView.viewed_at > now_expr - text("interval '7 days'"))
        .label("last_7d"),
        func.count()
        .filter(ShareView.viewed_at > now_expr - text("interval '30 days'"))
        .label("last_30d"),
    ).where(ShareView.share_id == share_id)

    agg_row = (await db.execute(agg_stmt)).one()

    # Daily breakdown (last 30 days)
    daily_stmt = (
        select(
            cast(ShareView.viewed_at, Date).label("date"),
            func.count().label("count"),
        )
        .where(
            ShareView.share_id == share_id,
            ShareView.viewed_at > now_expr - text("interval '30 days'"),
        )
        .group_by(cast(ShareView.viewed_at, Date))
        .order_by(cast(ShareView.viewed_at, Date))
    )

    daily_rows = (await db.execute(daily_stmt)).all()

    return ShareAnalyticsResponse(
        total_views=agg_row.total,
        views_last_7d=agg_row.last_7d,
        views_last_30d=agg_row.last_30d,
        daily_views=[
            DailyViewCount(date=str(r.date), count=r.count) for r in daily_rows
        ],
    )


# ---------- internals ----------


async def _allocate_short_code(db: AsyncSession) -> str:
    for _ in range(_MAX_SHORT_CODE_ATTEMPTS):
        candidate = generate_short_code()
        existing = await db.scalar(select(Share).where(Share.short_code == candidate))
        if existing is None:
            return candidate
    raise ShortCodeCollision


def _make_item(position: int, payload: ShareItemCreate) -> ShareItem:
    return ShareItem(
        position=position,
        kind=payload.kind,
        title=payload.title,
        subtitle=payload.subtitle,
        url=payload.url,
        image_url=payload.image_url,
        scholar_url=payload.scholar_url,
        doi=payload.doi,
        authors=payload.authors,
        year=payload.year,
        notes=payload.notes,
    )


async def _reload_with_items(db: AsyncSession, share_id: uuid.UUID) -> Share:
    share = await db.scalar(
        select(Share).options(selectinload(Share.items)).where(Share.id == share_id)
    )
    assert share is not None  # we just inserted it
    return share
