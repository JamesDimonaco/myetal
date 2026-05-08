"""Top-level pytest fixtures.

Auth model post Better Auth cutover: identity is a Better Auth-issued
Ed25519 JWT verified against a JWKS endpoint. Tests don't run a real
Next.js BA server — instead we:

* Generate a deterministic Ed25519 keypair at module-import time.
* Patch ``ba_security.httpx.get`` so JWKS fetches return our fake
  document (the same monkeypatch pattern proven in
  ``tests/core/test_ba_security.py`` — kept here to share infrastructure
  for the whole suite).
* Provide :func:`signed_jwt` for tests that need to mint an
  authenticated request, and :func:`auth_headers` for the common case
  of converting a ``User`` row into ``{"Authorization": "Bearer …"}``.

Every test that previously called
``auth_service.register_with_password`` to get a ``(user, access,
refresh)`` triple now creates the ``User`` row directly via
:func:`make_user` and mints its own JWT via ``signed_jwt(user.id)``.

Test issuer pin: ``http://test`` — short, distinctive, and explicitly
NOT a real Better Auth deployment URL so leaks are obvious.
"""

from __future__ import annotations

import os
import uuid

# Settings reads ``BETTER_AUTH_*`` env vars at first import. Lock the
# issuer/JWKS URL to deterministic values so the verifier in the BA
# security tests AND every authenticated route test see the same iss
# claim. setdefault means a real env var still wins if present.
os.environ.setdefault("BETTER_AUTH_URL", "http://test")
os.environ.setdefault("BETTER_AUTH_ISSUER", "http://test")
os.environ.setdefault(
    "BETTER_AUTH_JWKS_URL", "http://test/api/auth/jwks"
)
# ORCID public-API credentials — services/orcid_client.py reads these.
# Only ORCID matters post-cutover (Google/GitHub OAuth move to BA on
# Next.js), but the test env had all three before — keep the doc the
# same.
os.environ.setdefault("ORCID_CLIENT_ID", "test-orcid-client-id")
os.environ.setdefault("ORCID_CLIENT_SECRET", "test-orcid-client-secret")

import base64  # noqa: E402
from collections.abc import AsyncIterator, Iterator  # noqa: E402
from datetime import UTC, datetime, timedelta  # noqa: E402
from typing import Any  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

import jwt  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
)
from cryptography.hazmat.primitives.serialization import (  # noqa: E402
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from myetal_api.core import ba_security  # noqa: E402
from myetal_api.core.database import get_db  # noqa: E402
from myetal_api.main import app  # noqa: E402
from myetal_api.models import Base, User  # noqa: E402

# ---------------------------------------------------------------------------
# JWKS keypair — deterministic per process, regenerated at import time.
# A fresh keypair every test run keeps the JWT format real (no hand-rolled
# signatures) without baking secrets into the repo.
# ---------------------------------------------------------------------------

_TEST_KID = "test-key-1"
_TEST_ISSUER = "http://test"


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _build_keypair() -> tuple[bytes, dict[str, str]]:
    private = Ed25519PrivateKey.generate()
    private_pem = private.private_bytes(
        Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
    )
    raw_public = private.public_key().public_bytes(
        Encoding.Raw, PublicFormat.Raw
    )
    jwk = {
        "kty": "OKP",
        "crv": "Ed25519",
        "alg": "EdDSA",
        "kid": _TEST_KID,
        "x": _b64url(raw_public),
    }
    return private_pem, jwk


_TEST_PRIVATE_PEM, _TEST_JWK = _build_keypair()
_TEST_JWKS_DOC: dict[str, Any] = {"keys": [_TEST_JWK]}


def signed_jwt(
    user_id: uuid.UUID | str,
    *,
    email: str = "test@example.com",
    is_admin: bool = False,
    expires_in: timedelta = timedelta(minutes=15),
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Mint a Better-Auth-shaped Ed25519 JWT for the given user_id.

    Returns a token signed with the test JWKS keypair. Verifier picks
    it up because :func:`_patch_jwks_globally` (an autouse fixture)
    patches ``ba_security.httpx.get`` to return the matching JWKS doc.
    """
    now = datetime.now(tz=UTC)
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "iss": _TEST_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_in).timestamp()),
        "email": email,
        "is_admin": is_admin,
    }
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(
        claims,
        _TEST_PRIVATE_PEM,
        algorithm="EdDSA",
        headers={"kid": _TEST_KID},
    )


def auth_headers(user: User) -> dict[str, str]:
    """Build an ``Authorization: Bearer`` header for ``user``.

    Common-case helper for the many existing tests that call domain
    routes with a Bearer token. Email and is_admin are included in the
    JWT payload because some endpoints log them, but FastAPI's
    ``require_admin`` re-reads is_admin from the DB row — the JWT's
    is_admin claim is informational only.
    """
    return {
        "Authorization": (
            f"Bearer {signed_jwt(user.id, email=user.email or '', is_admin=user.is_admin)}"
        )
    }


async def make_user(
    db: AsyncSession,
    *,
    email: str = "test@example.com",
    name: str | None = "Test User",
    is_admin: bool = False,
    orcid_id: str | None = None,
) -> User:
    """Create + commit a User row.

    Replaces the old ``auth_service.register_with_password`` calls that
    every domain test used to set up an authenticated principal. We no
    longer need an account row (BA owns ``account``) or a refresh
    token row (BA owns ``session``) for tests — verifying the JWT and
    looking up the user row is the entire identity contract.
    """
    user = User(
        email=email.lower(),
        name=name,
        is_admin=is_admin,
        orcid_id=orcid_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_jwks_globally(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make ``verify_better_auth_jwt`` resolve our test keypair every test.

    Autouse so even tests that don't take an explicit auth fixture get
    the patched httpx.get (otherwise an authenticated test that runs
    after :func:`tests.core.test_ba_security` could see a stale fake
    response from there).
    """
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=_TEST_JWKS_DOC)
    monkeypatch.setattr(
        ba_security.httpx, "get", MagicMock(return_value=response)
    )
    # Pin settings so the verifier expects the test issuer / JWKS URL
    # regardless of ``.env`` overrides on a developer's machine.
    from myetal_api.core.config import settings

    monkeypatch.setattr(settings, "better_auth_jwks_url", "http://test/api/auth/jwks")
    monkeypatch.setattr(settings, "better_auth_url", _TEST_ISSUER)
    monkeypatch.setattr(settings, "better_auth_issuer", _TEST_ISSUER)
    ba_security._reset_jwks_caches_for_tests()


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """Fresh in-memory SQLite database per test, with FK enforcement on."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _enforce_fks(dbapi_conn, _conn_record):  # type: ignore[no-untyped-def]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def api_client(db_session: AsyncSession) -> Iterator[TestClient]:
    """FastAPI TestClient with the DB dependency wired to the per-test
    SQLite session. Also resets slowapi's in-memory counter between tests
    so rate-limit tests don't bleed into each other."""
    from myetal_api.core.rate_limit import limiter

    async def _override() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    limiter.reset()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        limiter.reset()
