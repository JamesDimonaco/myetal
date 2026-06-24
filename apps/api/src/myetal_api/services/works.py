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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.models import (
    ItemKind,
    Paper,
    PaperSource,
    Share,
    ShareItem,
    SharePaper,
    User,
    UserPaper,
    UserPaperAddedVia,
)
from myetal_api.services import orcid_client
from myetal_api.services import papers as papers_service

AddStatus = Literal["added", "unchanged", "hidden"]

# Onboarding auto-draft: name + description used when we pre-build a share
# on the first ORCID sync. Kept as module-level constants so tests and the
# banner detector on the dashboard agree on the canonical name.
ORCID_AUTO_DRAFT_NAME = "Publications"
ORCID_AUTO_DRAFT_DESCRIPTION = "Imported from ORCID — review and publish."


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
    - ``auto_draft_share_id``: when this sync was the user's first
      successful ORCID pull (``last_orcid_sync_at`` was NULL at start)
      AND they had zero shares AND the resulting library is non-empty,
      we pre-build a draft "Publications" share on their behalf and put
      its id here. Null in every other case. The web layer uses this to
      fire the ``orcid_auto_draft_created`` telemetry event and surface
      the dashboard banner.
    - ``auto_draft_paper_count``: number of library items attached to
      the auto-draft. None when no auto-draft was created.
    """

    added: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    auto_draft_share_id: uuid.UUID | None = None
    auto_draft_paper_count: int | None = None


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

    On the user's FIRST successful sync (``last_orcid_sync_at`` was
    NULL at call start), also attempts to pre-build a draft
    "Publications" share so the dashboard isn't a blank canvas. See
    ``auto_create_orcid_draft_share`` for the gating rules. The new
    share's id is returned via ``OrcidSyncResult.auto_draft_share_id``.

    Raises ``OrcidIdNotSet`` if the user has no ``orcid_id`` (→ 400).
    Lets ``orcid_client.UpstreamError`` propagate (→ 503).
    """
    user = await db.get(User, user_id)
    if user is None:
        # Defensive — auth dep should have already 401'd, but don't crash.
        raise OrcidIdNotSet
    if user.orcid_id is None:
        raise OrcidIdNotSet

    # First-sync gate: capture BEFORE the sync overwrites it. We use this
    # at the end to decide whether to pre-build the onboarding auto-draft.
    # Subsequent re-syncs (where last_orcid_sync_at is already populated)
    # must NEVER create another auto-draft, even if the user has deleted
    # the first one — that's a "user said no" signal we respect.
    is_first_sync = user.last_orcid_sync_at is None

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

    # First-sign-in wow moment: pre-build a draft "Publications" share so
    # the dashboard isn't empty. Gated to first sync only (so re-syncs
    # don't recreate a share the user has deleted). The helper itself
    # also checks shares.count == 0 + non-empty library, so it's safe to
    # call unconditionally; the ``is_first_sync`` guard is a belt-and-braces
    # second check that survives even if the helper grows looser gates
    # later.
    if is_first_sync:
        auto_draft = await auto_create_orcid_draft_share(db, user)
        if auto_draft is not None:
            result.auto_draft_share_id = auto_draft.id
            result.auto_draft_paper_count = len(auto_draft.papers)

    return result


async def auto_create_orcid_draft_share(
    db: AsyncSession,
    user: User,
) -> Share | None:
    """Pre-build a draft "Publications" share for an ORCID-first-sync user.

    The onboarding wow moment: instead of dropping a freshly-ORCID-linked
    user on an empty dashboard, we hand them a ready-to-publish share
    seeded with every paper in their library. They review, tweak, and
    click publish — one click instead of "find the New Share button,
    pick the items, name it, publish".

    Gating (returns None and is a no-op when any fails):

    * User already has at least one share (any state, including
      tombstoned). The tombstone gate is deliberate — a user who deleted
      their auto-draft is telling us "no thanks", and we must not
      recreate it on the next sync.
    * User's library is empty (nothing to attach, no useful share
      possible).

    Always creates the share in DRAFT state (``published_at = NULL``).
    NEVER auto-publishes. The whole point is that the user gets to
    review before anything is public.

    Idempotent — re-calling after a successful run is a no-op because
    ``shares.count > 0`` will short-circuit.

    Both ``share_items`` (display rows for the editor / public viewer)
    and ``share_papers`` (the canonical paper join used by discovery,
    similar-shares, etc.) are populated so the auto-draft behaves
    identically to a hand-built share from this point on.
    """
    # Import locally to avoid a circular import: share.py currently
    # imports from works.py is fine, but works.py importing share.py at
    # module top-level would invert the chain.
    from myetal_api.services.share import _allocate_short_code

    # Gate 1: any pre-existing share (including tombstoned) → bail. A
    # user who deleted the previous auto-draft has spoken; re-syncs must
    # not resurrect it. Counting via scalar is cheaper than fetching the
    # rows themselves.
    existing_share_count = await db.scalar(
        select(func.count(Share.id)).where(Share.owner_user_id == user.id)
    )
    if existing_share_count and existing_share_count > 0:
        return None

    # Gate 2: empty library → nothing to seed. The user may have
    # ORCID-linked but have zero published works; in that case the
    # banner-on-an-empty-share would be pointless.
    library_rows = await db.scalars(
        select(UserPaper)
        .options(selectinload(UserPaper.paper))
        .where(
            UserPaper.user_id == user.id,
            UserPaper.hidden_at.is_(None),
        )
        .order_by(UserPaper.added_at.desc(), UserPaper.paper_id.desc())
    )
    library = list(library_rows.all())
    if not library:
        return None

    short_code = await _allocate_short_code(db)
    share = Share(
        owner_user_id=user.id,
        short_code=short_code,
        name=ORCID_AUTO_DRAFT_NAME,
        description=ORCID_AUTO_DRAFT_DESCRIPTION,
        # Default share type — a list of papers, exactly what this is.
        # Type can be edited later. ``is_public=True`` matches the
        # service default; coupled with ``published_at=NULL`` the share
        # is link-private until the user clicks publish (see K3 in
        # share.py — drafts are NOT served publicly even with
        # is_public=True).
        is_public=True,
    )
    for position, entry in enumerate(library):
        paper = entry.paper
        share.items.append(
            ShareItem(
                position=position,
                kind=ItemKind.PAPER,
                title=paper.title,
                subtitle=paper.subtitle,
                url=paper.url,
                image_url=paper.image_url,
                doi=paper.doi,
                authors=paper.authors,
                year=paper.year,
            )
        )
        share.papers.append(
            SharePaper(
                paper_id=paper.id,
                position=position,
                added_by=user.id,
            )
        )

    db.add(share)
    await db.commit()
    await db.refresh(share)
    # Re-fetch with eagerly-loaded relationships so callers can read
    # share.papers / share.items without lazy-load surprises.
    refreshed = await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.papers))
        .where(Share.id == share.id)
    )
    assert refreshed is not None
    return refreshed


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
