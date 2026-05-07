"""Personal works library — add, list, hide, restore.

Two add-paths share `add_paper_by_doi`:

  - **Manual DOI paste** (POST /me/works) — re-adding a previously hidden
    entry restores it (the paste is a clear "I want this back" signal).
  - **ORCID sync** (POST /me/works/sync-orcid) — re-syncing must NOT
    restore hidden entries (per W-S5: hiding is the user's "don't
    re-import this" signal). The ORCID path passes `restore_hidden=False`.

Add flow:
  1. Resolve the DOI through `services/papers.py:lookup_doi` (Crossref;
     existing wiring with caching + polite-pool headers).
  2. Find-or-create the global `papers` row (DOI dedup is enforced by
     the partial-unique index on `papers.doi`).
  3. Find-or-create the per-user `user_papers` row (composite PK
     enforces dedup-per-user). Restore-on-re-add is gated by the
     `restore_hidden` kwarg.
  4. Return (paper, entry, status) where status classifies the outcome
     for the ORCID counter:
        "added"     — a new user_papers row was created this call
        "unchanged" — row already existed and was not hidden
        "hidden"    — row exists but is hidden_at!=None and we left it that way

All operations idempotent on (user_id, doi) — a user can paste the same
DOI twice without surprises.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.models import Paper, PaperSource, User, UserPaper, UserPaperAddedVia
from myetal_api.services import orcid_client
from myetal_api.services import papers as papers_service

AddStatus = Literal["added", "unchanged", "hidden"]


class LibraryEntryNotFound(Exception):
    """The user has no library entry for the given paper id."""


class OrcidIdNotSet(Exception):
    """Sync attempted for a user with no ``orcid_id`` set. Route → 400."""


@dataclass
class OrcidSyncResult:
    """Counts returned from ``sync_from_orcid``.

    - ``added``: new user_papers rows created this call.
    - ``updated``: paper existed globally but was newly linked to the user.
      In this PR ``added`` and ``updated`` are reported under ``added`` —
      the field is kept for response-shape parity with the spec; future
      versions can split them. (We always create a user_papers row when
      one didn't exist; whether the global paper was new is irrelevant
      to the user's library count.)
    - ``unchanged``: row already in user's library (including hidden ones
      we deliberately left hidden).
    - ``skipped``: works without a DOI, or per-DOI lookup failures.
    - ``errors``: per-DOI failure messages, capped at 10.
    """

    added: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


async def add_paper_by_doi(
    db: AsyncSession,
    user_id: uuid.UUID,
    identifier: str,
    *,
    added_via: UserPaperAddedVia = UserPaperAddedVia.MANUAL,
    restore_hidden: bool = True,
) -> tuple[Paper, UserPaper, AddStatus]:
    """Add a paper to a user's library by DOI (or DOI URL).

    Resolves the DOI via Crossref (existing `services/papers.py`), upserts
    the global `papers` row, then upserts the per-user `user_papers` row.

    ``added_via`` is stamped on newly created user_papers rows (existing
    rows keep their original value — re-adding via ORCID doesn't rewrite
    a row added manually).

    ``restore_hidden=True`` (manual paste default): if the entry exists
    and is hidden, un-hide it. ``restore_hidden=False`` (ORCID sync):
    leave hidden entries hidden — the user's hide gesture wins.

    Returns ``(paper, entry, status)`` where status is one of
    ``"added"`` / ``"unchanged"`` / ``"hidden"`` so callers can count
    outcomes without re-reading the row.

    Raises ``ValueError`` for malformed identifiers (route turns into 422),
    ``papers_service.PaperNotFound`` for unknown DOIs (route turns into 404),
    ``papers_service.PaperUpstreamError`` for Crossref outages (503).
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

    # 3. Find-or-create the per-user library entry. The hidden_at branch
    #    differs by add-path: manual paste restores; ORCID sync respects
    #    the user's prior hide decision.
    entry = await db.scalar(
        select(UserPaper).where(
            UserPaper.user_id == user_id,
            UserPaper.paper_id == paper.id,
        )
    )
    status: AddStatus
    if entry is None:
        entry = UserPaper(
            user_id=user_id,
            paper_id=paper.id,
            added_via=added_via,
        )
        db.add(entry)
        status = "added"
    elif entry.hidden_at is not None:
        if restore_hidden:
            entry.hidden_at = None
            status = "added"
        else:
            status = "hidden"
    else:
        status = "unchanged"

    await db.commit()
    await db.refresh(entry)
    await db.refresh(paper)
    return paper, entry, status


