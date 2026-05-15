"""User-domain helpers that survive the Better Auth cutover.

The legacy ``services/auth.py`` is deleted in Phase 2. The one helper
that did not belong to "auth" semantically — manual ORCID iD entry —
moves here. Better Auth handles password / OAuth flows on the Next.js
side; FastAPI keeps the manual-entry path because:

* It is not an OAuth flow (no provider exchange, no state JWT).
* It needs the same dup-check semantics today's profile screen relies
  on (409 if the iD is already linked to another user).
* It must reset ``last_orcid_sync_at`` so the next library visit
  re-fires the auto-import for the new iD.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import User


class OrcidIdAlreadyLinked(Exception):
    """The ORCID iD is already linked to another user.

    Renamed from ``OrcidIdAlreadyClaimed`` (the legacy
    ``services/auth.py`` name) — the new name matches the OAuth-side
    error in ``apps/web/src/lib/auth-orcid-claim.ts`` so the error
    contract is consistent across the manual-entry and OAuth paths.
    """


class UserNotFound(Exception):
    """The user_id passed to a service helper does not exist."""


async def set_user_orcid_id(db: AsyncSession, user_id: uuid.UUID, orcid_id: str | None) -> User:
    """Set or clear ``orcid_id`` for a user.

    Format is assumed pre-validated by the schema layer (see
    ``schemas/user.py::OrcidIdUpdate``). Raises
    :class:`OrcidIdAlreadyLinked` if the iD is already linked to
    another user — account linking is not yet supported.

    Side effect: when the iD changes (incl. clearing or replacing),
    drop ``last_orcid_sync_at`` so the next library visit re-fires the
    auto-import for the new iD. Idempotent set (same value) leaves the
    timestamp alone.
    """
    user = await db.get(User, user_id)
    if user is None:
        raise UserNotFound

    if orcid_id is not None:
        clash = await db.scalar(
            select(User.id).where(User.orcid_id == orcid_id, User.id != user_id)
        )
        if clash is not None:
            raise OrcidIdAlreadyLinked

    if user.orcid_id != orcid_id:
        user.last_orcid_sync_at = None

    user.orcid_id = orcid_id
    # The precheck above is the fast path for benign typos, but two
    # concurrent PATCHes can both pass it — only the unique index will
    # catch that race. Translate the IntegrityError into a clean
    # OrcidIdAlreadyLinked instead of a 500.
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise OrcidIdAlreadyLinked from exc
    return user
