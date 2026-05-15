import uuid
from datetime import UTC, datetime

from sqlalchemy import Date, cast, func, select, text, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.core.security import generate_short_code
from myetal_api.models import (
    ItemKind,
    Share,
    ShareItem,
    SharePaper,
    ShareSimilar,
    ShareView,
    Tag,
    User,
)
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
    TagOut,
    UserPublicOut,
    UserSearchResult,
)
from myetal_api.services import tags as tags_service

_MAX_SHORT_CODE_ATTEMPTS = 10


class ShortCodeCollision(Exception):
    """Could not generate a unique short code after several attempts."""


async def create_share(
    db: AsyncSession,
    owner_id: uuid.UUID,
    payload: ShareCreate,
) -> Share:
    # Pre-validate tags before persisting the share so a bad slug
    # doesn't leak an empty share.
    canonical_tags: list[str] | None = None
    if payload.tags is not None:
        if len(payload.tags) > tags_service.MAX_TAGS_PER_SHARE:
            raise tags_service.TooManyTags(
                f"a share may have at most {tags_service.MAX_TAGS_PER_SHARE} tags "
                f"(got {len(payload.tags)})"
            )
        canonical_tags = [tags_service.canonicalize(t) for t in payload.tags]

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

    # Attach tags after the share row exists. Slugs were already
    # validated above, so set_share_tags can't raise on canonicalisation.
    if canonical_tags is not None:
        await tags_service.set_share_tags(db, share.id, canonical_tags)

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
    stmt = (
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.tags))
        .where(Share.owner_user_id == owner_id)
    )
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
        .options(selectinload(Share.items), selectinload(Share.tags))
        .where(Share.id == share_id, Share.owner_user_id == owner_id)
    )


async def get_public_share(db: AsyncSession, short_code: str) -> Share | None:
    """Public read of a share by short_code. Tombstoned shares are EXCLUDED.
    Unpublished shares are also EXCLUDED (K3 fix-up): a draft with
    ``is_public=True`` but ``published_at IS NULL`` is link-private —
    only the owner sees it from their dashboard. The public viewer
    requires both flags so a draft (which may include uploaded PDFs and
    other binaries) is never served to anonymous visitors.

    Routes that need to distinguish 404 (never existed) from 410 (was
    tombstoned) should use `get_public_share_with_tombstone` instead.
    Per D-BL2 + D14.
    """
    return await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner), selectinload(Share.tags))
        .where(
            Share.short_code == short_code,
            Share.is_public.is_(True),
            Share.deleted_at.is_(None),
            Share.published_at.is_not(None),
        )
    )


async def get_public_share_with_tombstone(
    db: AsyncSession, short_code: str
) -> tuple[Share | None, bool]:
    """Returns (share, was_tombstoned).

    - (Share, False) → live share, render normally.
    - (None,  True)  → a share existed under this short_code but is tombstoned;
                       caller returns 410 Gone.
    - (None,  False) → no share has ever had this short_code OR the
                       share exists but is unpublished (a draft must
                       not leak via the public viewer — K3 fix-up);
                       caller returns 404.

    Per D-BL2 + D14. Used by routes that want to give search engines a clean
    "this URL is gone" signal rather than a misleading 404. Unpublished
    drafts return plain 404 (not 410) — they were never publicly visible
    so a search engine never indexed them; there's nothing to retract.
    """
    share = await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner), selectinload(Share.tags))
        .where(Share.short_code == short_code, Share.is_public.is_(True))
    )
    if share is None:
        return None, False
    if share.deleted_at is not None:
        return None, True
    if share.published_at is None:
        # K3 fix-up: an is_public=True draft is NOT publicly viewable.
        # Treat it as 404 (never existed publicly) rather than 410.
        return None, False
    return share, False


