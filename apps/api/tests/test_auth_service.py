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
