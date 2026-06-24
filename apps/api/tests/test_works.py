"""Tests for /me/works/* — the personal works library.

Outbound Crossref calls are stubbed via httpx.MockTransport using the same
pattern as test_papers.py. Auth is via a real registered user + access
token in the Authorization header.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.deps import get_current_user
from myetal_api.core.database import get_db
from myetal_api.main import app
from myetal_api.models import Paper, PaperSource, UserPaper, UserPaperAddedVia
from myetal_api.services import orcid_client
from myetal_api.services import papers as papers_service
from myetal_api.services import works as works_service
from myetal_api.services.users import set_user_orcid_id
from tests.conftest import make_user as _make_user_helper


async def register_with_password(db: AsyncSession, email: str, password: str, name: str | None):
    """Compatibility shim — Phase 2 deletes the legacy auth service.

    Tests in this module just need ``(user, _, _)``; password / refresh
    are unused. Returns the same tuple shape so call-sites stay terse.
    """
    user = await _make_user_helper(db, email=email, name=name)
    return user, "", ""


@pytest.fixture(autouse=True)
def _reset_papers_caches() -> Iterator[None]:
    papers_service._reset_caches()
    orcid_client._reset_token_cache()
    yield
    papers_service._reset_caches()
    papers_service._set_transport(None)
    orcid_client._reset_token_cache()


@pytest_asyncio.fixture
async def authed_client(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """Authenticated client + the same DB session the test sees, so we can
    assert against the rows the requests created."""
    user, _, _ = await register_with_password(
        db_session, "works-test@example.com", "hunter22hunter22", "Works Tester"
    )
    await db_session.commit()

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _override_user():  # type: ignore[no-untyped-def]
        return user

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def _install_handler(handler):  # type: ignore[no-untyped-def]
    transport = httpx.MockTransport(handler)
    papers_service._set_transport(transport)


def _crossref_work(
    doi: str = "10.1038/nature12373",
    title: str = "Resource limits and demography",
) -> dict[str, Any]:
    return {
        "status": "ok",
        "message": {
            "DOI": doi,
            "title": [title],
            "author": [
                {"family": "Smith", "given": "Jane"},
                {"family": "Jones", "given": "Alex"},
            ],
            "container-title": ["Nature"],
            "issued": {"date-parts": [[2013, 7, 24]]},
        },
    }


# ---------- POST /me/works ----------


async def test_add_paper_creates_paper_and_library_entry(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))

    r = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["paper"]["doi"] == "10.1038/nature12373"
    assert body["paper"]["title"] == "Resource limits and demography"
    assert body["added_via"] == "manual"
    assert body["hidden_at"] is None

    # Verify a single paper row + a single user_papers row.
    papers = (await db_session.scalars(select(Paper))).all()
    assert len(papers) == 1
    entries = (await db_session.scalars(select(UserPaper))).all()
    assert len(entries) == 1
    assert entries[0].added_via == UserPaperAddedVia.MANUAL


async def test_add_same_doi_twice_is_idempotent(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))

    r1 = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    r2 = authed_client.post("/me/works", json={"identifier": "https://doi.org/10.1038/nature12373"})
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["paper"]["id"] == r2.json()["paper"]["id"]

    # Still exactly one paper + one library entry.
    papers = (await db_session.scalars(select(Paper))).all()
    assert len(papers) == 1
    entries = (await db_session.scalars(select(UserPaper))).all()
    assert len(entries) == 1


async def test_add_paper_with_unknown_doi_returns_404(authed_client: TestClient) -> None:
    _install_handler(lambda r: httpx.Response(404))
    r = authed_client.post("/me/works", json={"identifier": "10.0000/nope"})
    assert r.status_code == 404


async def test_add_paper_with_garbage_identifier_returns_422(
    authed_client: TestClient,
) -> None:
    r = authed_client.post("/me/works", json={"identifier": "this is not a doi"})
    assert r.status_code == 422


async def test_add_paper_when_crossref_500_returns_503(authed_client: TestClient) -> None:
    _install_handler(lambda r: httpx.Response(503))
    r = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    assert r.status_code == 503


async def test_add_paper_requires_auth(api_client: TestClient) -> None:
    r = api_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    assert r.status_code == 401


# ---------- GET /me/works ----------


async def test_list_library_orders_newest_first(
    authed_client: TestClient,
) -> None:
    _install_handler(
        lambda r: httpx.Response(
            200,
            json=_crossref_work(
                doi=("10.1000/" + r.url.path.split("/")[-1]),
                title="t-" + r.url.path.split("/")[-1],
            ),
        )
    )
    authed_client.post("/me/works", json={"identifier": "10.1000/aaa"})
    authed_client.post("/me/works", json={"identifier": "10.1000/bbb"})

    r = authed_client.get("/me/works")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    # Newest first
    dois = [it["paper"]["doi"] for it in items]
    assert dois == ["10.1000/bbb", "10.1000/aaa"]


async def test_list_excludes_hidden_by_default(
    authed_client: TestClient,
) -> None:
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))
    add = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    paper_id = add.json()["paper"]["id"]

    authed_client.delete(f"/me/works/{paper_id}")

    listed = authed_client.get("/me/works").json()
    assert listed == []

    listed_with = authed_client.get("/me/works?include_hidden=true").json()
    assert len(listed_with) == 1
    assert listed_with[0]["hidden_at"] is not None


# ---------- DELETE + restore ----------


async def test_hide_then_restore(authed_client: TestClient) -> None:
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))
    add = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    paper_id = add.json()["paper"]["id"]

    hide = authed_client.delete(f"/me/works/{paper_id}")
    assert hide.status_code == 204

    restore = authed_client.post(f"/me/works/{paper_id}/restore")
    assert restore.status_code == 200
    assert restore.json()["hidden_at"] is None


async def test_re_adding_hidden_doi_restores_it(authed_client: TestClient) -> None:
    """Per the works ticket: re-posting a DOI un-hides any existing entry."""
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))
    add = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    paper_id = add.json()["paper"]["id"]

    authed_client.delete(f"/me/works/{paper_id}")
    again = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    assert again.status_code == 201
    assert again.json()["hidden_at"] is None


async def test_hide_unknown_paper_returns_404(authed_client: TestClient) -> None:
    r = authed_client.delete("/me/works/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ---------- GET /me/works/{paper_id} ----------


async def test_get_single_work(authed_client: TestClient) -> None:
    _install_handler(lambda r: httpx.Response(200, json=_crossref_work()))
    add = authed_client.post("/me/works", json={"identifier": "10.1038/nature12373"})
    paper_id = add.json()["paper"]["id"]

    r = authed_client.get(f"/me/works/{paper_id}")
    assert r.status_code == 200
    assert r.json()["paper"]["doi"] == "10.1038/nature12373"


async def test_get_unknown_work_returns_404(authed_client: TestClient) -> None:
    r = authed_client.get("/me/works/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ---------- POST /me/works/sync-orcid (service + route) ----------


def _orcid_works_body(*entries: dict[str, Any]) -> dict[str, Any]:
    """Wrap a list of {"doi", "title", "year", "journal"} into ORCID's
    grouped /works response shape. ``doi=None`` skips the DOI external-id."""
    groups: list[dict[str, Any]] = []
    for e in entries:
        ext_ids: list[dict[str, Any]] = []
        if e.get("doi"):
            ext_ids.append({"external-id-type": "doi", "external-id-value": e["doi"]})
        groups.append(
            {
                "external-ids": {"external-id": ext_ids},
                "work-summary": [
                    {
                        "title": {"title": {"value": e.get("title", "Untitled")}},
                        "journal-title": {"value": e.get("journal", "Some Journal")},
                        "publication-date": {"year": {"value": str(e.get("year", 2020))}},
                        "external-ids": {"external-id": ext_ids},
                    }
                ],
            }
        )
    return {"group": groups}


def _crossref_router(per_doi: dict[str, dict[str, Any]]):  # type: ignore[no-untyped-def]
    """Crossref handler that dispatches by DOI in the URL path."""

    def handler(req: httpx.Request) -> httpx.Response:
        # Path is /works/{doi-with-slashes-quoted}
        # urllib.parse.unquote is overkill; the test DOIs are simple enough.
        path = req.url.path
        for doi, body in per_doi.items():
            if doi in path or doi.replace("/", "%2F") in path:
                return httpx.Response(200, json={"status": "ok", "message": body})
        return httpx.Response(404)

    return handler


def _orcid_http(works_body: dict[str, Any]) -> httpx.AsyncClient:
    """Build an httpx.AsyncClient whose transport answers ORCID
    /oauth/token with a fixed token and /works with the given body."""

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "tok-test", "expires_in": 631138518})
        if req.url.path.endswith("/works"):
            return httpx.Response(200, json=works_body)
        return httpx.Response(404)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _seed_orcid_user(db: AsyncSession) -> Any:
    user, _, _ = await register_with_password(
        db, "sync-test@example.com", "hunter22hunter22", "Sync Tester"
    )
    await set_user_orcid_id(db, user.id, "0000-0002-1825-0097")
    await db.commit()
    return user


async def test_sync_from_orcid_happy_path(db_session: AsyncSession) -> None:
    """Two works with DOIs (one Crossref-resolvable, one already-known)
    + one without a DOI → 2 added, 1 skipped, last_orcid_sync_at set."""
    user = await _seed_orcid_user(db_session)

    crossref = _crossref_router(
        {
            "10.1000/aaa": {
                "DOI": "10.1000/aaa",
                "title": ["Paper A"],
                "container-title": ["Journal A"],
                "issued": {"date-parts": [[2020]]},
            },
            "10.1000/bbb": {
                "DOI": "10.1000/bbb",
                "title": ["Paper B"],
                "container-title": ["Journal B"],
                "issued": {"date-parts": [[2021]]},
            },
        }
    )
    papers_service._set_transport(httpx.MockTransport(crossref))

    works_body = _orcid_works_body(
        {"doi": "10.1000/aaa", "title": "Paper A"},
        {"doi": "10.1000/bbb", "title": "Paper B"},
        {"doi": None, "title": "No-DOI Paper"},
    )
    async with _orcid_http(works_body) as http:
        result = await works_service.sync_from_orcid(db_session, user.id, http=http)

    assert result.added == 2
    assert result.skipped == 1
    assert result.unchanged == 0
    assert result.errors == []

    # Both library entries are tagged as added_via=ORCID
    entries = (
        await db_session.scalars(select(UserPaper).where(UserPaper.user_id == user.id))
    ).all()
    assert len(entries) == 2
    assert all(e.added_via == UserPaperAddedVia.ORCID for e in entries)

    await db_session.refresh(user)
    assert user.last_orcid_sync_at is not None


async def test_sync_from_orcid_re_sync_idempotent(db_session: AsyncSession) -> None:
    """Running the sync twice in a row: second run reports unchanged."""
    user = await _seed_orcid_user(db_session)
    crossref = _crossref_router(
        {
            "10.1000/aaa": {
                "DOI": "10.1000/aaa",
                "title": ["A"],
                "container-title": ["J"],
                "issued": {"date-parts": [[2020]]},
            },
            "10.1000/bbb": {
                "DOI": "10.1000/bbb",
                "title": ["B"],
                "container-title": ["J"],
                "issued": {"date-parts": [[2021]]},
            },
        }
    )
    papers_service._set_transport(httpx.MockTransport(crossref))

    works_body = _orcid_works_body(
        {"doi": "10.1000/aaa"},
        {"doi": "10.1000/bbb"},
        {"doi": None},
    )

    async with _orcid_http(works_body) as http:
        first = await works_service.sync_from_orcid(db_session, user.id, http=http)
    assert first.added == 2
    assert first.skipped == 1

    async with _orcid_http(works_body) as http:
        second = await works_service.sync_from_orcid(db_session, user.id, http=http)
    assert second.added == 0
    assert second.unchanged == 2
    assert second.skipped == 1


async def test_sync_from_orcid_preserves_hidden_entries(db_session: AsyncSession) -> None:
    """Pre-hide an entry, run sync — the entry stays hidden and counts
    as unchanged (not re-added)."""
    user = await _seed_orcid_user(db_session)

    # Manually add the paper first (so we can hide it before syncing).
    papers_service._set_transport(
        httpx.MockTransport(
            _crossref_router(
                {
                    "10.1000/hidden": {
                        "DOI": "10.1000/hidden",
                        "title": ["Hidden Paper"],
                        "container-title": ["Journal"],
                        "issued": {"date-parts": [[2020]]},
                    },
                }
            )
        )
    )
    paper, _, _ = await works_service.add_paper_by_doi(db_session, user.id, "10.1000/hidden")

    # Hide it.
    await works_service.hide_library_entry(db_session, user.id, paper.id)

    # Sync now sees the same DOI from ORCID.
    works_body = _orcid_works_body({"doi": "10.1000/hidden", "title": "Hidden Paper"})
    async with _orcid_http(works_body) as http:
        result = await works_service.sync_from_orcid(db_session, user.id, http=http)

    assert result.added == 0
    assert result.unchanged == 1
    assert result.skipped == 0

    # Entry is still hidden.
    entry = await db_session.scalar(
        select(UserPaper).where(UserPaper.user_id == user.id, UserPaper.paper_id == paper.id)
    )
    assert entry is not None
    assert entry.hidden_at is not None


async def test_sync_from_orcid_raises_when_orcid_id_unset(db_session: AsyncSession) -> None:
    user, _, _ = await register_with_password(
        db_session, "no-orcid@example.com", "hunter22hunter22", "No ORCID"
    )
    await db_session.commit()

    with pytest.raises(works_service.OrcidIdNotSet):
        await works_service.sync_from_orcid(db_session, user.id)


async def test_sync_from_orcid_propagates_upstream_error(db_session: AsyncSession) -> None:
    user = await _seed_orcid_user(db_session)

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 631138518})
        return httpx.Response(503)  # /works upstream down

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(orcid_client.UpstreamError):
            await works_service.sync_from_orcid(db_session, user.id, http=http)


async def test_sync_from_orcid_stamps_last_orcid_sync_at(db_session: AsyncSession) -> None:
    user = await _seed_orcid_user(db_session)
    assert user.last_orcid_sync_at is None

    works_body = _orcid_works_body()  # zero works → all counts zero
    async with _orcid_http(works_body) as http:
        before = datetime.now(UTC)
        await works_service.sync_from_orcid(db_session, user.id, http=http)

    await db_session.refresh(user)
    assert user.last_orcid_sync_at is not None
    # Timezone-aware datetime stamped at-or-after `before`.
    stamped = user.last_orcid_sync_at
    if stamped.tzinfo is None:
        # SQLite roundtrip may strip tz; treat as UTC for comparison.
        stamped = stamped.replace(tzinfo=UTC)
    assert stamped >= before.replace(microsecond=0)


# ---------- Route-level: POST /me/works/sync-orcid ----------


async def test_route_sync_orcid_returns_200_with_counts(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    # Seed the authed user with an ORCID iD.
    me = (
        await db_session.scalars(select(__import__("myetal_api.models", fromlist=["User"]).User))
    ).first()
    assert me is not None
    me.orcid_id = "0000-0002-1825-0097"
    await db_session.commit()

    # Stub Crossref + ORCID. The ORCID call is made inside the service via
    # an httpx.AsyncClient that the route doesn't inject — so we patch
    # orcid_client.fetch_works directly to avoid needing to plumb a
    # transport through the route.
    from myetal_api.services import orcid_client as oc

    async def fake_fetch_works(orcid_id: str, *, http: Any | None = None):  # type: ignore[no-untyped-def]
        return [
            oc.OrcidWorkSummary(title="A", doi="10.1000/aaa", publication_year=2020, journal="J")
        ]

    papers_service._set_transport(
        httpx.MockTransport(
            _crossref_router(
                {
                    "10.1000/aaa": {
                        "DOI": "10.1000/aaa",
                        "title": ["A"],
                        "container-title": ["J"],
                        "issued": {"date-parts": [[2020]]},
                    }
                }
            )
        )
    )

    original = oc.fetch_works
    oc.fetch_works = fake_fetch_works  # type: ignore[assignment]
    try:
        r = authed_client.post("/me/works/sync-orcid")
    finally:
        oc.fetch_works = original  # type: ignore[assignment]

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == 1
    assert body["skipped"] == 0
    assert body["errors"] == []


async def test_route_sync_orcid_400_when_no_orcid_id(
    authed_client: TestClient,
) -> None:
    r = authed_client.post("/me/works/sync-orcid")
    assert r.status_code == 400
    assert "ORCID" in r.json()["detail"] or "orcid" in r.json()["detail"].lower()


async def test_route_sync_orcid_503_on_orcid_upstream_error(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    from myetal_api.models import User as UserModel
    from myetal_api.services import orcid_client as oc

    me = (await db_session.scalars(select(UserModel))).first()
    assert me is not None
    me.orcid_id = "0000-0002-1825-0097"
    await db_session.commit()

    async def boom(orcid_id: str, *, http: Any | None = None):  # type: ignore[no-untyped-def]
        raise oc.UpstreamError("orcid down")

    original = oc.fetch_works
    oc.fetch_works = boom  # type: ignore[assignment]
    try:
        r = authed_client.post("/me/works/sync-orcid")
    finally:
        oc.fetch_works = original  # type: ignore[assignment]

    assert r.status_code == 503


async def test_route_sync_orcid_rate_limited_after_five_calls(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    from myetal_api.core.rate_limit import limiter
    from myetal_api.models import User as UserModel
    from myetal_api.services import orcid_client as oc

    me = (await db_session.scalars(select(UserModel))).first()
    assert me is not None
    me.orcid_id = "0000-0002-1825-0097"
    await db_session.commit()

    async def fake_fetch_works(orcid_id: str, *, http: Any | None = None):  # type: ignore[no-untyped-def]
        return []

    original = oc.fetch_works
    oc.fetch_works = fake_fetch_works  # type: ignore[assignment]
    limiter.reset()
    try:
        for _ in range(5):
            r = authed_client.post("/me/works/sync-orcid")
            assert r.status_code == 200, r.text
        r = authed_client.post("/me/works/sync-orcid")
        assert r.status_code == 429
    finally:
        oc.fetch_works = original  # type: ignore[assignment]
        limiter.reset()


# ---------- ORCID first-sign-in auto-draft ----------
#
# A first-time ORCID user (no prior sync, no shares) should land on the
# dashboard with a pre-built draft "Publications" share — see PR-spec
# "ORCID first-sign-in auto-draft". Tests cover the service-level helper
# directly, then end-to-end through the sync route.


async def test_auto_create_orcid_draft_share_happy_path(db_session: AsyncSession) -> None:
    """A first-sync user with N library items gets one DRAFT share named
    "Publications" with every library item attached (as both share_items
    rows and share_papers join rows)."""
    from myetal_api.models import ShareItem, SharePaper

    user = await _seed_orcid_user(db_session)

    # Seed two library entries directly (skip the Crossref dance — this
    # test only cares about share creation, not paper import).
    p1 = Paper(
        doi="10.1/aaa",
        title="Paper A",
        authors="Smith J",
        year=2020,
        source=PaperSource.CROSSREF,
    )
    p2 = Paper(
        doi="10.1/bbb",
        title="Paper B",
        authors="Jones A",
        year=2021,
        source=PaperSource.CROSSREF,
    )
    db_session.add_all([p1, p2])
    await db_session.flush()
    db_session.add_all(
        [
            UserPaper(user_id=user.id, paper_id=p1.id, added_via=UserPaperAddedVia.ORCID),
            UserPaper(user_id=user.id, paper_id=p2.id, added_via=UserPaperAddedVia.ORCID),
        ]
    )
    await db_session.commit()

    share = await works_service.auto_create_orcid_draft_share(db_session, user)
    assert share is not None
    assert share.name == "Publications"
    assert share.description and "ORCID" in share.description
    # Critical invariant: NEVER auto-published.
    assert share.published_at is None
    assert share.deleted_at is None

    # Both join paths populated.
    assert len(share.items) == 2
    assert {it.title for it in share.items} == {"Paper A", "Paper B"}
    papers = (
        await db_session.scalars(select(SharePaper).where(SharePaper.share_id == share.id))
    ).all()
    assert len(papers) == 2

    # share_items kind is paper.
    items = (
        await db_session.scalars(select(ShareItem).where(ShareItem.share_id == share.id))
    ).all()
    assert all(it.kind.value == "paper" for it in items)


async def test_auto_create_orcid_draft_share_skips_when_user_has_a_share(
    db_session: AsyncSession,
) -> None:
    """If the user already owns a share (any state), don't pre-build a new
    one — they've already onboarded, even if they then deleted it."""
    from myetal_api.models import Share

    user = await _seed_orcid_user(db_session)
    # Seed a library entry — the gate is on shares, not library.
    p = Paper(
        doi="10.1/aaa", title="A", authors="X", year=2020, source=PaperSource.CROSSREF
    )
    db_session.add(p)
    await db_session.flush()
    db_session.add(UserPaper(user_id=user.id, paper_id=p.id, added_via=UserPaperAddedVia.ORCID))
    # Existing share — could be hand-built, could be a tombstoned old auto-draft.
    db_session.add(
        Share(owner_user_id=user.id, short_code="x" * 7, name="Existing", is_public=True)
    )
    await db_session.commit()

    share = await works_service.auto_create_orcid_draft_share(db_session, user)
    assert share is None


