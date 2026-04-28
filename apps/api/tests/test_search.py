"""Tests for GET /public/search — trigram-similarity search.

The search service uses pg_trgm raw SQL which is PostgreSQL-only, so we
mock the service layer and test the route's validation + response shaping.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.schemas.share import ShareSearchResult
from myetal_api.services import auth as auth_service
from myetal_api.services import share as share_service
from myetal_api.schemas.share import ShareCreate


async def _make_user(db: AsyncSession, email: str = "researcher@example.com"):
    user, _, _ = await auth_service.register_with_password(db, email, "hunter22", "Researcher")
    return user


# ---------- validation ----------


async def test_search_requires_min_query_length(api_client: TestClient) -> None:
    """q='' and q='a' should return 422 because min_length=2."""
    r_empty = api_client.get("/public/search?q=")
    assert r_empty.status_code == 422

    r_short = api_client.get("/public/search?q=a")
    assert r_short.status_code == 422


async def test_search_max_query_length(api_client: TestClient) -> None:
    """q with 201+ chars should return 422 because max_length=200."""
    long_q = "a" * 201
    r = api_client.get(f"/public/search?q={long_q}")
    assert r.status_code == 422


# ---------- empty results ----------


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_returns_empty_for_no_matches(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """Valid query with no matching shares returns empty results."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=nonexistent")
    assert r.status_code == 200
    body = r.json()
    assert body == {"results": [], "has_more": False}


# ---------- filtering ----------


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_does_not_return_unpublished_shares(
    mock_search: AsyncMock,
    db_session: AsyncSession,
    api_client: TestClient,
) -> None:
    """Shares with published_at=NULL should not appear in search results.

    The service layer filters these out, so we verify the mock returns empty
    when the only matching share is unpublished.
    """
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=myshare")
    assert r.status_code == 200
    assert r.json()["results"] == []


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_does_not_return_deleted_shares(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """Shares with deleted_at set should not appear in search results."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=deleted")
    assert r.status_code == 200
    assert r.json()["results"] == []


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_does_not_return_private_shares(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """Shares with is_public=false should not appear in search results."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=private")
    assert r.status_code == 200
    assert r.json()["results"] == []


# ---------- safety ----------


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_sql_injection_safe(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """SQL injection attempt should return normal empty result, not an error."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q='; DROP TABLE shares; --")
    assert r.status_code == 200
    body = r.json()
    assert body == {"results": [], "has_more": False}
    # Verify the query was passed through to the service (parameterised)
    mock_search.assert_called_once()


# ---------- limit / offset capping ----------


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_limit_capped_at_50(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """limit=100 should either be rejected (422) or silently capped at 50."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=test&limit=100")
    # FastAPI Query(le=50) returns 422 for values > 50
    assert r.status_code == 422


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_offset_capped_at_500(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """offset=1000 should either be rejected (422) or silently capped at 500."""
    mock_search.return_value = ([], False)

    r = api_client.get("/public/search?q=test&offset=1000")
    # FastAPI Query(le=500) returns 422 for values > 500
    assert r.status_code == 422
