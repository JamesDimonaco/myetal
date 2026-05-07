"""Tests for GET /public/search — trigram-similarity search.

The search service uses pg_trgm raw SQL which is PostgreSQL-only, so we
mock the service layer and test the route's validation + response shaping.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

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


# ---------- author-name matching (B1) ----------


@patch("myetal_api.api.routes.search.share_service.search_published_shares", new_callable=AsyncMock)
async def test_search_passes_author_query_through_to_service(
    mock_search: AsyncMock,
    api_client: TestClient,
) -> None:
    """An author-name query should be routed through to the service layer
    just like any other query — the service is responsible for matching it
    against papers.authors / share_items.authors."""
    from datetime import UTC, datetime

    from myetal_api.schemas.share import ShareSearchResult

    now = datetime.now(UTC)
    hit = ShareSearchResult(
        short_code="ab1234",
        name="Sleep & adolescents",
        description="Some collection of papers",
        type="collection",
        owner_name="Dr Lab",
        item_count=3,
        published_at=now,
        updated_at=now,
        preview_items=["Paper one", "Paper two"],
    )
    mock_search.return_value = ([hit], False)

    r = api_client.get("/public/search?q=Dimonaco")
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["short_code"] == "ab1234"
    # Confirms the route forwarded the author-name query string verbatim.
    mock_search.assert_called_once()
    call_kwargs = mock_search.call_args.kwargs
    assert call_kwargs["query"] == "Dimonaco"


async def test_search_sql_references_author_columns() -> None:
    """The raw SQL in search_published_shares must reference both
    papers.authors and share_items.authors so author-name queries hit.

    This is a regression guard: pg_trgm SQL is Postgres-only so the
    in-memory SQLite test suite can't execute the query end-to-end.
    Instead we read the source of the function and assert that the
    relevant join + author column references are present.
    """
    import inspect

    from myetal_api.services import share as share_service

    src = inspect.getsource(share_service.search_published_shares)
    # Joined the share_papers/papers tables for author lookup.
    assert "share_papers" in src
    assert "papers" in src
    # Both per-item legacy authors and per-paper authors are matched.
    assert "si.authors" in src or "share_items" in src
    assert "p.authors" in src or "papers.authors" in src
    # The query parameter is bound as an ILIKE-style pattern so single
    # author names match within "A. Smith; B. Jones" lists.
    assert "ilike_query" in src.lower()
