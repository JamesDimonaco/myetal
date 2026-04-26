"""/papers/* — DOI lookup (Crossref) and title search (OpenAlex).

Both routes are bearer-authed: not because the upstreams are sensitive, but
because we're acting as an outbound proxy and want every call attributable
to a real user account in the access logs.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from ceteris_api.api.deps import CurrentUser
from ceteris_api.schemas.papers import (
    PaperLookupRequest,
    PaperMetadata,
    PaperSearchResponse,
)
from ceteris_api.services import papers as papers_service

router = APIRouter(prefix="/papers", tags=["papers"])


@router.post("/lookup", response_model=PaperMetadata)
async def lookup_paper(body: PaperLookupRequest, _user: CurrentUser) -> PaperMetadata:
    try:
        return await papers_service.lookup_doi(body.identifier)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except papers_service.PaperNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="paper not found"
        ) from exc
    except papers_service.PaperUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="upstream metadata service unavailable",
        ) from exc


@router.get("/search", response_model=PaperSearchResponse)
async def search_papers(
    _user: CurrentUser,
    q: str = Query(..., min_length=1, max_length=500, description="Free-text query"),
    limit: int = Query(10, ge=1, le=25),
) -> PaperSearchResponse:
    try:
        results = await papers_service.search_papers(q, limit)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except papers_service.PaperUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="upstream metadata service unavailable",
        ) from exc
    return PaperSearchResponse(results=results)
