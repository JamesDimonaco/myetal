import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.security import decode_access_token
from myetal_api.models import AuthIdentity, AuthProvider, RefreshToken
from myetal_api.services import auth as auth_service


async def test_register_creates_user_and_password_identity(db_session: AsyncSession) -> None:
    user, access, refresh = await auth_service.register_with_password(
        db_session, "Foo@Example.com", "hunter2!", name="Foo"
    )

    assert user.email == "foo@example.com"
    assert user.name == "Foo"
    assert decode_access_token(access) == user.id
    assert refresh  # opaque token returned

    identities = (await db_session.scalars(select(AuthIdentity))).all()
    assert len(identities) == 1
    assert identities[0].provider == AuthProvider.PASSWORD
    assert identities[0].subject_id == "foo@example.com"
    assert identities[0].password_hash is not None
    assert identities[0].password_hash != "hunter2!"

    refreshes = (await db_session.scalars(select(RefreshToken))).all()
    assert len(refreshes) == 1
    assert refreshes[0].user_id == user.id


async def test_register_duplicate_email_rejected(db_session: AsyncSession) -> None:
    await auth_service.register_with_password(db_session, "foo@example.com", "hunter22", None)
    with pytest.raises(auth_service.EmailAlreadyRegistered):
        await auth_service.register_with_password(db_session, "FOO@example.com", "hunter22", None)


async def test_login_success(db_session: AsyncSession) -> None:
    await auth_service.register_with_password(db_session, "foo@example.com", "hunter22", None)
    user, access, refresh = await auth_service.login_with_password(
        db_session, "foo@example.com", "hunter22"
    )
    assert user.email == "foo@example.com"
    assert decode_access_token(access) == user.id
    assert refresh


async def test_login_wrong_password_rejected(db_session: AsyncSession) -> None:
    await auth_service.register_with_password(db_session, "foo@example.com", "hunter22", None)
    with pytest.raises(auth_service.InvalidCredentials):
        await auth_service.login_with_password(db_session, "foo@example.com", "wrong")


async def test_login_unknown_email_rejected(db_session: AsyncSession) -> None:
    with pytest.raises(auth_service.InvalidCredentials):
        await auth_service.login_with_password(db_session, "nope@example.com", "hunter22")


async def test_refresh_rotates_token(db_session: AsyncSession) -> None:
    _, _, original = await auth_service.register_with_password(
        db_session, "foo@example.com", "hunter22", None
    )
    new_access, new_refresh = await auth_service.rotate_refresh_token(db_session, original)
    assert new_access
    assert new_refresh != original

    # Old token should now be marked rotated
    refreshes = (await db_session.scalars(select(RefreshToken))).all()
    assert len(refreshes) == 2
    rotated = next(rt for rt in refreshes if rt.rotated_to_id is not None)
    assert rotated.rotated_to_id is not None


async def test_refresh_reuse_revokes_family(db_session: AsyncSession) -> None:
    """Replaying a token after rotation should revoke the entire family."""
    _, _, original = await auth_service.register_with_password(
        db_session, "foo@example.com", "hunter22", None
    )
    # First rotation: legitimate
    _, second_refresh = await auth_service.rotate_refresh_token(db_session, original)

    # Attacker (or buggy client) replays the original
    with pytest.raises(auth_service.InvalidRefreshToken):
        await auth_service.rotate_refresh_token(db_session, original)

    # Now even the legitimate second token should fail (family revoked)
    with pytest.raises(auth_service.InvalidRefreshToken):
        await auth_service.rotate_refresh_token(db_session, second_refresh)

    # All refresh tokens for that user should be revoked
    refreshes = (await db_session.scalars(select(RefreshToken))).all()
    assert all(rt.revoked for rt in refreshes)


async def test_refresh_invalid_token_rejected(db_session: AsyncSession) -> None:
    with pytest.raises(auth_service.InvalidRefreshToken):
        await auth_service.rotate_refresh_token(db_session, "not-a-real-token")


async def test_logout_revokes_family(db_session: AsyncSession) -> None:
    _, _, refresh = await auth_service.register_with_password(
        db_session, "foo@example.com", "hunter22", None
    )
    await auth_service.logout(db_session, refresh)
    with pytest.raises(auth_service.InvalidRefreshToken):
        await auth_service.rotate_refresh_token(db_session, refresh)


