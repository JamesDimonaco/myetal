"""Tests for ``services/users.py::set_user_orcid_id``.

The legacy ``services/auth.py`` was deleted in Phase 2 of the Better
Auth migration; the one helper that survived (manual ORCID iD entry)
moved here. These tests preserve the behaviour the web profile screen
relies on:

* Setting a different iD clears ``last_orcid_sync_at`` so the next
  library visit re-fires the auto-import.
* Clearing the iD also resets ``last_orcid_sync_at``.
* Idempotent set (same value) leaves the timestamp alone.
* Concurrent PATCHes that race past the precheck and trip the unique
  index get translated to ``OrcidIdAlreadyLinked`` instead of leaking
  a 500.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.services import users as users_service
from tests.conftest import make_user


async def test_set_user_orcid_id_resets_last_sync_when_value_changes(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, email="orcid-reset@example.com")
    user = await users_service.set_user_orcid_id(
        db_session, user.id, "0000-0002-1825-0097"
    )
    user.last_orcid_sync_at = datetime.now(UTC)
    await db_session.commit()
    assert user.last_orcid_sync_at is not None

    user = await users_service.set_user_orcid_id(
        db_session, user.id, "0000-0001-2345-6789"
    )
    assert user.last_orcid_sync_at is None


async def test_set_user_orcid_id_resets_last_sync_when_cleared(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, email="orcid-clear@example.com")
    user = await users_service.set_user_orcid_id(
        db_session, user.id, "0000-0002-1825-0097"
    )
    user.last_orcid_sync_at = datetime.now(UTC)
    await db_session.commit()

    user = await users_service.set_user_orcid_id(db_session, user.id, None)
    assert user.last_orcid_sync_at is None


async def test_set_user_orcid_id_does_not_reset_on_idempotent_set(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, email="orcid-idem@example.com")
    user = await users_service.set_user_orcid_id(
        db_session, user.id, "0000-0002-1825-0097"
    )
    stamp = datetime.now(UTC)
    user.last_orcid_sync_at = stamp
    await db_session.commit()

    user = await users_service.set_user_orcid_id(
        db_session, user.id, "0000-0002-1825-0097"
    )
    assert user.last_orcid_sync_at is not None
    stored = user.last_orcid_sync_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=UTC)
    assert stored == stamp


async def test_set_user_orcid_id_translates_integrity_error_to_already_linked(
    db_session: AsyncSession,
) -> None:
    """Race past the precheck → unique index trips → translate to a
    clean OrcidIdAlreadyLinked rather than a 500."""
    user = await make_user(db_session, email="race@example.com", name="Race")

    fake_commit = AsyncMock(side_effect=IntegrityError("stmt", {}, Exception("uniq")))
    fake_rollback = AsyncMock()

    real_commit = db_session.commit
    real_rollback = db_session.rollback
    db_session.commit = fake_commit  # type: ignore[method-assign]
    db_session.rollback = fake_rollback  # type: ignore[method-assign]
    try:
        with pytest.raises(users_service.OrcidIdAlreadyLinked):
            await users_service.set_user_orcid_id(
                db_session, user.id, "0000-0002-1825-0097"
            )
    finally:
        db_session.commit = real_commit  # type: ignore[method-assign]
        db_session.rollback = real_rollback  # type: ignore[method-assign]

    assert fake_commit.await_count == 1
    assert fake_rollback.await_count == 1


async def test_set_user_orcid_id_precheck_rejects_already_linked(
    db_session: AsyncSession,
) -> None:
    """The fast-path precheck catches a benign duplicate before the
    DB unique index ever sees it."""
    a = await make_user(db_session, email="a@example.com", name="A")
    b = await make_user(db_session, email="b@example.com", name="B")
    await users_service.set_user_orcid_id(db_session, a.id, "0000-0001-2345-6789")

    with pytest.raises(users_service.OrcidIdAlreadyLinked):
        await users_service.set_user_orcid_id(
            db_session, b.id, "0000-0001-2345-6789"
        )
