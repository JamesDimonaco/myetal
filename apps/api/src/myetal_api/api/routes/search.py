"""Public share search & browse endpoints.

Trigram-similarity search over published, public shares.  No auth
required.  Rate-limited separately from other anonymous reads because
the GiST index scan is more expensive than a single-share lookup.

The browse endpoint returns trending + recently-published collections
without any search query — used as the default view before the user
starts typing.
"""

import logging

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy.exc import OperationalError

from myetal_api.api.deps import DbSession
from myetal_api.core.rate_limit import (
    BROWSE_LIMIT,
    SEARCH_LIMIT,
    TAG_AUTOCOMPLETE_LIMIT,
    limiter,
)
from myetal_api.schemas.share import BrowseResponse, ShareSearchResponse, TagOut
from myetal_api.services import share as share_service
from myetal_api.services import tags as tags_service
from myetal_api.services.tags import InvalidTagSlug

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["search"])

_VALID_BROWSE_SORTS = {"recent", "popular"}


@router.get("/browse", response_model=BrowseResponse)
@limiter.limit(BROWSE_LIMIT)
async def browse_shares(
    request: Request,
    response: Response,
    db: DbSession,
    tags: str | None = Query(
        default=None,
        max_length=500,
        description=(
            "Comma-separated tag slugs to filter by. Multiple tags use OR "
            "semantics (a share matches if it has any of the given tags). "
            "Slugs are canonicalised server-side before filtering."
        ),
    ),
    sort: str = Query(
        default="recent",
        description="Sort order for the recent block: 'recent' or 'popular'.",
    ),
) -> BrowseResponse:
    """Browse trending and recently-published collections.

    Returns the same data for every caller — no auth, no personalisation.
    Aggressively cached at the CDN / reverse-proxy layer via
    ``Cache-Control: public, s-maxage=300``.

    Optional filters per Q14-A: ``tags`` (comma-list, OR semantics) and
    ``sort`` (``recent`` or ``popular``).  Cache key naturally includes
    these query params.
    """
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=3600"

    if sort not in _VALID_BROWSE_SORTS:
        sort = "recent"

    tag_slugs: list[str] | None = None
    if tags:
        # Canonicalise and de-dupe; silently drop invalid entries so a
        # typo'd URL doesn't 400 the whole page.
        seen: set[str] = set()
        tag_slugs = []
        for raw in tags.split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                slug = tags_service.canonicalize(raw)
            except InvalidTagSlug:
                continue
            if slug not in seen:
                seen.add(slug)
                tag_slugs.append(slug)
        if not tag_slugs:
            tag_slugs = None

    trending, recent, total_published = await share_service.browse_published_shares(
        db, tags=tag_slugs, sort=sort
    )

    return BrowseResponse(
        trending=trending,
        recent=recent,
        total_published=total_published,
    )


@router.get("/tags", response_model=list[TagOut])
@limiter.limit(TAG_AUTOCOMPLETE_LIMIT)
async def autocomplete_tags(
    request: Request,
    response: Response,
    db: DbSession,
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(default=10, ge=1, le=20),
) -> list[TagOut]:
    """Autocomplete for the tag input on the share editor.

    Trigram-similarity ranked on Postgres; prefix/substring fallback on
    SQLite (test harness only).  No auth required.
    """
    response.headers["Cache-Control"] = "public, s-maxage=60"
    rows = await tags_service.autocomplete(db, q, limit=limit)
    return [TagOut.model_validate(t) for t in rows]


@router.get("/tags/popular", response_model=list[TagOut])
@limiter.limit(TAG_AUTOCOMPLETE_LIMIT)
async def popular_tags(
    request: Request,
    response: Response,
    db: DbSession,
    limit: int = Query(default=8, ge=1, le=20),
) -> list[TagOut]:
    """Top-N tags by usage_count, for the home/discover tag-chip row."""
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=3600"
    rows = await tags_service.top_tags(db, limit=limit)
    return [TagOut.model_validate(t) for t in rows]


@router.get("/search", response_model=ShareSearchResponse)
@limiter.limit(SEARCH_LIMIT)
async def search_shares(
    request: Request,
    response: Response,
    db: DbSession,
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=500),
) -> ShareSearchResponse:
    """Search published public shares by name, description, or owner.

    Uses PostgreSQL ``pg_trgm`` trigram similarity — handles typos,
    partial matches, and diacritics.  Results are sorted by relevance
    then recency.  No authentication required.
    """
    q = q.strip()

    # After stripping, re-check minimum length
    if len(q) < 2:
        return ShareSearchResponse(results=[], has_more=False)

    # Dynamic results should not be cached by shared proxies
    response.headers["Cache-Control"] = "no-store"

    try:
        results, has_more = await share_service.search_published_shares(
            db, query=q, limit=limit, offset=offset
        )
    except OperationalError:
        # Likely a statement_timeout — return 503 so the client can retry
        # with a shorter/different query.
        logger.warning("search query timed out for q=%r", q, exc_info=True)
        return ShareSearchResponse(results=[], has_more=False)

    return ShareSearchResponse(results=results, has_more=has_more)
