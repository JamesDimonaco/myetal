"""Personal works library — add, list, hide, restore.

Per `docs/tickets/works-library-and-orcid-sync.md` chunk D scope: manual
DOI add via Crossref, list/hide/restore. ORCID sync (the bigger feature)
defers to its own ticket once sandbox is approved.

Add flow:
  1. Resolve the DOI through `services/papers.py:lookup_doi` (Crossref;
     existing wiring with caching + polite-pool headers).
  2. Find-or-create the global `papers` row (DOI dedup is enforced by
     the partial-unique index on `papers.doi`).
  3. Find-or-create the per-user `user_papers` row (composite PK
     enforces dedup-per-user). If the entry was hidden, restore it.
  4. Return the freshly attached library entry.

All operations idempotent on (user_id, doi) — a user can paste the same
DOI twice without surprises.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.models import Paper, PaperSource, UserPaper, UserPaperAddedVia
from myetal_api.services import papers as papers_service


class LibraryEntryNotFound(Exception):
    """The user has no library entry for the given paper id."""


async def add_paper_by_doi(
    db: AsyncSession,
    user_id: uuid.UUID,
    identifier: str,
) -> tuple[Paper, UserPaper]:
    """Add a paper to a user's library by DOI (or DOI URL).

    Resolves the DOI via Crossref (existing `services/papers.py`), upserts
    the global `papers` row, then upserts the per-user `user_papers` row.

    Raises `ValueError` for malformed identifiers (route turns into 422),
    `papers_service.PaperNotFound` for unknown DOIs (route turns into 404),
    `papers_service.PaperUpstreamError` for Crossref outages (503).
    """
    # 1. Hit Crossref. Throws on bad input / unknown / upstream error —
    #    let those bubble up so the route can map to the right HTTP code.
    metadata = await papers_service.lookup_doi(identifier)

    # The metadata's DOI is the canonical normalised form Crossref returned;
    # it's what we dedup on.
    doi = metadata.doi
    if not doi:
        # Shouldn't happen — lookup_doi only succeeds when Crossref returned
        # a record, which always includes a DOI — but defensive.
        raise ValueError("Crossref returned no DOI for this identifier")

    # 2. Find-or-create the global paper row.
    paper = await db.scalar(select(Paper).where(Paper.doi == doi))
    if paper is None:
        paper = Paper(
            doi=doi,
            title=metadata.title,
            authors=metadata.authors,
            year=metadata.year,
            venue=metadata.container,
            source=PaperSource(metadata.source)
            if metadata.source in {"crossref", "openalex", "manual", "orcid"}
            else PaperSource.CROSSREF,
        )
        db.add(paper)
        await db.flush()  # populate paper.id

    # 3. Find-or-create the per-user library entry. If it exists but was
    #    hidden, restore it (re-adding signals intent to surface again).
    entry = await db.scalar(
        select(UserPaper).where(
            UserPaper.user_id == user_id,
            UserPaper.paper_id == paper.id,
        )
    )
    if entry is None:
        entry = UserPaper(
            user_id=user_id,
            paper_id=paper.id,
            added_via=UserPaperAddedVia.MANUAL,
        )
        db.add(entry)
    elif entry.hidden_at is not None:
        entry.hidden_at = None

    await db.commit()
    await db.refresh(entry)
    await db.refresh(paper)
    return paper, entry


async def list_library(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    include_hidden: bool = False,
) -> list[tuple[Paper, UserPaper]]:
    """Return the user's library, newest-first by added_at.

    Hidden entries are excluded by default — set `include_hidden=True` to
    fetch everything (e.g. for a "trash" UI). Joins on the global papers
    table so each entry comes back with the full paper metadata.
    """
    stmt = (
        select(UserPaper).options(selectinload(UserPaper.paper)).where(UserPaper.user_id == user_id)
    )
    if not include_hidden:
        stmt = stmt.where(UserPaper.hidden_at.is_(None))
    stmt = stmt.order_by(UserPaper.added_at.desc())
    rows = (await db.scalars(stmt)).all()
    return [(r.paper, r) for r in rows]


async def hide_library_entry(
    db: AsyncSession,
    user_id: uuid.UUID,
    paper_id: uuid.UUID,
) -> UserPaper:
    """Soft-hide a library entry. The row stays so future ORCID syncs
    don't keep re-adding it (per W-S5: hidden_at is checked on upsert).

    Raises LibraryEntryNotFound if the user has no entry for this paper.
    """
    entry = await _get_entry(db, user_id, paper_id)
    if entry.hidden_at is None:
        entry.hidden_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(entry)
    return entry


async def restore_library_entry(
    db: AsyncSession,
    user_id: uuid.UUID,
    paper_id: uuid.UUID,
) -> UserPaper:
    """Reverse a `hide_library_entry`. No-op if not currently hidden."""
    entry = await _get_entry(db, user_id, paper_id)
    if entry.hidden_at is not None:
        entry.hidden_at = None
        await db.commit()
        await db.refresh(entry)
    return entry


async def get_entry_with_paper(
    db: AsyncSession,
    user_id: uuid.UUID,
    paper_id: uuid.UUID,
) -> tuple[Paper, UserPaper] | None:
    entry = await db.scalar(
        select(UserPaper)
        .options(selectinload(UserPaper.paper))
        .where(UserPaper.user_id == user_id, UserPaper.paper_id == paper_id)
    )
    if entry is None:
        return None
    return entry.paper, entry


# ---------- internals ----------


async def _get_entry(
    db: AsyncSession,
    user_id: uuid.UUID,
    paper_id: uuid.UUID,
) -> UserPaper:
    entry = await db.scalar(
        select(UserPaper).where(
            UserPaper.user_id == user_id,
            UserPaper.paper_id == paper_id,
        )
    )
    if entry is None:
        raise LibraryEntryNotFound
    return entry