async def test_email_normalised_on_login(db_session: AsyncSession) -> None:
    await auth_service.register_with_password(db_session, "Foo@Example.COM", "hunter22", None)
    user, _, _ = await auth_service.login_with_password(db_session, "FOO@example.com", "hunter22")
    assert user.email == "foo@example.com"


# ---------- set_user_orcid_id: last_orcid_sync_at reset rule ----------


async def test_set_user_orcid_id_resets_last_sync_when_value_changes(
    db_session: AsyncSession,
) -> None:
    """Changing the iD to a *different* value clears last_orcid_sync_at so
    the auto-import re-fires for the new iD."""
    from datetime import UTC, datetime

    user, _, _ = await auth_service.register_with_password(
        db_session, "orcid-reset@example.com", "hunter22hunter22", None
    )
    user = await auth_service.set_user_orcid_id(db_session, user.id, "0000-0002-1825-0097")
    user.last_orcid_sync_at = datetime.now(UTC)
    await db_session.commit()
    assert user.last_orcid_sync_at is not None

    # Set to a *different* iD → reset.
    user = await auth_service.set_user_orcid_id(db_session, user.id, "0000-0001-2345-6789")
    assert user.last_orcid_sync_at is None


async def test_set_user_orcid_id_resets_last_sync_when_cleared(
    db_session: AsyncSession,
) -> None:
    """Clearing the iD (None) is a "change" too — reset the timestamp."""
    from datetime import UTC, datetime

    user, _, _ = await auth_service.register_with_password(
        db_session, "orcid-clear@example.com", "hunter22hunter22", None
    )
    user = await auth_service.set_user_orcid_id(db_session, user.id, "0000-0002-1825-0097")
    user.last_orcid_sync_at = datetime.now(UTC)
    await db_session.commit()
    assert user.last_orcid_sync_at is not None

    user = await auth_service.set_user_orcid_id(db_session, user.id, None)
    assert user.last_orcid_sync_at is None


async def test_set_user_orcid_id_translates_integrity_error_to_already_claimed(
    db_session: AsyncSession,
) -> None:
    """The pre-check (``select where orcid_id == ... and id != self``) is the
    fast path for benign typos, but two concurrent PATCHes can both pass
    it. Only the unique index catches that race — the service must turn
    the resulting IntegrityError into ``OrcidIdAlreadyClaimed`` (and roll
    back) rather than letting a 500 escape.
    """
    from unittest.mock import AsyncMock

    from sqlalchemy.exc import IntegrityError

    user, _, _ = await auth_service.register_with_password(
        db_session, "race@example.com", "hunter22hunter22", "Race"
    )

    # Sneak past the pre-check (no row currently holds the iD), then make
    # commit fail as if a concurrent insert had won the race.
    fake_commit = AsyncMock(side_effect=IntegrityError("stmt", {}, Exception("uniq")))
    fake_rollback = AsyncMock()

    real_commit = db_session.commit
    real_rollback = db_session.rollback
    db_session.commit = fake_commit  # type: ignore[method-assign]
    db_session.rollback = fake_rollback  # type: ignore[method-assign]
    try:
        with pytest.raises(auth_service.OrcidIdAlreadyClaimed):
            await auth_service.set_user_orcid_id(db_session, user.id, "0000-0002-1825-0097")
    finally:
        db_session.commit = real_commit  # type: ignore[method-assign]
        db_session.rollback = real_rollback  # type: ignore[method-assign]

    assert fake_commit.await_count == 1
    assert fake_rollback.await_count == 1


async def test_set_user_orcid_id_does_not_reset_on_idempotent_set(
    db_session: AsyncSession,
) -> None:
    """Re-setting the *same* value is a no-op for the timestamp."""
    from datetime import UTC, datetime

    user, _, _ = await auth_service.register_with_password(
        db_session, "orcid-idem@example.com", "hunter22hunter22", None
    )
    user = await auth_service.set_user_orcid_id(db_session, user.id, "0000-0002-1825-0097")
    stamp = datetime.now(UTC)
    user.last_orcid_sync_at = stamp
    await db_session.commit()

    user = await auth_service.set_user_orcid_id(db_session, user.id, "0000-0002-1825-0097")
    assert user.last_orcid_sync_at is not None
    # Stored timestamp may lose tz info on SQLite, but it must not be None.
    stored = user.last_orcid_sync_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=UTC)
    assert stored == stamp.replace(microsecond=stamp.microsecond)
