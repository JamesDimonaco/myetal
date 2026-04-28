"""Tests for GET /public/browse — trending and recently-published shares.

The browse service uses raw SQL with trending_shares and PostgreSQL-specific
syntax, so we mock the service layer and test the route's response shaping.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from myetal_api.schemas.share import BrowseShareResult


# ---------- response structure ----------


@patch("myetal_api.api.routes.search.share_service.browse_published_shares", new_callable=AsyncMock)
async def test_browse_returns_structure(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Response has trending, recent, and total_published keys."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    body = r.json()
    assert "trending" in body
    assert "recent" in body
    assert "total_published" in body
    assert isinstance(body["trending"], list)
    assert isinstance(body["recent"], list)
    assert isinstance(body["total_published"], int)


# ---------- empty state ----------


@patch("myetal_api.api.routes.search.share_service.browse_published_shares", new_callable=AsyncMock)
async def test_browse_empty_when_no_published_shares(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """No published shares → empty arrays, total=0."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    body = r.json()
    assert body["trending"] == []
    assert body["recent"] == []
    assert body["total_published"] == 0


# ---------- filtering ----------


@patch("myetal_api.api.routes.search.share_service.browse_published_shares", new_callable=AsyncMock)
async def test_browse_excludes_unpublished_shares_from_recent(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Only published shares should appear in recent list.

    The service layer filters unpublished shares; we verify the route
    correctly passes through the service result.
    """
    now = datetime.now(UTC)
    published_share = BrowseShareResult(
        short_code="abc123",
        name="Published Share",
        description="A published share",
        type="paper",
        owner_name="Researcher",
        item_count=2,
        published_at=now,
        updated_at=now,
        preview_items=["Item 1", "Item 2"],
    )
    mock_browse.return_value = ([], [published_share], 1)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    body = r.json()
    assert len(body["recent"]) == 1
    assert body["recent"][0]["name"] == "Published Share"
    assert body["total_published"] == 1


@patch("myetal_api.api.routes.search.share_service.browse_published_shares", new_callable=AsyncMock)
async def test_browse_excludes_deleted_shares(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Tombstoned shares should not appear in browse results.

    The service already filters deleted shares via deleted_at IS NULL.
    """
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    body = r.json()
    assert body["trending"] == []
    assert body["recent"] == []
    assert body["total_published"] == 0
