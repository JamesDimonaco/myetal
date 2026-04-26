"""Pydantic schemas for the /papers/* endpoints.

Both Crossref (DOI lookup) and OpenAlex (title search) are normalised into the
same `PaperMetadata` shape so the mobile client only has to handle one payload.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PaperLookupRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=500)


class PaperMetadata(BaseModel):
    """Normalised paper record. All fields except `title` and `source` may be
    null — Crossref/OpenAlex records are not uniformly populated."""

    doi: str | None = None
    title: str
    authors: str | None = None
    year: int | None = None
    container: str | None = None
    scholar_url: str | None = None
    source: str  # "crossref" | "openalex"


class PaperSearchResult(PaperMetadata):
    """Search hit — same as PaperMetadata plus a relevance score."""

    score: float = 0.0


class PaperSearchResponse(BaseModel):
    results: list[PaperSearchResult]
