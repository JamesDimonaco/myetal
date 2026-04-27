"""Tests for /me/works/* — the personal works library.

Outbound Crossref calls are stubbed via httpx.MockTransport using the same
pattern as test_papers.py. Auth is via a real registered user + access
token in the Authorization header.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
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
from myetal_api.models import Paper, UserPaper, UserPaperAddedVia
from myetal_api.services import papers as papers_service
from myetal_api.services.auth import register_with_password


@pytest.fixture(autouse=True)
def _reset_papers_caches() -> Iterator[None]:
    papers_service._reset_caches()
    yield
    papers_service._reset_caches()
    papers_service._set_transport(None)


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
