"""Tests for the user-handle subsystem.

Covers:
* ``PATCH /me/handle`` — claim, change, format-422, reserved-400,
  uniqueness-409.
* ``DELETE /me/handle`` — clear, idempotent on already-clear.
* ``GET /public/by-handle/{handle}`` — hit, miss, case-insensitive lookup.
* Lower-level service validation (consecutive separators, leading digit).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.deps import get_current_user
from myetal_api.core.database import get_db
from myetal_api.main import app
from myetal_api.services import handles as handles_service
from tests.conftest import make_user


@pytest_asyncio.fixture
async def authed_client(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """TestClient signed in as a single user with no handle set."""
    from myetal_api.core.rate_limit import limiter

    user = await make_user(db_session, email="handles@example.com", name="Dr Test")

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _override_user():  # type: ignore[no-untyped-def]
        return user

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


# ---------------------------------------------------------------------------
# Service-layer format validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "handle",
    [
        "drsmith",
        "dr_smith",
        "dr-smith",
        "ada",
        "a_b_c",
        "abcde12345",
        "a1234567890123456789012345678",  # 29 chars — at the boundary
    ],
)
def test_valid_handle_format(handle: str) -> None:
    handles_service.validate_handle_format(handle)


@pytest.mark.parametrize(
    "handle",
    [
        "",
        "ab",  # too short
        "a" * 31,  # too long
        "1drsmith",  # leading digit
        "_drsmith",  # leading underscore
        "-drsmith",  # leading hyphen
        "DrSmith",  # uppercase
        "dr smith",  # space
        "dr.smith",  # dot
        "dr@smith",  # at-sign
        "dr__smith",  # consecutive underscores
        "dr--smith",  # consecutive hyphens
        "dr_-smith",  # mixed consecutive separators
        "dr-_smith",  # mixed consecutive separators
    ],
)
def test_invalid_handle_format(handle: str) -> None:
    with pytest.raises(handles_service.InvalidHandle):
        handles_service.validate_handle_format(handle)


def test_reserved_handles_blocked() -> None:
    """A representative reserved handle returns is_reserved=True."""
    assert handles_service.is_reserved("admin")
    assert handles_service.is_reserved("dashboard")
    assert handles_service.is_reserved("u")
    assert not handles_service.is_reserved("drsmith")


# ---------------------------------------------------------------------------
# PATCH /me/handle
# ---------------------------------------------------------------------------


def test_claim_handle_returns_user_with_handle(authed_client: TestClient) -> None:
    r = authed_client.patch("/me/handle", json={"handle": "drsmith"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handle"] == "drsmith"


def test_claim_handle_lowercases_input(authed_client: TestClient) -> None:
    """Pydantic validator lower-cases before validation so DrSmith
    becomes drsmith — the route never sees the cased version."""
    r = authed_client.patch("/me/handle", json={"handle": "DrSmith"})
    assert r.status_code == 200, r.text
    assert r.json()["handle"] == "drsmith"


def test_change_handle_replaces_previous(authed_client: TestClient) -> None:
    r = authed_client.patch("/me/handle", json={"handle": "drsmith"})
    assert r.status_code == 200
    r = authed_client.patch("/me/handle", json={"handle": "newname"})
    assert r.status_code == 200, r.text
    assert r.json()["handle"] == "newname"


@pytest.mark.parametrize(
    "bad_handle",
    [
        "ab",  # too short
        "1drsmith",  # leading digit
        "Dr Smith",  # space — invalid even after lowercasing
        "dr__smith",  # consecutive separators
    ],
)
def test_invalid_handle_returns_422(authed_client: TestClient, bad_handle: str) -> None:
    r = authed_client.patch("/me/handle", json={"handle": bad_handle})
    assert r.status_code == 422, r.text


def test_reserved_handle_returns_400(authed_client: TestClient) -> None:
    r = authed_client.patch("/me/handle", json={"handle": "admin"})
    assert r.status_code == 400, r.text
    assert "reserved" in r.json()["detail"].lower()


async def test_handle_collision_returns_409(
    db_session: AsyncSession, authed_client: TestClient
) -> None:
    """Two users can't share a handle. The second PATCH lands on 409."""
    other = await make_user(db_session, email="other@example.com", name="Other")
    await handles_service.set_user_handle(db_session, other.id, "alreadytaken")

    r = authed_client.patch("/me/handle", json={"handle": "alreadytaken"})
    assert r.status_code == 409, r.text
    assert "taken" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# DELETE /me/handle
# ---------------------------------------------------------------------------


def test_clear_handle_returns_204(authed_client: TestClient) -> None:
    r = authed_client.patch("/me/handle", json={"handle": "drsmith"})
    assert r.status_code == 200
    r = authed_client.delete("/me/handle")
    assert r.status_code == 204
    # Subsequent /me read reports null
    r = authed_client.get("/me")
    assert r.status_code == 200
    assert r.json()["handle"] is None


def test_clear_handle_idempotent(authed_client: TestClient) -> None:
    """DELETE on a user with no handle still returns 204."""
    r = authed_client.delete("/me/handle")
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# GET /public/by-handle/{handle}
# ---------------------------------------------------------------------------


async def test_by_handle_hits_resolves_to_owner(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """A claimed handle resolves to the owner's BrowseResponse — same
    shape /public/browse?owner_id= returns."""
    user = await make_user(db_session, email="byhandle@example.com", name="By Handle")
    await handles_service.set_user_handle(db_session, user.id, "byhandle")

    r = api_client.get("/public/by-handle/byhandle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"] is not None
    assert body["owner"]["id"] == str(user.id)
    assert body["owner"]["handle"] == "byhandle"
    assert body["owner"]["name"] == "By Handle"


async def test_by_handle_unknown_returns_404(api_client: TestClient) -> None:
    r = api_client.get("/public/by-handle/neverclaimed")
    assert r.status_code == 404


async def test_by_handle_case_insensitive(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """URL-cased handles still resolve — the lookup lowercases first."""
    user = await make_user(db_session, email="cased@example.com", name="Cased")
    await handles_service.set_user_handle(db_session, user.id, "casedhandle")

    r = api_client.get("/public/by-handle/CasedHandle")
    assert r.status_code == 200
    assert r.json()["owner"]["id"] == str(user.id)


async def test_browse_owner_card_exposes_handle(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """The owner card on /public/browse?owner_id= now carries the handle
    so the web side can prefer ``/u/{handle}`` over the UUID URL."""
    user = await make_user(db_session, email="owner@example.com", name="Owner")
    await handles_service.set_user_handle(db_session, user.id, "ownerhandle")

    r = api_client.get(f"/public/browse?owner_id={user.id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"]["handle"] == "ownerhandle"
