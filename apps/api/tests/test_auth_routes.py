"""HTTP-shape tests for /auth routes that don't already have a focused file.

The auth-service-level behaviour lives in ``test_auth_service.py``;
``test_rate_limit.py`` covers the slowapi 429 path. This file covers the
PATCH /auth/me ORCID conflict surface — the iD-claim 409 error contract
the web app's profile screen depends on.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.deps import get_current_user
from myetal_api.core.database import get_db
from myetal_api.main import app
from myetal_api.services import auth as auth_service


@pytest_asyncio.fixture
async def authed_as_user_b(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """Two registered users + a TestClient signed in as user B. We override
    get_current_user so we can drive PATCHes as B without juggling tokens."""
    from myetal_api.core.rate_limit import limiter

    # User A pre-claims the iD.
    user_a, _, _ = await auth_service.register_with_password(
        db_session, "a@example.com", "hunter22hunter22", "User A"
    )
    await auth_service.set_user_orcid_id(db_session, user_a.id, "0000-0001-2345-6789")

    # User B is the caller making the conflicting PATCH.
    user_b, _, _ = await auth_service.register_with_password(
        db_session, "b@example.com", "hunter22hunter22", "User B"
    )
    await db_session.commit()

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _override_user():  # type: ignore[no-untyped-def]
        return user_b

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    limiter.reset()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        limiter.reset()


def test_patch_me_orcid_id_conflict_returns_409(authed_as_user_b: TestClient) -> None:
    """PATCH /auth/me with an iD already linked to another user → 409 with
    a friendly detail string the web app surfaces verbatim."""
    r = authed_as_user_b.patch(
        "/auth/me",
        json={"orcid_id": "0000-0001-2345-6789"},
    )
    assert r.status_code == 409
    assert "orcid" in r.json()["detail"].lower()
    assert "already" in r.json()["detail"].lower()