async def update_share(db: AsyncSession, share: Share, payload: ShareUpdate) -> Share:
    # Pre-validate tags before persisting the share so a bad slug
    # doesn't leak partial updates.
    canonical_tags: list[str] | None = None
    if payload.tags is not None:
        if len(payload.tags) > tags_service.MAX_TAGS_PER_SHARE:
            raise tags_service.TooManyTags(
                f"a share may have at most {tags_service.MAX_TAGS_PER_SHARE} tags "
                f"(got {len(payload.tags)})"
            )
        canonical_tags = [tags_service.canonicalize(t) for t in payload.tags]

    if payload.name is not None:
        share.name = payload.name
    if payload.description is not None:
        share.description = payload.description
    if payload.type is not None:
        share.type = payload.type
    if payload.is_public is not None:
        share.is_public = payload.is_public

    if payload.items is not None:
        # K1 (PR-C fix-up): PDF items must NOT be re-created from a
        # client-supplied payload — the schema already rejects
        # ``kind=pdf`` in ShareItemCreate, but the editor round-trips
        # existing PDF items by id when it PATCHes the full items list.
        # Strategy: lift the existing PDF rows out before clearing, then
        # for each incoming item with a matching id pointing at an
        # existing PDF row, re-attach the existing row (preserving its
        # server-managed file_url / thumbnail_url / file_size_bytes /
        # file_mime / copyright_ack_at) at the requested position with
        # editable fields (title, subtitle, notes) updated. Items
        # without a matching id are inserted as fresh non-PDF rows via
        # ``_make_item``.
        existing_pdf_by_id: dict[uuid.UUID, ShareItem] = {
            it.id: it for it in share.items if it.kind == ItemKind.PDF
        }
        # Detach all rows; we'll re-add the kept PDFs and the new items
        # below. Rows that aren't re-added are removed by delete-orphan.
        share.items.clear()
        for index, item in enumerate(payload.items):
            if item.id is not None and item.id in existing_pdf_by_id:
                # Round-trip an existing PDF: preserve all server-managed
                # PDF fields, update only the position + editable text.
                existing = existing_pdf_by_id[item.id]
                existing.position = index
                existing.title = item.title
                existing.subtitle = item.subtitle
                existing.notes = item.notes
                share.items.append(existing)
            else:
                # Fresh non-PDF item (the schema already rejected
                # ``kind=pdf`` so this can't smuggle a PDF row in).
                share.items.append(_make_item(index, item))

    # Flush items to the session so they're visible inside this transaction
    # without committing yet — set_share_tags below participates in the same
    # transaction and we commit once at the end.
    await db.flush()

    if canonical_tags is not None:
        # Atomic replace via tags service — handles canonicalisation,
        # auto-create, usage_count maintenance, and the 5-tag cap (Q10).
        await tags_service.set_share_tags(db, share.id, canonical_tags, commit=False)

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
        return await _reload_with_items(db, share.id)
    return share