async def test_auto_create_orcid_draft_share_skips_when_user_has_a_tombstoned_share(
    db_session: AsyncSession,
) -> None:
    """A tombstoned share still counts. The user deleted their auto-draft
    once already — never resurrect it."""
    from myetal_api.models import Share

    user = await _seed_orcid_user(db_session)
    p = Paper(
        doi="10.1/aaa", title="A", authors="X", year=2020, source=PaperSource.CROSSREF
    )
    db_session.add(p)
    await db_session.flush()
    db_session.add(UserPaper(user_id=user.id, paper_id=p.id, added_via=UserPaperAddedVia.ORCID))
    tombstoned = Share(
        owner_user_id=user.id,
        short_code="y" * 7,
        name="Publications",
        is_public=True,
        deleted_at=datetime.now(UTC),
    )
    db_session.add(tombstoned)
    await db_session.commit()

    share = await works_service.auto_create_orcid_draft_share(db_session, user)
    assert share is None


async def test_auto_create_orcid_draft_share_skips_when_library_empty(
    db_session: AsyncSession,
) -> None:
    """No library items → no useful share to build."""
    user = await _seed_orcid_user(db_session)
    share = await works_service.auto_create_orcid_draft_share(db_session, user)
    assert share is None


async def test_auto_create_orcid_draft_share_idempotent(db_session: AsyncSession) -> None:
    """Calling twice creates exactly one share — the second call short-circuits
    on the "already has a share" gate."""
    from sqlalchemy import func as sa_func

    from myetal_api.models import Share

    user = await _seed_orcid_user(db_session)
    p = Paper(
        doi="10.1/aaa", title="A", authors="X", year=2020, source=PaperSource.CROSSREF
    )
    db_session.add(p)
    await db_session.flush()
    db_session.add(UserPaper(user_id=user.id, paper_id=p.id, added_via=UserPaperAddedVia.ORCID))
    await db_session.commit()

    first = await works_service.auto_create_orcid_draft_share(db_session, user)
    second = await works_service.auto_create_orcid_draft_share(db_session, user)
    assert first is not None
    assert second is None
    count = await db_session.scalar(
        select(sa_func.count(Share.id)).where(Share.owner_user_id == user.id)
    )
    assert count == 1


