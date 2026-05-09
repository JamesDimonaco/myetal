"""Tests for the /papers/* endpoints.

Outbound HTTP is stubbed via httpx.MockTransport (same pattern test_oauth.py
uses). The papers service exposes `_set_transport` so we can swap in a fake
transport for the duration of each test, then reset afterwards.

Auth is stubbed by registering a real user via the auth service and signing
the resulting access-token into the Authorization header — that exercises the
real CurrentUser dep and proves anonymous calls bounce with 401.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.deps import get_current_user
from myetal_api.core.database import get_db
from myetal_api.main import app
from myetal_api.services import papers as papers_service
from tests.conftest import make_user as _make_user_helper


async def register_with_password(
    db: AsyncSession, email: str, password: str, name: str | None
):
    """Compatibility shim for the legacy register_with_password call sites."""
    user = await _make_user_helper(db, email=email, name=name)
    return user, "", ""

# ---------- fixtures ----------


@pytest.fixture(autouse=True)
def _reset_paper_caches() -> Iterator[None]:
    papers_service._reset_caches()
    yield
    papers_service._reset_caches()
    papers_service._set_transport(None)


@pytest_asyncio.fixture
async def authed_client(db_session: AsyncSession) -> AsyncIterator[TestClient]:
    """A TestClient that overrides both the DB and the current-user deps so
    every request through this fixture is authenticated as a real user."""
    user, _, _ = await register_with_password(
        db_session, "papers-test@example.com", "hunter22hunter22", "Papers Tester"
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
    """Install a MockTransport that delegates to `handler` and counts calls."""
    counter = {"calls": 0}

    def wrapped(request: httpx.Request) -> httpx.Response:
        counter["calls"] += 1
        return handler(request)

    transport = httpx.MockTransport(wrapped)
    papers_service._set_transport(transport)
    return counter


# ---------- DOI normalisation (pure-function tests) ----------


def test_normalise_doi_bare() -> None:
    assert papers_service.normalise_doi("10.1038/nature12373") == "10.1038/nature12373"


def test_normalise_doi_url_https() -> None:
    assert (
        papers_service.normalise_doi("https://doi.org/10.1038/nature12373") == "10.1038/nature12373"
    )


def test_normalise_doi_url_http_dx() -> None:
    assert (
        papers_service.normalise_doi("http://dx.doi.org/10.1038/nature12373")
        == "10.1038/nature12373"
    )


def test_normalise_doi_with_doi_prefix() -> None:
    assert papers_service.normalise_doi("doi:10.1038/nature12373") == "10.1038/nature12373"


def test_normalise_doi_strips_trailing_slash() -> None:
    assert papers_service.normalise_doi("10.1038/nature12373/") == "10.1038/nature12373"


def test_normalise_doi_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        papers_service.normalise_doi("not a doi at all")


# ---------- author formatting ----------


def test_format_authors_empty_returns_none() -> None:
    assert papers_service._format_authors(None) is None
    assert papers_service._format_authors([]) is None


def test_format_authors_under_seven_lists_all() -> None:
    crossref_authors = [
        {"family": "Smith", "given": "Jane"},
        {"family": "Jones", "given": "Alex"},
    ]
    assert papers_service._format_authors(crossref_authors) == "Smith J, Jones A"


def test_format_authors_over_six_truncates_with_et_al() -> None:
    authors = [{"family": f"Author{i}", "given": "X"} for i in range(10)]
    formatted = papers_service._format_authors(authors)
    assert formatted is not None
    assert formatted.count(",") == 6  # 6 names, then ", ... et al."
    assert formatted.endswith("... et al.")


def test_format_authors_openalex_shape() -> None:
    openalex_authors = [
        {"author": {"display_name": "Jane Q. Smith"}},
        {"author": {"display_name": "Alex Jones"}},
    ]
    assert papers_service._format_authors(openalex_authors) == "Smith JQ, Jones A"


# ---------- /papers/lookup HTTP behaviour ----------


def _crossref_work(doi: str = "10.1038/nature12373") -> dict[str, Any]:
    return {
        "status": "ok",
        "message": {
            "DOI": doi,
            "title": ["Resource limits and demography"],
            "author": [
                {"family": "Smith", "given": "Jane"},
                {"family": "Jones", "given": "Alex"},
            ],
            "container-title": ["Nature"],
            "issued": {"date-parts": [[2013, 7, 24]]},
        },
    }


def test_lookup_happy_path(authed_client: TestClient) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "api.crossref.org" in str(request.url)
        assert "mailto=team%40myetal.app" in str(request.url)
        assert "MyEtAlAPI" in request.headers.get("user-agent", "")
        return httpx.Response(200, json=_crossref_work())

    _install_handler(handler)

    response = authed_client.post(
        "/papers/lookup", json={"identifier": "https://doi.org/10.1038/nature12373"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["doi"] == "10.1038/nature12373"
    assert body["title"] == "Resource limits and demography"
    assert body["authors"] == "Smith J, Jones A"
    assert body["year"] == 2013
    assert body["container"] == "Nature"
    assert body["source"] == "crossref"
    assert body["scholar_url"].startswith("https://scholar.google.com/scholar?q=")


def test_lookup_crossref_404(authed_client: TestClient) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="Resource not found.")

    _install_handler(handler)

    response = authed_client.post("/papers/lookup", json={"identifier": "10.9999/does-not-exist"})
    assert response.status_code == 404


def test_lookup_crossref_5xx_becomes_503(authed_client: TestClient) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream broken")

    _install_handler(handler)

    response = authed_client.post("/papers/lookup", json={"identifier": "10.1038/nature12373"})
    assert response.status_code == 503


def test_lookup_malformed_doi_returns_422(authed_client: TestClient) -> None:
    response = authed_client.post("/papers/lookup", json={"identifier": "this is not a DOI"})
    assert response.status_code == 422


def test_lookup_caches_repeat_calls(authed_client: TestClient) -> None:
    counter = _install_handler(lambda _: httpx.Response(200, json=_crossref_work()))

    r1 = authed_client.post("/papers/lookup", json={"identifier": "10.1038/nature12373"})
    r2 = authed_client.post("/papers/lookup", json={"identifier": "10.1038/nature12373"})
    r3 = authed_client.post(
        "/papers/lookup", json={"identifier": "https://doi.org/10.1038/nature12373"}
    )

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r3.status_code == 200
    # Three identical-by-DOI requests should hit Crossref exactly once.
    assert counter["calls"] == 1


# ---------- /papers/search ----------


def _openalex_results() -> dict[str, Any]:
    return {
        "meta": {"count": 2},
        "results": [
            {
                "display_name": "Attention Is All You Need",
                "doi": "https://doi.org/10.48550/arXiv.1706.03762",
                "publication_year": 2017,
                "primary_location": {"source": {"display_name": "arXiv"}},
                "authorships": [
                    {"author": {"display_name": "Ashish Vaswani"}},
                    {"author": {"display_name": "Noam Shazeer"}},
                ],
                "relevance_score": 12.5,
            },
            {
                "display_name": "A second relevant paper",
                "doi": None,
                "publication_year": 2020,
                "primary_location": {},
                "authorships": [],
                "relevance_score": 3.1,
            },
        ],
    }


def test_search_happy_path(authed_client: TestClient) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "api.openalex.org" in str(request.url)
        assert "mailto=team%40myetal.app" in str(request.url)
        assert "search=" in str(request.url)
        return httpx.Response(200, json=_openalex_results())

    _install_handler(handler)

    response = authed_client.get("/papers/search", params={"q": "attention is all you need"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 2
    first = body["results"][0]
    assert first["title"] == "Attention Is All You Need"
    assert first["doi"] == "10.48550/arXiv.1706.03762"
    assert first["year"] == 2017
    assert first["score"] == 12.5
    assert first["source"] == "openalex"


def test_search_empty_query_rejected(authed_client: TestClient) -> None:
    response = authed_client.get("/papers/search", params={"q": "   "})
    # FastAPI's min_length=1 catches "" but not whitespace; the service-level
    # ValueError handles whitespace-only input → 422.
    assert response.status_code == 422


def test_search_caches_identical_query(authed_client: TestClient) -> None:
    counter = _install_handler(lambda _: httpx.Response(200, json=_openalex_results()))

    r1 = authed_client.get("/papers/search", params={"q": "graph neural networks"})
    r2 = authed_client.get("/papers/search", params={"q": "graph neural networks"})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert counter["calls"] == 1


# ---------- auth ----------


def test_lookup_requires_auth() -> None:
    """Anonymous request (no overrides, no token) must be rejected with 401."""
    with TestClient(app) as client:
        response = client.post("/papers/lookup", json={"identifier": "10.1038/nature12373"})
    assert response.status_code == 401


def test_search_requires_auth() -> None:
    with TestClient(app) as client:
        response = client.get("/papers/search", params={"q": "anything"})
    assert response.status_code == 401
