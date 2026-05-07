import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)
from myetal_api.models import AuthIdentity, AuthProvider, RefreshToken, User


class AuthError(Exception):
    """Base for auth-flow errors translated to HTTP responses by routes."""


class EmailAlreadyRegistered(AuthError):
    pass


class InvalidCredentials(AuthError):
    pass


class InvalidRefreshToken(AuthError):
    pass


class OrcidIdAlreadyClaimed(AuthError):
    pass


async def register_with_password(
    db: AsyncSession,
    email: str,
    password: str,
    name: str | None,
) -> tuple[User, str, str]:
    normalized = email.lower()
    existing = await db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == AuthProvider.PASSWORD,
            AuthIdentity.subject_id == normalized,
        )
    )
    if existing is not None:
        raise EmailAlreadyRegistered

    user = User(name=name, email=normalized)
    db.add(user)
    await db.flush()

    db.add(
        AuthIdentity(
            user_id=user.id,
            provider=AuthProvider.PASSWORD,
            subject_id=normalized,
            password_hash=hash_password(password),
        )
    )

    access, raw_refresh, _ = await _issue_token_pair(db, user.id, family_id=None)
    await db.commit()
    return user, access, raw_refresh


async def login_with_password(
    db: AsyncSession,
    email: str,
    password: str,
) -> tuple[User, str, str]:
    normalized = email.lower()
    identity = await db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == AuthProvider.PASSWORD,
            AuthIdentity.subject_id == normalized,
        )
    )
    if identity is None or identity.password_hash is None:
        raise InvalidCredentials
    if not verify_password(password, identity.password_hash):
        raise InvalidCredentials

    user = await db.get(User, identity.user_id)
    if user is None:
        raise InvalidCredentials

    access, raw_refresh, _ = await _issue_token_pair(db, user.id, family_id=None)
    await db.commit()
    return user, access, raw_refresh


async def rotate_refresh_token(db: AsyncSession, raw_refresh: str) -> tuple[str, str]:
    digest = hash_refresh_token(raw_refresh)
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))
    if token is None:
        raise InvalidRefreshToken

    if token.revoked or token.rotated_to_id is not None:
        # Reuse / replay attempt — burn the whole family
        await _revoke_family(db, token.family_id)
        await db.commit()
        raise InvalidRefreshToken

    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise InvalidRefreshToken

    access, new_raw, new_token = await _issue_token_pair(
        db, token.user_id, family_id=token.family_id
    )
    token.rotated_to_id = new_token.id

    await db.commit()
    return access, new_raw


async def logout(db: AsyncSession, raw_refresh: str) -> None:
    digest = hash_refresh_token(raw_refresh)
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))
    if token is None:
        return
    await _revoke_family(db, token.family_id)
    await db.commit()


async def list_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[RefreshToken]:
    """Return all refresh-token rows for a user (one per signed-in device).
    Routes are responsible for projecting to a hash-free schema."""
    rows = await db.scalars(
        select(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .order_by(RefreshToken.issued_at.desc())
    )
    return list(rows.all())


async def set_user_orcid_id(db: AsyncSession, user_id: uuid.UUID, orcid_id: str | None) -> User:
    """Set or clear ``orcid_id`` for a user. Format is assumed pre-validated
    by the schema layer. Raises ``OrcidIdAlreadyClaimed`` if the iD is
    already linked to another user (account linking is deferred to Phase B)."""
    user = await db.get(User, user_id)
    if user is None:
        raise InvalidCredentials

    if orcid_id is not None:
        clash = await db.scalar(
            select(User.id).where(User.orcid_id == orcid_id, User.id != user_id)
        )
        if clash is not None:
            raise OrcidIdAlreadyClaimed

    # If the iD is *changing* (incl. clearing or replacing), drop the
    # last-sync timestamp so the next library visit re-fires the auto-import
    # for the new iD. Idempotent set (same value) leaves the timestamp alone.
    if user.orcid_id != orcid_id:
        user.last_orcid_sync_at = None

    user.orcid_id = orcid_id
    # The precheck above is the fast path for benign typos, but two concurrent
    # PATCHes can both pass it — only the unique index will catch that race.
    # Translate the IntegrityError into a clean 409 instead of a 500.
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise OrcidIdAlreadyClaimed from exc
    return user


async def revoke_session(db: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID) -> bool:
    """Revoke a single refresh token (= sign out one device).

    Returns True if the row was found and belonged to the user. False if
    the row doesn't exist OR belongs to someone else (we deliberately
    conflate the two so we don't leak existence of foreign session ids).
    """
    token = await db.get(RefreshToken, session_id)
    if token is None or token.user_id != user_id:
        return False
    if not token.revoked:
        token.revoked = True
        await db.commit()
    return True


# ---------- internals ----------


async def _issue_token_pair(
    db: AsyncSession,
    user_id: uuid.UUID,
    family_id: uuid.UUID | None,
) -> tuple[str, str, RefreshToken]:
    access = create_access_token(user_id)
    raw, digest = generate_refresh_token()
    rt = RefreshToken(
        user_id=user_id,
        token_hash=digest,
        expires_at=refresh_token_expiry(),
        family_id=family_id or uuid.uuid4(),
    )
    db.add(rt)
    await db.flush()
    return access, raw, rt


async def _revoke_family(db: AsyncSession, family_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken).where(RefreshToken.family_id == family_id).values(revoked=True)
    )
