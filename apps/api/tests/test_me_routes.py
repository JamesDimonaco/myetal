"""HTTP-shape tests for the new ``/me`` router (Phase 2 cutover).

Replaces the legacy ``test_auth_routes.py`` (PATCH /auth/me ORCID
conflict) — the same dup-check contract now lives at PATCH /me/orcid.

Also covers GET /me, the small profile-fetch endpoint web/mobile
clients repoint to (one-line URL change in Phase 3 / Phase 4).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.deps import get_current_user
from myetal_api.core.database import get_db
from myetal_api.main import app
from myetal_api.services import users as users_service
from tests.conftest import auth_headers, make_user


@pytest_asyncio.fixture
async def authed_as_user_b(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """Two registered users + a TestClient signed in as user B. We
    override get_current_user so we can drive PATCHes as B without
    juggling the BA-JWT cookie in TestClient (the unit test for the
    JWT path itself lives in tests/core/test_ba_security.py)."""
    from myetal_api.core.rate_limit import limiter

    # User A pre-claims the iD.
    user_a = await make_user(db_session, email="a@example.com", name="User A")
    await users_service.set_user_orcid_id(db_session, user_a.id, "0000-0001-2345-6789")

    # User B is the caller making the conflicting PATCH.
    user_b = await make_user(db_session, email="b@example.com", name="User B")

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


def test_patch_me_orcid_conflict_returns_409(authed_as_user_b: TestClient) -> None:
    """PATCH /me/orcid with an iD already linked to another user → 409
    with a friendly detail string the web app surfaces verbatim."""
    r = authed_as_user_b.patch(
        "/me/orcid",
        json={"orcid_id": "0000-0001-2345-6789"},
    )
    assert r.status_code == 409
    assert "orcid" in r.json()["detail"].lower()
    assert "already" in r.json()["detail"].lower()


def test_patch_me_orcid_accepts_new_id(authed_as_user_b: TestClient) -> None:
    """A fresh, unclaimed iD round-trips on PATCH /me/orcid."""
    r = authed_as_user_b.patch(
        "/me/orcid",
        json={"orcid_id": "0000-0002-1825-0097"},
    )
    assert r.status_code == 200
    assert r.json()["orcid_id"] == "0000-0002-1825-0097"


def test_patch_me_orcid_clears_with_null(authed_as_user_b: TestClient) -> None:
    """``orcid_id: null`` clears the iD."""
    r = authed_as_user_b.patch("/me/orcid", json={"orcid_id": None})
    assert r.status_code == 200
    assert r.json()["orcid_id"] is None


async def test_get_me_returns_profile(api_client: TestClient, db_session: AsyncSession) -> None:
    """GET /me returns the calling user's UserResponse via BA JWT."""
    user = await make_user(db_session, email="me-test@example.com", name="Me Test")
    r = api_client.get("/me", headers=auth_headers(user))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(user.id)
    assert body["email"] == "me-test@example.com"
    assert body["name"] == "Me Test"


def test_get_me_unauthenticated_returns_401(api_client: TestClient) -> None:
    r = api_client.get("/me")
    assert r.status_code == 401
    # Generic message — no information disclosure about which check fired.
    assert r.json()["detail"] == "Invalid or expired session"


def test_get_me_invalid_token_returns_generic_401(api_client: TestClient) -> None:
    r = api_client.get("/me", headers={"Authorization": "Bearer garbage-not-a-jwt"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid or expired session"
