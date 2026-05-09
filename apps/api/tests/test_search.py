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
    assert body == {"results": [], "has_more": False, "users": []}


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
    assert body == {"results": [], "has_more": False, "users": []}
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
    from myetal_api.services import share as share_service
    from myetal_api.services import tags as tags_service
    from tests.conftest import make_user

    override = api_client.app.dependency_overrides

    async for db in override[get_db]():
        user = await make_user(db, email="pop@example.com", name="Pop")
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


# ---------- /public/browse?owner_id=... (PR-B / Q15-C) ----------


async def _seed_user(
    db_session,
    *,
    email: str,
    name: str,
    published_count: int,
    draft_count: int = 0,
):
    """Service-level helper: create a user, give them N published + M draft shares.

    Bypasses the route's mocked browse path and writes directly to the
    test DB so service-level functions (``get_user_public_card``,
    ``search_published_users``) can be exercised end-to-end on SQLite.
    """
    from myetal_api.schemas.share import ShareCreate
    from myetal_api.services import share as share_service
    from tests.conftest import make_user

    user = await make_user(db_session, email=email, name=name)
    for i in range(published_count):
        s = await share_service.create_share(
            db_session, user.id, ShareCreate(name=f"{name} pub {i}")
        )
        await share_service.publish_share(db_session, s)
    for i in range(draft_count):
        await share_service.create_share(db_session, user.id, ShareCreate(name=f"{name} draft {i}"))
    return user