async def unpublish_share(db: AsyncSession, share: Share) -> Share:
    """Reverse `publish_share` — keep the URL alive but drop from discovery."""
    if share.published_at is not None:
        share.published_at = None
        await db.commit()
        return await _reload_with_items(db, share.id)
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

    # Author-name search (B1): users complained that searching a paper's author
    # name returned nothing.  We expand the WHERE clause so a share matches when
    # any of its attached papers (papers.authors, joined via share_papers) OR
    # any of its share_items (share_items.authors, the legacy item-level field)
    # contains the query as a case-insensitive substring.  We use ILIKE rather
    # than pg_trgm `%` for the author signal because the authors column stores
    # full author lists ("A. Smith; B. Jones; C. Lee") which trigram similarity
    # scores poorly against a single name token.  The author signal is OR'd
    # alongside the existing title/description/owner trigram signals.
    #
    # The relevance score still uses trigram similarity on name+description
    # (those have a GiST index from migration 0007); a small constant boost is
    # added when the author signal hits so author-only matches still rank above
    # the noise floor.
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
            COUNT(DISTINCT si.id)  AS item_count,
            GREATEST(
                similarity(s.name, :query),
                similarity(COALESCE(s.description, ''), :query),
                CASE
                    WHEN bool_or(si.authors ILIKE :ilike_query)
                      OR bool_or(p.authors  ILIKE :ilike_query)
                    THEN 0.3
                    ELSE 0
                END
            ) AS relevance
        FROM shares s
        LEFT JOIN users u        ON u.id  = s.owner_user_id
        LEFT JOIN share_items si ON si.share_id = s.id
        LEFT JOIN share_papers sp ON sp.share_id = s.id
        LEFT JOIN papers p        ON p.id = sp.paper_id
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
          AND (
              s.name        % :query
           OR s.description % :query
           OR u.name        % :query
           OR EXISTS (
                SELECT 1 FROM share_items si2
                WHERE si2.share_id = s.id AND si2.authors ILIKE :ilike_query
              )
           OR EXISTS (
                SELECT 1
                FROM share_papers sp2
                JOIN papers p2 ON p2.id = sp2.paper_id
                WHERE sp2.share_id = s.id AND p2.authors ILIKE :ilike_query
              )
          )
        GROUP BY s.id, u.name
        ORDER BY relevance DESC, s.published_at DESC
        LIMIT :fetch_limit OFFSET :offset
    """).bindparams(
        query=query,
        ilike_query=f"%{query}%",
        fetch_limit=fetch_limit,
        offset=offset,
    )

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

    tags_by_share = await _fetch_tags_for_shares(db, share_ids)

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
            tags=tags_by_share.get(r.share_id, []),
        )
        for r in rows
    ]
    return results, has_more


async def browse_published_shares(
    db: AsyncSession,
    *,
    tags: list[str] | None = None,
    sort: str = "recent",
    owner_id: uuid.UUID | None = None,
) -> tuple[list[BrowseShareResult], list[BrowseShareResult], int]:
    """Returns (trending, recent, total_count) for the browse page.

    Trending: top 5 from ``trending_shares`` (7-day view-weighted score).
    Recent:   last 5 (or 10 if trending < 3) by ``published_at DESC``.
    Total:    COUNT of all published, public, non-deleted shares.

    Optional filters (per feedback-round-2 §2 / §4, Q14-A; §5 PR-B for
    ``owner_id``):

    * ``tags`` — list of tag slugs. When non-empty, results are
      restricted to shares whose tag set intersects (OR semantics —
      "more permissive, more useful for discovery"). Slugs must
      already be canonical; the route layer canonicalises before
      calling.
    * ``sort`` — ``"recent"`` (default) keeps the existing
      ``published_at DESC`` order on the recent block. ``"popular"``
      orders the recent block by the trending score (joining
      ``trending_shares.score`` with a ``COALESCE(..., 0)`` fallback so
      shares with no recorded views still appear, just at the bottom).
      The trending block itself is always ``score DESC``.
    * ``owner_id`` — restrict to shares owned by this user (Q15-C). All
      filters stack: ``?tags=virology&owner_id=...&sort=popular`` is
      "Alice's published virology shares, popular first."

    Cache-key implication: the route uses these params in the URL, so
    the CDN edge cache fragments per (tags, sort, owner_id) combination
    — fine for the high-traffic combos (no params, single popular tag,
    ``sort=recent``) which dominate.
    """
    has_tag_filter = bool(tags)
    has_owner_filter = owner_id is not None

    # Reusable WHERE-fragment + params.  Tag filter uses an EXISTS
    # subquery against share_tags + tags so a share matching ANY of
    # the given slugs (OR) is included.  The slugs come in already
    # canonicalised; using ``= ANY(:tag_slugs)`` works on Postgres and
    # ``slug IN (...)`` is identical from the planner's POV.
    tag_join = (
        """
          AND EXISTS (
              SELECT 1 FROM share_tags st
              JOIN tags t ON t.id = st.tag_id
              WHERE st.share_id = s.id AND t.slug = ANY(:tag_slugs)
          )
        """
        if has_tag_filter
        else ""
    )

    # Owner filter — straightforward equality on the indexed FK column.
    # Stacks with the tag and sort filters above.
    owner_clause = " AND s.owner_user_id = :owner_id" if has_owner_filter else ""

    # ── Trending ────────────────────────────────────────────────────────
    # ``tag_join`` is a hardcoded SQL fragment (no user input); the tag
    # slugs themselves are passed as a bound parameter. S608 is a false
    # positive on the f-string interpolation here.
    trending_sql_str = f"""
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
          {tag_join}
          {owner_clause}
        GROUP BY ts.share_id, ts.score, ts.view_count_7d,
                 s.short_code, s.name, s.description, s.type,
                 s.published_at, s.updated_at, u.name
        ORDER BY ts.score DESC
        LIMIT 5
    """  # noqa: S608
    trending_sql = text(trending_sql_str)
    trending_params: dict[str, object] = {}
    if has_tag_filter:
        trending_params["tag_slugs"] = tags
    if has_owner_filter:
        trending_params["owner_id"] = owner_id
    if trending_params:
        trending_sql = trending_sql.bindparams(**trending_params)
    trending_rows = (await db.execute(trending_sql)).all()

    # ── Recent ──────────────────────────────────────────────────────────
    recent_limit = 10 if len(trending_rows) < 3 else 5
    # When sort=popular, order the "recent" block by trending score
    # rather than published_at. Fall back to published_at DESC inside
    # the score ordering so untracked/zero-score shares still sort
    # consistently.  The trending_shares LEFT JOIN keeps shares with
    # no view records visible (vs an INNER JOIN that would silently
    # hide them).
    sort_order = (
        "ORDER BY COALESCE(ts.score, 0) DESC, s.published_at DESC"
        if sort == "popular"
        else "ORDER BY s.published_at DESC"
    )
    recent_sql_str = f"""
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
        LEFT JOIN trending_shares ts ON ts.share_id = s.id
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
          {tag_join}
          {owner_clause}
        GROUP BY s.id, s.short_code, s.name, s.description, s.type,
                 s.published_at, s.updated_at, u.name, ts.score
        {sort_order}
        LIMIT :recent_limit
    """  # noqa: S608
    recent_sql = text(recent_sql_str)
    recent_params: dict[str, object] = {"recent_limit": recent_limit}
    if has_tag_filter:
        recent_params["tag_slugs"] = tags
    if has_owner_filter:
        recent_params["owner_id"] = owner_id
    recent_sql = recent_sql.bindparams(**recent_params)
    recent_rows = (await db.execute(recent_sql)).all()

    # ── Total count ─────────────────────────────────────────────────────
    count_sql_str = f"""
        SELECT COUNT(*) AS cnt FROM shares s
        WHERE s.is_public = true
          AND s.published_at IS NOT NULL
          AND s.deleted_at IS NULL
          {tag_join}
          {owner_clause}
    """  # noqa: S608
    count_sql = text(count_sql_str)
    count_params: dict[str, object] = {}
    if has_tag_filter:
        count_params["tag_slugs"] = tags
    if has_owner_filter:
        count_params["owner_id"] = owner_id
    if count_params:
        count_sql = count_sql.bindparams(**count_params)
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

    # ── Tags per share (batch) ──────────────────────────────────────────
    tags_by_share = await _fetch_tags_for_shares(db, all_share_ids)

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
            tags=tags_by_share.get(r.share_id, []),
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
            tags=tags_by_share.get(r.share_id, []),
        )
        for r in recent_rows
    ]

    return trending, recent, total_published


async def _fetch_tags_for_shares(
    db: AsyncSession,
    share_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[TagOut]]:
    """Batch-fetch tag rows attached to a list of shares.

    Returns ``{share_id: [TagOut, ...]}``. Empty dict if ``share_ids``
    is empty (avoids issuing a no-op query). Used by both browse and
    search assemblers — N+1 avoided.
    """
    if not share_ids:
        return {}
    from myetal_api.models import ShareTag

    unique_ids = list(set(share_ids))
    rows = (
        await db.execute(
            select(
                ShareTag.share_id,
                Tag.id,
                Tag.slug,
                Tag.label,
                Tag.usage_count,
            )
            .join(Tag, Tag.id == ShareTag.tag_id)
            .where(ShareTag.share_id.in_(unique_ids))
            .order_by(Tag.label)
        )
    ).all()
    out: dict[uuid.UUID, list[TagOut]] = {}
    for r in rows:
        out.setdefault(r.share_id, []).append(
            TagOut(id=r.id, slug=r.slug, label=r.label, usage_count=r.usage_count)
        )
    return out


async def get_user_public_card(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> UserPublicOut | None:
    """Public-safe view of a user, with their published-share count.

    Returns None when no user with this id exists. The route uses this
    to distinguish 404 (no such user) from 200-with-empty-shares (user
    exists but has nothing published yet — Q15-C empty-state).

    The ``share_count`` is computed in a single query via a correlated
    scalar subquery rather than per-user (avoid N+1) — caller only
    fetches one user, so the cost is one round trip.
    """
    # Scalar subquery for the published-share count — matches the same
    # privacy filter as user search (only public + published + alive).
    count_subq = (
        select(func.count(Share.id))
        .where(
            Share.owner_user_id == User.id,
            Share.is_public.is_(True),
            Share.published_at.is_not(None),
            Share.deleted_at.is_(None),
        )
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                User.id,
                User.name,
                User.avatar_url,
                count_subq.label("share_count"),
            ).where(User.id == user_id)
        )
    ).first()
    if row is None:
        return None
    return UserPublicOut(
        id=row.id,
        name=row.name,
        avatar_url=row.avatar_url,
        share_count=row.share_count,
    )


async def search_published_users(
    db: AsyncSession,
    query: str,
    limit: int = 5,
) -> list[UserSearchResult]:
    """Top-N users matching ``query`` who have at least one published share.

    Per feedback-round-2 §5 (PR-B): search returns matching users
    alongside matching shares + paper authors. Privacy default — a user
    with only drafts / private shares is never surfaced via search.

    Postgres path uses ``pg_trgm`` similarity on ``users.name`` (typo-
    tolerant, GIN-indexed via migration 0013). SQLite test path falls
    back to a case-insensitive substring match — same semantics, no
    similarity scoring (the in-memory test harness can't run pg_trgm).

    The ``share_count`` for each matching user is computed inline as a
    single window expression rather than per-user round-trips (avoid
    N+1).
    """
    q_norm = query.strip()
    if len(q_norm) < 2:
        return []

    dialect = db.bind.dialect.name if db.bind is not None else "postgresql"

    # Privacy filter — a user is only visible to search when they own
    # at least one currently-public, currently-published, non-tombstoned
    # share. The same EXISTS subquery doubles as the share_count source
    # via a correlated scalar subquery.
    if dialect == "postgresql":
        # pg_trgm path — index-backed, typo-tolerant.
        sql = text(
            """
            SELECT
                u.id,
                u.name,
                u.avatar_url,
                (
                    SELECT COUNT(*) FROM shares s
                    WHERE s.owner_user_id = u.id
                      AND s.is_public = true
                      AND s.published_at IS NOT NULL
                      AND s.deleted_at IS NULL
                ) AS share_count
            FROM users u
            WHERE u.name % :q
              AND EXISTS (
                  SELECT 1 FROM shares s2
                  WHERE s2.owner_user_id = u.id
                    AND s2.is_public = true
                    AND s2.published_at IS NOT NULL
                    AND s2.deleted_at IS NULL
              )
            ORDER BY similarity(u.name, :q) DESC, u.name
            LIMIT :limit
            """
        ).bindparams(q=q_norm, limit=limit)
        rows = (await db.execute(sql)).all()
        return [
            UserSearchResult(
                id=r.id,
                name=r.name,
                avatar_url=r.avatar_url,
                share_count=r.share_count,
            )
            for r in rows
        ]

    # SQLite test fallback: case-insensitive substring match. The
    # share_count subquery is identical; ordering is by name so the
    # results are deterministic without similarity scoring.
    count_subq = (
        select(func.count(Share.id))
        .where(
            Share.owner_user_id == User.id,
            Share.is_public.is_(True),
            Share.published_at.is_not(None),
            Share.deleted_at.is_(None),
        )
        .scalar_subquery()
    )
    exists_clause = (
        select(Share.id)
        .where(
            Share.owner_user_id == User.id,
            Share.is_public.is_(True),
            Share.published_at.is_not(None),
            Share.deleted_at.is_(None),
        )
        .exists()
    )
    stmt = (
        select(
            User.id,
            User.name,
            User.avatar_url,
            count_subq.label("share_count"),
        )
        .where(
            User.name.is_not(None),
            User.name.ilike(f"%{q_norm}%"),
            exists_clause,
        )
        .order_by(User.name)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        UserSearchResult(
            id=r.id,
            name=r.name,
            avatar_url=r.avatar_url,
            share_count=r.share_count,
        )
        for r in rows
    ]


# ---------- internals ----------


async def _allocate_short_code(db: AsyncSession) -> str:
    for _ in range(_MAX_SHORT_CODE_ATTEMPTS):
        candidate = generate_short_code()
        existing = await db.scalar(select(Share).where(Share.short_code == candidate))
        if existing is None:
            return candidate
    raise ShortCodeCollision


def _make_item(position: int, payload: ShareItemCreate) -> ShareItem:
    # K1 (PR-C fix-up): the four PDF-only columns (file_url,
    # file_size_bytes, file_mime, thumbnail_url) are NEVER written from
    # a bulk-create / bulk-update payload. They're populated server-side
    # by ``record_pdf_upload`` after the R2 bytes have been validated.
    # The schema also rejects ``kind=pdf`` in ShareItemCreate so this
    # function only ever sees paper / repo / link kinds.
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
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.tags))
        .where(Share.id == share_id)
    )
    assert share is not None  # we just inserted it
    return share
