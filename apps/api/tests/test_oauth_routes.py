"""TestClient-level tests for the OAuth start/callback HTTP surfaces.

The service-level flow is covered by ``test_oauth.py``; this module focuses
on the HTTP-shape contracts the web/mobile apps depend on:

- callback redirect targets (sign-in?error=... vs /auth/finish#error=...)
- start-time guards on the mobile_redirect scheme allow-list
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.core.database import get_db
from myetal_api.core.oauth import encode_state
from myetal_api.main import app
from myetal_api.models import AuthProvider
from myetal_api.services import oauth as oauth_service
from myetal_api.services.oauth import OrcidIdAlreadyLinked, StateError


@pytest_asyncio.fixture
async def callback_client(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """TestClient sharing the per-test in-memory DB. We don't override the
    user dep here — the OAuth callback is anonymous by design."""
    from myetal_api.core.rate_limit import limiter

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    limiter.reset()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        limiter.reset()


@pytest.fixture
def fixed_public_base_url(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Pin the redirect base so URL assertions don't depend on .env."""
    base = "http://localhost:3000"
    monkeypatch.setattr(settings, "public_base_url", base)
    yield base


# ---------- callback error mappings ----------


def test_oauth_callback_orcid_already_linked_redirects_to_signin_with_error(
    callback_client: TestClient,
    fixed_public_base_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When complete_oauth raises OrcidIdAlreadyLinked the callback bounces
    to /sign-in?error=orcid_already_linked, *not* the silent /auth/finish
    fragment-bounce — the web app needs the query string to render a useful
    message."""
    state = encode_state(AuthProvider.ORCID, "/", "web")

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise OrcidIdAlreadyLinked("0000-0001-2345-6789")

    monkeypatch.setattr(oauth_service, "complete_oauth", boom)

    r = callback_client.get(
        "/auth/orcid/callback",
        params={"code": "anything", "state": state},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"] == f"{fixed_public_base_url}/sign-in?error=orcid_already_linked"


def test_oauth_callback_state_error_redirects_to_signin_with_error(
    callback_client: TestClient,
    fixed_public_base_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed/expired/cross-provider state must bounce via the failure
    fragment — *not* /sign-in?error= (that's reserved for the
    OrcidIdAlreadyLinked case which needs a visible web-app surface)."""

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise StateError("expired")

    monkeypatch.setattr(oauth_service, "complete_oauth", boom)

    r = callback_client.get(
        "/auth/orcid/callback",
        params={"code": "x", "state": "garbage"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    location = r.headers["location"]
    # Failure path uses URL fragment on /auth/finish so tokens never hit logs.
    assert location.startswith(f"{fixed_public_base_url}/auth/finish#")
    assert "error=" in location
    assert "invalid+state" in location or "invalid%20state" in location


# ---------- /auth/{provider}/start: mobile_redirect allow-list ----------


def test_oauth_start_rejects_disallowed_mobile_redirect_scheme(
    api_client: TestClient,
) -> None:
    """``mobile_redirect`` must start with one of the registered schemes
    (see routes/oauth.py:_ALLOWED_MOBILE_REDIRECT_SCHEMES). An ``evil://``
    URL has to come back 403 so we don't bounce tokens to a hostile app."""
    r = api_client.get(
        "/auth/orcid/start",
        params={"platform": "mobile", "mobile_redirect": "evil://steal"},
        follow_redirects=False,
    )
    assert r.status_code == 403
    assert "mobile_redirect" in r.json()["detail"].lower()


def test_oauth_start_blocks_localhost_redirect_in_prod(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``http://localhost`` is dev-only; production must reject it even though
    the scheme is in the allow-list."""
    monkeypatch.setattr(settings, "env", "production")
    r = api_client.get(
        "/auth/orcid/start",
        params={"platform": "mobile", "mobile_redirect": "http://localhost:3000/cb"},
        follow_redirects=False,
    )
    assert r.status_code == 403
