import uuid
from datetime import UTC, datetime

from sqlalchemy import Date, cast, func, select, text, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.core.security import generate_short_code
from myetal_api.models import Share, ShareItem, SharePaper, ShareSimilar, ShareView
from myetal_api.schemas.share import (
    BrowseShareResult,
    DailyViewCount,
    RelatedShareOut,
    ShareAnalyticsResponse,
    ShareCreate,
    ShareItemCreate,
    ShareSearchResult,
    ShareUpdate,
    SimilarShareOut,
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


async def list_sitemap_shares(
    db: AsyncSession,
) -> list[dict[str, str]]:
    """Return `[{short_code, updated_at}]` for every share that should appear
    in the public sitemap: `is_public=True`, `published_at IS NOT NULL`,
    `deleted_at IS NULL`.

    Lightweight query — only selects two columns to keep the payload small
    even for tens-of-thousands of published shares.
    """
    rows = (
        await db.execute(
            select(Share.short_code, Share.updated_at).where(
                Share.is_public.is_(True),
                Share.published_at.is_not(None),
                Share.deleted_at.is_(None),
            )
        )
    ).all()
    return [{"short_code": r.short_code, "updated_at": r.updated_at.isoformat()} for r in rows]


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
        daily_views=[DailyViewCount(date=str(r.date), count=r.count) for r in daily_rows],
    )


