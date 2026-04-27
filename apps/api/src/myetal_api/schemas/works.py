"""Pydantic schemas for /me/works/* — the personal works library.

Returns the global Paper alongside the per-user UserPaper metadata
(added_via, added_at, hidden_at) so the client has everything in one
response without follow-up requests.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from myetal_api.models import PaperSource, UserPaperAddedVia


class AddWorkRequest(BaseModel):
    """Body for POST /me/works.

    `identifier` accepts any DOI form Crossref understands — bare,
    `doi:`-prefixed, or full https://doi.org/... URL. Normalised inside
    `services/papers.py:normalise_doi`.
    """

    identifier: str = Field(min_length=1, max_length=500)


class PaperOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    doi: str | None
    openalex_id: str | None
    title: str
    subtitle: str | None
    authors: str | None
    year: int | None
    venue: str | None
    abstract: str | None
    url: str | None
    pdf_url: str | None
    image_url: str | None
    source: PaperSource


class WorkResponse(BaseModel):
    """A library entry: the global paper plus this user's per-entry fields.

    Returned by POST /me/works (single) and GET /me/works (list).
    """

    paper: PaperOut
    added_via: UserPaperAddedVia
    added_at: datetime
    hidden_at: datetime | None
