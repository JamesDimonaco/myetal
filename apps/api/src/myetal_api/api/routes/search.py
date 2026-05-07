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
from myetal_api.core.rate_limit import BROWSE_LIMIT, SEARCH_LIMIT, limiter
from myetal_api.schemas.share import BrowseResponse, ShareSearchResponse
from myetal_api.services import share as share_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["search"])


@router.get("/browse", response_model=BrowseResponse)
@limiter.limit(BROWSE_LIMIT)
async def browse_shares(
    request: Request,
    response: Response,
    db: DbSession,
) -> BrowseResponse:
    """Browse trending and recently-published collections.

    Returns the same data for every caller — no auth, no personalisation.
    Aggressively cached at the CDN / reverse-proxy layer via
    ``Cache-Control: public, s-maxage=300``.
    """
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=3600"

    trending, recent, total_published = await share_service.browse_published_shares(db)

    return BrowseResponse(
        trending=trending,
        recent=recent,
        total_published=total_published,
    )


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