async def get_related_shares(db: AsyncSession, share: Share) -> list[RelatedShareOut]:
    """Other published, public shares that contain at least one paper in common.

    Uses the `share_papers` join table — cheap because it's keyed on
    (share_id, paper_id) with an index on paper_id.  Per D8.
    """
    sp1 = SharePaper.__table__.alias("sp1")
    sp2 = SharePaper.__table__.alias("sp2")
    s = Share.__table__.alias("s")

    stmt = (
        select(
            s.c.short_code,
            s.c.name,
            func.count().label("papers_in_common"),
        )
        .select_from(
            sp1.join(sp2, sp1.c.paper_id == sp2.c.paper_id).join(s, s.c.id == sp2.c.share_id)
        )
        .where(
            sp1.c.share_id == share.id,
            sp2.c.share_id != share.id,
            s.c.is_public.is_(True),
            s.c.published_at.is_not(None),
            s.c.deleted_at.is_(None),
        )
        .group_by(s.c.short_code, s.c.name)
        .order_by(func.count().desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).all()
    return [
        RelatedShareOut(
            short_code=r.short_code,
            name=r.name,
            papers_in_common=r.papers_in_common,
        )
        for r in rows
    ]


async def get_similar_shares(db: AsyncSession, share: Share) -> list[SimilarShareOut]:
    """Precomputed similar shares from the nightly `share_similar` table.

    Unions both directions because the table stores canonical-ordered pairs
    (a < b). Per D9.
    """
    ss = ShareSimilar.__table__
    s = Share.__table__.alias("s")

    # Direction A: current share is share_id_a
    q_a = select(
        ss.c.share_id_b.label("similar_share_id"),
        ss.c.papers_in_common,
    ).where(ss.c.share_id_a == share.id)

    # Direction B: current share is share_id_b
    q_b = select(
        ss.c.share_id_a.label("similar_share_id"),
        ss.c.papers_in_common,
    ).where(ss.c.share_id_b == share.id)

    combined = union_all(q_a, q_b).subquery("x")

    stmt = (
        select(s.c.short_code, s.c.name, combined.c.papers_in_common)
        .select_from(combined.join(s, s.c.id == combined.c.similar_share_id))
        .where(
            s.c.deleted_at.is_(None),
            s.c.published_at.is_not(None),
        )
        .order_by(combined.c.papers_in_common.desc())
        .limit(5)
    )
    rows = (await db.execute(stmt)).all()
    return [
        SimilarShareOut(
            short_code=r.short_code,
            name=r.name,
            papers_in_common=r.papers_in_common,
        )
        for r in rows
    ]


async def search_published_shares(
    db: AsyncSession,
    query: str,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[ShareSearchResult], bool]:
    """Full-text trigram search over published public shares.

    Uses pg_trgm's ``%`` (similarity) operator so partial matches and
    typos are handled.  Returns ``(results, has_more)`` where
    ``has_more`` is True when there are additional rows beyond `offset +
    limit`.

    The query runs under a 3-second statement timeout (``SET LOCAL``) as
    defence-in-depth against pathological inputs.
    """
    # Safety: per-statement timeout inside this transaction
    await db.execute(text("SET LOCAL statement_timeout = '3000'"))

    # Fetch limit+1 to derive has_more without a COUNT(*)
    fetch_limit = limit + 1

    search_sql = text("""
        SELECT
            s.id          AS share_id,
            s.short_code,
            s.name,
            s.description,
            s.type,
            s.published_at,
            s.updated_at,
            u.name        AS owner_name,
            COUNT(si.id)  AS item_count,
            GREATEST(
                similarity(s.name, :query),
                similarity(COALESCE(s.description, ''), :query)
            ) AS relevance
        FROM shares s
        LEFT JOIN users u       ON u.id  = s.owner_user_id
        LEFT JOIN share_items si ON si.share_id = s.id
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
          AND (
              s.name        % :query
           OR s.description % :query
           OR u.name        % :query
          )
        GROUP BY s.id, u.name
        ORDER BY relevance DESC, s.published_at DESC
        LIMIT :fetch_limit OFFSET :offset
    """).bindparams(query=query, fetch_limit=fetch_limit, offset=offset)

    rows = (await db.execute(search_sql)).all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return [], False

    # Batch-fetch the first 3 item titles for each share in the result set
    share_ids = [r.share_id for r in rows]
    preview_sql = text("""
        SELECT share_id, title
        FROM (
            SELECT
                si.share_id,
                si.title,
                ROW_NUMBER() OVER (PARTITION BY si.share_id ORDER BY si.position) AS rn
            FROM share_items si
            WHERE si.share_id = ANY(:share_ids)
        ) sub
        WHERE rn <= 3
    """).bindparams(share_ids=share_ids)

    preview_rows = (await db.execute(preview_sql)).all()

    previews: dict[uuid.UUID, list[str]] = {}
    for pr in preview_rows:
        previews.setdefault(pr.share_id, []).append(pr.title)

    results = [
        ShareSearchResult(
            short_code=r.short_code,
            name=r.name,
            description=r.description,
            type=r.type,
            owner_name=r.owner_name,
            item_count=r.item_count,
            published_at=r.published_at,
            updated_at=r.updated_at,
            preview_items=previews.get(r.share_id, []),
        )
        for r in rows
    ]
    return results, has_more


async def browse_published_shares(
    db: AsyncSession,
) -> tuple[list[BrowseShareResult], list[BrowseShareResult], int]:
    """Returns (trending, recent, total_count) for the browse page.

    Trending: top 5 from ``trending_shares`` (7-day view-weighted score).
    Recent:   last 5 (or 10 if trending < 3) by ``published_at DESC``.
    Total:    COUNT of all published, public, non-deleted shares.
    """
    # ── Trending ────────────────────────────────────────────────────────
    trending_sql = text("""
        SELECT
            ts.share_id,
            ts.score,
            ts.view_count_7d,
            s.short_code,
            s.name,
            s.description,
            s.type,
            s.published_at,
            s.updated_at,
            u.name AS owner_name,
            COUNT(si.id) AS item_count
        FROM trending_shares ts
        JOIN shares s ON s.id = ts.share_id
        LEFT JOIN users u ON u.id = s.owner_user_id
        LEFT JOIN share_items si ON si.share_id = s.id
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
        GROUP BY ts.share_id, ts.score, ts.view_count_7d,
                 s.short_code, s.name, s.description, s.type,
                 s.published_at, s.updated_at, u.name
        ORDER BY ts.score DESC
        LIMIT 5
    """)
    trending_rows = (await db.execute(trending_sql)).all()

    # ── Recent ──────────────────────────────────────────────────────────
    recent_limit = 10 if len(trending_rows) < 3 else 5
    recent_sql = text("""
        SELECT
            s.id AS share_id,
            s.short_code,
            s.name,
            s.description,
            s.type,
            s.published_at,
            s.updated_at,
            u.name AS owner_name,
            COUNT(si.id) AS item_count
        FROM shares s
        LEFT JOIN users u ON u.id = s.owner_user_id
        LEFT JOIN share_items si ON si.share_id = s.id
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
        GROUP BY s.id, s.short_code, s.name, s.description, s.type,
                 s.published_at, s.updated_at, u.name
        ORDER BY s.published_at DESC
        LIMIT :recent_limit
    """).bindparams(recent_limit=recent_limit)
    recent_rows = (await db.execute(recent_sql)).all()

    # ── Total count ─────────────────────────────────────────────────────
    count_sql = text("""
        SELECT COUNT(*) AS cnt FROM shares
        WHERE is_public = true
          AND published_at IS NOT NULL
          AND deleted_at IS NULL
    """)
    total_published = (await db.execute(count_sql)).scalar_one()

    # ── Preview items (batch for both sets) ─────────────────────────────
    all_share_ids = [r.share_id for r in trending_rows] + [r.share_id for r in recent_rows]
    previews: dict[uuid.UUID, list[str]] = {}
    if all_share_ids:
        # Deduplicate to avoid redundant rows
        unique_ids = list(set(all_share_ids))
        preview_sql = text("""
            SELECT share_id, title
            FROM (
                SELECT
                    si.share_id,
                    si.title,
                    ROW_NUMBER() OVER (PARTITION BY si.share_id ORDER BY si.position) AS rn
                FROM share_items si
                WHERE si.share_id = ANY(:share_ids)
            ) sub
            WHERE rn <= 3
        """).bindparams(share_ids=unique_ids)
        preview_rows = (await db.execute(preview_sql)).all()
        for pr in preview_rows:
            previews.setdefault(pr.share_id, []).append(pr.title)

    # ── Assemble results ────────────────────────────────────────────────
    trending = [
        BrowseShareResult(
            short_code=r.short_code,
            name=r.name,
            description=r.description,
            type=r.type,
            owner_name=r.owner_name,
            item_count=r.item_count,
            published_at=r.published_at,
            updated_at=r.updated_at,
            preview_items=previews.get(r.share_id, []),
            view_count=r.view_count_7d,
        )
        for r in trending_rows
    ]

    recent = [
        BrowseShareResult(
            short_code=r.short_code,
            name=r.name,
            description=r.description,
            type=r.type,
            owner_name=r.owner_name,
            item_count=r.item_count,
            published_at=r.published_at,
            updated_at=r.updated_at,
            preview_items=previews.get(r.share_id, []),
        )
        for r in recent_rows
    ]

    return trending, recent, total_published


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
