"""/me/works/* — personal works library endpoints.

Per `docs/tickets/works-library-and-orcid-sync.md` chunk D scope:
manual DOI add (via Crossref), list, hide, restore. ORCID sync defers
to its own ticket once sandbox is approved.

All routes are bearer-authed (`CurrentUser`). Per-paper operations key
on the global paper id, not the join row id, since user_papers has a
composite PK.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query, Request, status

from myetal_api.api.deps import CurrentUser, DbSession
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.schemas.works import (
    AddWorkRequest,
    OrcidSyncResponse,
    PaperOut,
    WorkResponse,
)
from myetal_api.services import orcid_client
from myetal_api.services import papers as papers_service
from myetal_api.services import works as works_service

router = APIRouter(prefix="/me/works", tags=["works"])


@router.post("", response_model=WorkResponse, status_code=status.HTTP_201_CREATED)
async def add_work(
    body: AddWorkRequest,
    user: CurrentUser,
    db: DbSession,
) -> WorkResponse:
    """Add a paper to your library by DOI.

    Idempotent: re-posting the same DOI returns the existing entry. If the
    entry was previously hidden, it gets restored.
    """
    try:
        paper, entry, _ = await works_service.add_paper_by_doi(db, user.id, body.identifier)
    except ValueError as exc:
        # Malformed DOI / unparseable identifier
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
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

    return WorkResponse(
        paper=PaperOut.model_validate(paper),
        added_via=entry.added_via,
        added_at=entry.added_at,
        hidden_at=entry.hidden_at,
    )


@router.get("", response_model=list[WorkResponse])
async def list_works(
    user: CurrentUser,
    db: DbSession,
    include_hidden: bool = Query(
        default=False,
        description="Include entries the user has hidden (for a future trash UI).",
    ),
) -> list[WorkResponse]:
    rows = await works_service.list_library(db, user.id, include_hidden=include_hidden)
    return [
        WorkResponse(
            paper=PaperOut.model_validate(paper),
            added_via=entry.added_via,
            added_at=entry.added_at,
            hidden_at=entry.hidden_at,
        )
        for paper, entry in rows
    ]


@router.get("/{paper_id}", response_model=WorkResponse)
async def get_work(
    paper_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> WorkResponse:
    found = await works_service.get_entry_with_paper(db, user.id, paper_id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not in your library")
    paper, entry = found
    return WorkResponse(
        paper=PaperOut.model_validate(paper),
        added_via=entry.added_via,
        added_at=entry.added_at,
        hidden_at=entry.hidden_at,
    )


@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
async def hide_work(
    paper_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    """Hide an entry from the default library view. Soft delete — the row
    stays so future ORCID syncs don't keep re-adding it (per W-S5).
    """
    try:
        await works_service.hide_library_entry(db, user.id, paper_id)
    except works_service.LibraryEntryNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not in your library"
        ) from exc


@router.post("/{paper_id}/restore", response_model=WorkResponse)
async def restore_work(
    paper_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> WorkResponse:
    """Reverse a hide — surface the entry in the default library view again."""
    try:
        entry = await works_service.restore_library_entry(db, user.id, paper_id)
    except works_service.LibraryEntryNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not in your library"
        ) from exc
    found = await works_service.get_entry_with_paper(db, user.id, paper_id)
    assert found is not None  # we just restored it
    paper, _ = found
    return WorkResponse(
        paper=PaperOut.model_validate(paper),
        added_via=entry.added_via,
        added_at=entry.added_at,
        hidden_at=entry.hidden_at,
    )


@router.post("/sync-orcid", response_model=OrcidSyncResponse)
@limiter.limit("5/minute", key_func=authed_user_key)
async def sync_orcid(
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> OrcidSyncResponse:
    """Pull the user's public ORCID works and import each by DOI.

    Synchronous: the request hangs until the import is done. Returns
    counts of what changed. Idempotent — re-running is a no-op for
    already-saved papers, and previously hidden entries stay hidden.

    400 if the user has no ``orcid_id`` set.
    503 if ORCID is unreachable / returned a 5xx.
    429 if the *same user* calls more than 5 times/minute (per-user key
    avoids penalising other users behind a shared NAT — see
    ``core.rate_limit.authed_user_key``).
    """
    try:
        result = await works_service.sync_from_orcid(db, user.id)
    except works_service.OrcidIdNotSet as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="set your ORCID iD on your profile first",
        ) from exc
    except orcid_client.UpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ORCID is unavailable, try again in a minute",
        ) from exc
    return OrcidSyncResponse(**asdict(result))
