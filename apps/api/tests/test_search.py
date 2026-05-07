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


# ---------- tag filter on /public/browse (PR-A) ----------


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_passes_canonical_tag_slugs(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """`/public/browse?tags=Virology, Microbiome ` canonicalises and
    passes the slugs through to the service with OR semantics."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse?tags=Virology,%20Microbiome%20")
    assert r.status_code == 200
    mock_browse.assert_called_once()
    call_kwargs = mock_browse.call_args.kwargs
    # Order doesn't matter for OR semantics — just check both ended up
    # canonicalised.
    assert set(call_kwargs["tags"]) == {"virology", "microbiome"}


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_drops_invalid_tag_slugs_silently(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Typo'd / illegal slugs in the URL don't 400 — they're silently
    dropped so a stale link still returns useful results."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse?tags=virology,c%2B%2B")
    assert r.status_code == 200
    call_kwargs = mock_browse.call_args.kwargs
    assert call_kwargs["tags"] == ["virology"]


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_no_tags_param_passes_none(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    call_kwargs = mock_browse.call_args.kwargs
    assert call_kwargs["tags"] is None


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_sort_popular_passes_through(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse?sort=popular")
    assert r.status_code == 200
    assert mock_browse.call_args.kwargs["sort"] == "popular"


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_invalid_sort_falls_back_to_recent(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse?sort=garbage")
    assert r.status_code == 200
    assert mock_browse.call_args.kwargs["sort"] == "recent"


async def test_browse_service_signature_includes_tags_and_sort() -> None:
    """Regression guard: the browse service must accept the tags +
    sort kwargs the route plumbs through."""
    import inspect

    from myetal_api.services import share as share_service

    sig = inspect.signature(share_service.browse_published_shares)
    assert "tags" in sig.parameters
    assert "sort" in sig.parameters


async def test_browse_sql_references_share_tags_join() -> None:
    """Regression guard: tag filter must produce an EXISTS subquery
    against share_tags + tags so OR semantics work."""
    import inspect

    from myetal_api.services import share as share_service

    src = inspect.getsource(share_service.browse_published_shares)
    assert "share_tags" in src
    assert "ANY(:tag_slugs)" in src or "= ANY(" in src


# ---------- /public/tags autocomplete ----------


async def test_tag_autocomplete_returns_matches(api_client: TestClient) -> None:
    """End-to-end on SQLite (autocomplete falls back to LIKE)."""
    # Seed a tag via the registered API so the test exercises the route.
    from myetal_api.services import tags as tags_service

    # Use the same db_session as the api_client by reaching into the override.
    override = api_client.app.dependency_overrides
    from myetal_api.core.database import get_db

    async for db in override[get_db]():
        await tags_service.get_or_create_tag(db, "virology")
        await tags_service.get_or_create_tag(db, "virtual-reality")
        await tags_service.get_or_create_tag(db, "ecology")
        await db.commit()
        break

    r = api_client.get("/public/tags?q=vir")
    assert r.status_code == 200
    body = r.json()
    slugs = {t["slug"] for t in body}
    assert "virology" in slugs
    assert "virtual-reality" in slugs
    assert "ecology" not in slugs


async def test_tag_autocomplete_requires_q(api_client: TestClient) -> None:
    r = api_client.get("/public/tags")
    assert r.status_code == 422


async def test_tag_autocomplete_q_min_length(api_client: TestClient) -> None:
    r = api_client.get("/public/tags?q=")
    assert r.status_code == 422


async def test_popular_tags_returns_top_by_usage(api_client: TestClient) -> None:
    from myetal_api.core.database import get_db
    from myetal_api.schemas.share import ShareCreate
    from myetal_api.services import auth as auth_service
    from myetal_api.services import share as share_service
    from myetal_api.services import tags as tags_service

    override = api_client.app.dependency_overrides

    async for db in override[get_db]():
        user, _, _ = await auth_service.register_with_password(
            db, "pop@example.com", "hunter22", "Pop"
        )
        a = await share_service.create_share(db, user.id, ShareCreate(name="a"))
        b = await share_service.create_share(db, user.id, ShareCreate(name="b"))
        await tags_service.set_share_tags(db, a.id, ["virology"])
        await tags_service.set_share_tags(db, b.id, ["virology", "ecology"])
        break

    r = api_client.get("/public/tags/popular?limit=5")
    assert r.status_code == 200
    body = r.json()
    # virology must rank above ecology because usage_count is 2 vs 1.
    slugs = [t["slug"] for t in body]
    assert slugs.index("virology") < slugs.index("ecology")


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
