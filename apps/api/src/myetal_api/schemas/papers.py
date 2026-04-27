"""Pydantic schemas for the /papers/* endpoints.

Both Crossref (DOI lookup) and OpenAlex (title search) are normalised into the
same `PaperMetadata` shape so the mobile client only has to handle one payload.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PaperLookupRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=500)


class OpenAccessInfo(BaseModel):
    is_oa: bool = False
    oa_status: str | None = None  # "gold" | "green" | "bronze" | "hybrid" | "closed"
    oa_url: str | None = None


class TopicInfo(BaseModel):
    name: str
    score: float = 0.0


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
    """Search hit — same as PaperMetadata plus enriched OpenAlex fields."""

    score: float = 0.0
    cited_by_count: int = 0
    type: str | None = None  # "article" | "preprint" | "book-chapter" | "dataset" etc.
    publication_date: str | None = None  # ISO date e.g. "2017-06-12"
    is_retracted: bool = False
    open_access: OpenAccessInfo = Field(default_factory=OpenAccessInfo)
    pdf_url: str | None = None
    topics: list[TopicInfo] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    language: str | None = None


class PaperSearchResponse(BaseModel):
    results: list[PaperSearchResult]