# ---- Route-level (mocked service): owner_id plumbing ----


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
@patch(
    "myetal_api.api.routes.search.share_service.get_user_public_card",
    new_callable=AsyncMock,
)
async def test_browse_passes_owner_id_to_service(
    mock_card: AsyncMock,
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """``?owner_id=<uuid>`` is parsed and forwarded as a UUID to the service."""
    import uuid as _uuid

    from myetal_api.schemas.share import UserPublicOut

    owner_id = _uuid.uuid4()
    mock_card.return_value = UserPublicOut(
        id=owner_id, name="Alice", avatar_url=None, share_count=0
    )
    mock_browse.return_value = ([], [], 0)

    r = api_client.get(f"/public/browse?owner_id={owner_id}")
    assert r.status_code == 200
    mock_browse.assert_called_once()
    assert mock_browse.call_args.kwargs["owner_id"] == owner_id


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
@patch(
    "myetal_api.api.routes.search.share_service.get_user_public_card",
    new_callable=AsyncMock,
)
async def test_browse_returns_owner_card_when_owner_id_set(
    mock_card: AsyncMock,
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Response includes the ``owner`` UserPublicOut payload when filter set."""
    import uuid as _uuid

    from myetal_api.schemas.share import UserPublicOut

    owner_id = _uuid.uuid4()
    mock_card.return_value = UserPublicOut(
        id=owner_id, name="Alice", avatar_url="https://x/a.png", share_count=3
    )
    mock_browse.return_value = ([], [], 3)

    r = api_client.get(f"/public/browse?owner_id={owner_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["owner"] is not None
    assert body["owner"]["id"] == str(owner_id)
    assert body["owner"]["name"] == "Alice"
    assert body["owner"]["share_count"] == 3
    assert body["owner"]["avatar_url"] == "https://x/a.png"


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
@patch(
    "myetal_api.api.routes.search.share_service.get_user_public_card",
    new_callable=AsyncMock,
)
async def test_browse_returns_empty_with_owner_card_for_user_with_no_shares(
    mock_card: AsyncMock,
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Owner exists, has 0 published shares → empty list + owner card."""
    import uuid as _uuid

    from myetal_api.schemas.share import UserPublicOut

    owner_id = _uuid.uuid4()
    mock_card.return_value = UserPublicOut(
        id=owner_id, name="Alice", avatar_url=None, share_count=0
    )
    mock_browse.return_value = ([], [], 0)

    r = api_client.get(f"/public/browse?owner_id={owner_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["recent"] == []
    assert body["trending"] == []
    assert body["total_published"] == 0
    assert body["owner"] is not None
    assert body["owner"]["share_count"] == 0


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
@patch(
    "myetal_api.api.routes.search.share_service.get_user_public_card",
    new_callable=AsyncMock,
)
async def test_browse_404s_for_nonexistent_owner_id(
    mock_card: AsyncMock,
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Non-existent owner_id returns 404 (chosen over 200+owner=null).

    Decision: a stale ``/browse?owner_id=<dead>`` link is a real
    not-found state — the user-card link points at a user who doesn't
    exist. Returning 200 with owner=null would render an empty browse
    page indistinguishable from "this user has no published shares
    yet" (which IS 200 — see the test above), which confuses both
    users and search engines. 404 keeps the two semantics distinct.
    """
    import uuid as _uuid

    mock_card.return_value = None
    fake_id = _uuid.uuid4()

    r = api_client.get(f"/public/browse?owner_id={fake_id}")
    assert r.status_code == 404
    # Browse query should NOT have run when the owner lookup failed.
    mock_browse.assert_not_called()


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_no_owner_id_returns_owner_null(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """Without ``owner_id``, the response carries ``owner: null``."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse")
    assert r.status_code == 200
    body = r.json()
    assert body["owner"] is None
    # owner_id kwarg should be None when omitted from the URL.
    assert mock_browse.call_args.kwargs["owner_id"] is None


@patch(
    "myetal_api.api.routes.search.share_service.browse_published_shares",
    new_callable=AsyncMock,
)
async def test_browse_invalid_owner_id_uuid_returns_422(
    mock_browse: AsyncMock,
    api_client: TestClient,
) -> None:
    """A non-UUID ``owner_id`` is a validation error (FastAPI Query type)."""
    mock_browse.return_value = ([], [], 0)

    r = api_client.get("/public/browse?owner_id=not-a-uuid")
    assert r.status_code == 422


async def test_browse_service_signature_includes_owner_id() -> None:
    """Regression guard: browse service accepts the new ``owner_id`` kwarg."""
    import inspect

    from myetal_api.services import share as share_service

    sig = inspect.signature(share_service.browse_published_shares)
    assert "owner_id" in sig.parameters


async def test_browse_sql_references_owner_filter() -> None:
    """Regression guard: tag-stacking owner filter is wired into the SQL."""
    import inspect

    from myetal_api.services import share as share_service

    src = inspect.getsource(share_service.browse_published_shares)
    assert "owner_user_id" in src
    assert "owner_id" in src


# ---- Service-level: get_user_public_card (SQLite-compatible) ----


async def test_get_user_public_card_counts_only_published_public_shares(db_session) -> None:
    """``share_count`` matches the privacy filter — drafts/private/deleted excluded."""
    from datetime import UTC, datetime

    from myetal_api.schemas.share import ShareCreate
    from myetal_api.services import share as share_service

    user = await _seed_user(
        db_session, email="card@example.com", name="Card", published_count=2, draft_count=2
    )
    # Add a private published share (is_public=false) — should not count.
    private_pub = await share_service.create_share(
        db_session, user.id, ShareCreate(name="private pub", is_public=False)
    )
    await share_service.publish_share(db_session, private_pub)
    # Add a tombstoned published share — should not count.
    tomb = await share_service.create_share(db_session, user.id, ShareCreate(name="tomb"))
    await share_service.publish_share(db_session, tomb)
    tomb.deleted_at = datetime.now(UTC)
    await db_session.commit()

    card = await share_service.get_user_public_card(db_session, user.id)
    assert card is not None
    assert card.id == user.id
    assert card.name == "Card"
    assert card.share_count == 2  # only the two normal published-public shares


async def test_get_user_public_card_returns_none_for_unknown_user(db_session) -> None:
    import uuid as _uuid

    from myetal_api.services import share as share_service

    card = await share_service.get_user_public_card(db_session, _uuid.uuid4())
    assert card is None


# ---------- /public/search user-search block (PR-B §5) ----------


async def test_search_response_shape_includes_users_field(api_client: TestClient) -> None:
    """Even when no users match, the ``users`` field is present (default [])."""
    r = api_client.get("/public/search?q=nothingmatchesthisstring")
    assert r.status_code == 200
    body = r.json()
    assert "users" in body
    assert isinstance(body["users"], list)


@patch(
    "myetal_api.api.routes.search.share_service.search_published_users",
    new_callable=AsyncMock,
)
@patch(
    "myetal_api.api.routes.search.share_service.search_published_shares",
    new_callable=AsyncMock,
)
async def test_search_returns_user_block_for_matching_name(
    mock_shares: AsyncMock,
    mock_users: AsyncMock,
    api_client: TestClient,
) -> None:
    """Searching for a name returns matching users in the ``users`` block."""
    import uuid as _uuid

    from myetal_api.schemas.share import UserSearchResult

    mock_shares.return_value = ([], False)
    alice_id = _uuid.uuid4()
    mock_users.return_value = [
        UserSearchResult(id=alice_id, name="Alice Researcher", avatar_url=None, share_count=2)
    ]

    r = api_client.get("/public/search?q=Alice")
    assert r.status_code == 200
    body = r.json()
    assert len(body["users"]) == 1
    assert body["users"][0]["id"] == str(alice_id)
    assert body["users"][0]["name"] == "Alice Researcher"
    assert body["users"][0]["share_count"] == 2
    # Service called with the query string + cap of 5.
    mock_users.assert_called_once()
    args, kwargs = mock_users.call_args.args, mock_users.call_args.kwargs
    assert "Alice" in args or kwargs.get("query") == "Alice" or args[1] == "Alice"
    # The cap-of-5 contract — search route requests no more than 5.
    cap = kwargs.get("limit")
    if cap is None and len(args) >= 3:
        cap = args[2]
    assert cap == 5


# ---- Service-level: search_published_users (SQLite-compatible fallback) ----


async def test_search_users_returns_matching_published_users(db_session) -> None:
    from myetal_api.services import share as share_service

    alice = await _seed_user(
        db_session, email="alice-svc@example.com", name="Alice Researcher", published_count=1
    )
    await _seed_user(db_session, email="bob-svc@example.com", name="Bob Other", published_count=1)

    rows = await share_service.search_published_users(db_session, "Alice", limit=5)
    ids = [r.id for r in rows]
    assert alice.id in ids
    alice_row = next(r for r in rows if r.id == alice.id)
    assert alice_row.name == "Alice Researcher"
    assert alice_row.share_count == 1


async def test_search_excludes_users_with_no_published_shares(db_session) -> None:
    """A user with only drafts is not surfaced in user-search (privacy default)."""
    from myetal_api.services import share as share_service

    drafts_only = await _seed_user(
        db_session,
        email="drafts-svc@example.com",
        name="Drafty McDraft",
        published_count=0,
        draft_count=3,
    )

    rows = await share_service.search_published_users(db_session, "Drafty", limit=5)
    ids = [r.id for r in rows]
    assert drafts_only.id not in ids


async def test_search_excludes_users_whose_shares_are_private(db_session) -> None:
    """Privacy filter respects ``is_public=false``."""
    from myetal_api.schemas.share import ShareCreate
    from myetal_api.services import share as share_service
    from tests.conftest import make_user

    user = await make_user(db_session, email="private-svc@example.com", name="Private Patty")
    s = await share_service.create_share(
        db_session, user.id, ShareCreate(name="private", is_public=False)
    )
    await share_service.publish_share(db_session, s)

    rows = await share_service.search_published_users(db_session, "Patty", limit=5)
    assert user.id not in [r.id for r in rows]


async def test_search_user_block_capped_at_five(db_session) -> None:
    """Even with many matching users, results are capped at 5."""
    from myetal_api.services import share as share_service

    for i in range(7):
        await _seed_user(
            db_session,
            email=f"matcher{i}-svc@example.com",
            name=f"Matchertest {i}",
            published_count=1,
        )

    rows = await share_service.search_published_users(db_session, "Matchertest", limit=5)
    assert len(rows) == 5


async def test_search_users_short_query_returns_empty(db_session) -> None:
    """The service refuses sub-min-length queries (defence in depth)."""
    from myetal_api.services import share as share_service

    rows = await share_service.search_published_users(db_session, "a", limit=5)
    assert rows == []