async def sync_from_orcid(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    http: httpx.AsyncClient | None = None,
) -> OrcidSyncResult:
    """Pull the user's public ORCID works and import each by DOI.

    Skips works without a DOI (counted as ``skipped``). Per-DOI errors
    (Crossref 404 / 5xx) are captured into ``errors`` (cap 10) and
    counted as ``skipped``; the sync as a whole keeps going. Hidden
    entries stay hidden (W-S5).

    Stamps ``user.last_orcid_sync_at`` on success and commits in a
    single final transaction (each ``add_paper_by_doi`` already commits
    its own work, so the final commit is just for the timestamp).

    Raises ``OrcidIdNotSet`` if the user has no ``orcid_id`` (→ 400).
    Lets ``orcid_client.UpstreamError`` propagate (→ 503).
    """
    user = await db.get(User, user_id)
    if user is None:
        # Defensive — auth dep should have already 401'd, but don't crash.
        raise OrcidIdNotSet
    if user.orcid_id is None:
        raise OrcidIdNotSet

    # Capture the iD value at sync start. If the user PATCHes their orcid_id
    # mid-sync, the work we just imported is against the *old* iD — so the
    # final last_orcid_sync_at stamp must NOT land against the new one,
    # otherwise the auto-fire re-arm contract (set_user_orcid_id clears the
    # stamp on iD change) silently breaks. See H3 in the hardening pass.
    sync_orcid_id = user.orcid_id

    works = await orcid_client.fetch_works(sync_orcid_id, http=http)

    result = OrcidSyncResult()
    for work in works:
        if not work.doi:
            result.skipped += 1
            continue
        try:
            _, _, status = await add_paper_by_doi(
                db,
                user_id,
                work.doi,
                added_via=UserPaperAddedVia.ORCID,
                restore_hidden=False,
            )
        except (papers_service.PaperNotFound, papers_service.PaperUpstreamError, ValueError) as exc:
            if len(result.errors) < 10:
                result.errors.append(f"{work.doi}: {exc}")
            result.skipped += 1
            continue

        if status == "added":
            result.added += 1
        elif status == "hidden":
            # User explicitly hid this previously — count as unchanged
            # for client-facing purposes; we did nothing.
            result.unchanged += 1
        else:  # "unchanged"
            result.unchanged += 1

    # Re-read the user before stamping. If their orcid_id changed mid-sync
    # (PATCH /auth/me), don't stamp last_orcid_sync_at — the next library
    # visit needs to see "no last sync" and auto-fire against the new iD.
    # We still keep the per-DOI inserts that already committed; they're
    # against the old iD's papers, which is what the user has in their
    # library now. Only the stamp is suppressed.
    await db.refresh(user)
    if user.orcid_id != sync_orcid_id:
        result.errors.append("orcid_id changed mid-sync; not stamping last_orcid_sync_at")
        return result

    user.last_orcid_sync_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(user)
    return result


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
    # Secondary key on paper_id keeps ordering deterministic if two rows
    # share an added_at timestamp (possible on SQLite tests where the
    # server-side default has only second precision; the model's Python-side
    # default normally avoids this, but the tiebreaker makes the query
    # well-defined regardless of how the row was inserted).
    stmt = stmt.order_by(UserPaper.added_at.desc(), UserPaper.paper_id.desc())
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