async def test_sync_from_orcid_creates_auto_draft_on_first_sync(
    db_session: AsyncSession,
) -> None:
    """End-to-end through the service: first sync imports papers AND
    pre-builds the Publications draft, returning its id in the result."""
    from myetal_api.models import Share

    user = await _seed_orcid_user(db_session)
    crossref = _crossref_router(
        {
            "10.1000/aaa": {
                "DOI": "10.1000/aaa",
                "title": ["A"],
                "container-title": ["J"],
                "issued": {"date-parts": [[2020]]},
            },
        }
    )
    papers_service._set_transport(httpx.MockTransport(crossref))
    works_body = _orcid_works_body({"doi": "10.1000/aaa"})
    async with _orcid_http(works_body) as http:
        result = await works_service.sync_from_orcid(db_session, user.id, http=http)

    assert result.added == 1
    assert result.auto_draft_share_id is not None
    assert result.auto_draft_paper_count == 1

    share = await db_session.get(Share, result.auto_draft_share_id)
    assert share is not None
    assert share.name == "Publications"
    assert share.published_at is None


async def test_sync_from_orcid_skips_auto_draft_on_resync(
    db_session: AsyncSession,
) -> None:
    """Second sync (user already has last_orcid_sync_at) must not create
    another auto-draft, even if the user has deleted the original.
    """
    from sqlalchemy import update

    from myetal_api.models import Share

    user = await _seed_orcid_user(db_session)
    crossref = _crossref_router(
        {
            "10.1000/aaa": {
                "DOI": "10.1000/aaa",
                "title": ["A"],
                "container-title": ["J"],
                "issued": {"date-parts": [[2020]]},
            },
        }
    )
    papers_service._set_transport(httpx.MockTransport(crossref))
    works_body = _orcid_works_body({"doi": "10.1000/aaa"})

    async with _orcid_http(works_body) as http:
        first = await works_service.sync_from_orcid(db_session, user.id, http=http)
    assert first.auto_draft_share_id is not None

    # User deletes the auto-draft (tombstone).
    await db_session.execute(
        update(Share)
        .where(Share.id == first.auto_draft_share_id)
        .values(deleted_at=datetime.now(UTC))
    )
    await db_session.commit()

    async with _orcid_http(works_body) as http:
        second = await works_service.sync_from_orcid(db_session, user.id, http=http)
    assert second.auto_draft_share_id is None
    assert second.auto_draft_paper_count is None


async def test_sync_from_orcid_no_auto_draft_when_zero_works(
    db_session: AsyncSession,
) -> None:
    """First sync with zero works → no auto-draft (library empty after sync)."""
    user = await _seed_orcid_user(db_session)
    works_body = _orcid_works_body()  # empty
    async with _orcid_http(works_body) as http:
        result = await works_service.sync_from_orcid(db_session, user.id, http=http)
    assert result.auto_draft_share_id is None
    assert result.auto_draft_paper_count is None


async def test_route_sync_orcid_returns_auto_draft_share_id(
    authed_client: TestClient, db_session: AsyncSession
) -> None:
    """Route layer surfaces the auto_draft_share_id field on the response
    so the web client can fire the telemetry event + deep-link the banner."""
    from myetal_api.models import User as UserModel
    from myetal_api.services import orcid_client as oc

    me = (await db_session.scalars(select(UserModel))).first()
    assert me is not None
    me.orcid_id = "0000-0002-1825-0097"
    await db_session.commit()

    async def fake_fetch_works(orcid_id: str, *, http: Any | None = None):  # type: ignore[no-untyped-def]
        return [
            oc.OrcidWorkSummary(title="A", doi="10.1000/aaa", publication_year=2020, journal="J")
        ]

    papers_service._set_transport(
        httpx.MockTransport(
            _crossref_router(
                {
                    "10.1000/aaa": {
                        "DOI": "10.1000/aaa",
                        "title": ["A"],
                        "container-title": ["J"],
                        "issued": {"date-parts": [[2020]]},
                    }
                }
            )
        )
    )
    original = oc.fetch_works
    oc.fetch_works = fake_fetch_works  # type: ignore[assignment]
    try:
        r = authed_client.post("/me/works/sync-orcid")
    finally:
        oc.fetch_works = original  # type: ignore[assignment]

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auto_draft_share_id"] is not None
    assert body["auto_draft_paper_count"] == 1
