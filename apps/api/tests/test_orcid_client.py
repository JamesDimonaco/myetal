"""Tests for ``services/orcid_client.py``.

Covers:
- The read-public client-credentials token fetch (happy path).
- Token caching: a second call reuses the cached token (no second
  /oauth/token request).
- Token refresh on 401: the works request returns 401 once, the client
  fetches a new token transparently and retries with it.
- Works parse: groups → primary work-summary; DOI extraction across
  multiple external-ids; missing-DOI returns ``None``.

Network is stubbed via ``httpx.MockTransport``. Tests own the transport
so they can assert call counts.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from myetal_api.services import orcid_client


@pytest.fixture(autouse=True)
def _reset_orcid_token_cache() -> Iterator[None]:
    """The token cache is module-level; reset between tests."""
    orcid_client._reset_token_cache()
    yield
    orcid_client._reset_token_cache()


def _works_response_body(
    *,
    with_doi: bool = True,
    extra_external_ids: bool = False,
) -> dict[str, Any]:
    """Build a minimal but realistic ORCID /works response.

    Two groups: the first carries DOI + (optionally) extra ids; the
    second has only a non-DOI external id when ``with_doi=False``.
    """
    primary_external_ids: list[dict[str, Any]] = []
    if extra_external_ids:
        # PMID first to verify the parser keeps walking until it finds the DOI.
        primary_external_ids.append(
            {
                "external-id-type": "pmid",
                "external-id-value": "12345678",
            }
        )
    if with_doi:
        primary_external_ids.append(
            {
                "external-id-type": "doi",
                "external-id-value": "10.1038/nature12373",
            }
        )

    return {
        "group": [
            {
                "external-ids": {
                    "external-id": primary_external_ids,
                },
                "work-summary": [
                    {
                        "title": {"title": {"value": "Resource limits and demography"}},
                        "journal-title": {"value": "Nature"},
                        "publication-date": {"year": {"value": "2013"}},
                        "external-ids": {"external-id": primary_external_ids},
                    }
                ],
            },
            {
                "external-ids": {
                    "external-id": [
                        {
                            "external-id-type": "isbn",
                            "external-id-value": "978-0-12-345678-9",
                        }
                    ]
                },
                "work-summary": [
                    {
                        "title": {"title": {"value": "A book chapter without a DOI"}},
                        "journal-title": None,
                        "publication-date": None,
                        "external-ids": {
                            "external-id": [
                                {
                                    "external-id-type": "isbn",
                                    "external-id-value": "978-0-12-345678-9",
                                }
                            ]
                        },
                    }
                ],
            },
        ]
    }


# ---------- token fetch ----------


async def test_get_read_public_token_happy_path() -> None:
    """A single POST to /oauth/token returns the access_token."""
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        assert req.url.path == "/oauth/token"
        # client_credentials form data
        body = req.content.decode()
        assert "grant_type=client_credentials" in body
        assert "scope=%2Fread-public" in body or "scope=/read-public" in body
        return httpx.Response(200, json={"access_token": "tok-1", "expires_in": 631138518})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        token = await orcid_client.get_read_public_token(http)

    assert token == "tok-1"
    assert len(calls) == 1


async def test_get_read_public_token_caches_across_calls() -> None:
    """Second call to ``get_read_public_token`` should NOT hit the network."""
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return httpx.Response(200, json={"access_token": "tok-cached", "expires_in": 631138518})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        first = await orcid_client.get_read_public_token(http)
        second = await orcid_client.get_read_public_token(http)

    assert first == "tok-cached"
    assert second == "tok-cached"
    assert len(calls) == 1


# ---------- works fetch ----------


async def test_fetch_works_parses_groups_and_extracts_doi() -> None:
    """Happy-path fetch: token + works request, both 200."""
    body = _works_response_body(with_doi=True, extra_external_ids=True)

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "tok-x", "expires_in": 631138518})
        if "/v3.0/" in req.url.path and req.url.path.endswith("/works"):
            assert req.headers["Authorization"] == "Bearer tok-x"
            return httpx.Response(200, json=body)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        works = await orcid_client.fetch_works("0000-0002-1825-0097", http=http)

    # Two groups → two summaries; first has DOI, second doesn't.
    assert len(works) == 2
    first, second = works
    assert first.title == "Resource limits and demography"
    assert first.doi == "10.1038/nature12373"
    assert first.publication_year == 2013
    assert first.journal == "Nature"

    assert second.title == "A book chapter without a DOI"
    assert second.doi is None  # only ISBN was provided
    assert second.publication_year is None
    assert second.journal is None


async def test_fetch_works_refreshes_token_on_401() -> None:
    """If /works returns 401, the client invalidates its token, fetches
    a new one, and retries. The retry uses the new token."""
    # Pre-warm the cache with an obviously-stale token.
    orcid_client._cached_token = "stale-tok"

    token_calls: list[str] = []
    works_calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/oauth/token":
            token_calls.append("tok")
            return httpx.Response(200, json={"access_token": "fresh-tok", "expires_in": 631138518})
        if req.url.path.endswith("/works"):
            auth = req.headers.get("Authorization", "")
            works_calls.append(auth)
            if auth == "Bearer stale-tok":
                return httpx.Response(401, json={"error": "invalid_token"})
            if auth == "Bearer fresh-tok":
                return httpx.Response(200, json=_works_response_body(with_doi=True))
            return httpx.Response(403)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        works = await orcid_client.fetch_works("0000-0002-1825-0097", http=http)

    # Stale + fresh requests both seen; token endpoint hit exactly once
    # (the cache had a value, so the *initial* token fetch was skipped;
    # the 401 invalidates it and one refresh happens).
    assert works_calls == ["Bearer stale-tok", "Bearer fresh-tok"]
    assert len(token_calls) == 1
    assert len(works) == 2


# ---------- DOI parser edge cases ----------


def test_extract_doi_picks_doi_from_multiple_external_ids() -> None:
    summary = {
        "external-ids": {
            "external-id": [
                {"external-id-type": "pmid", "external-id-value": "12345"},
                {"external-id-type": "DOI", "external-id-value": "10.1038/nature12373"},
                {"external-id-type": "isbn", "external-id-value": "abc"},
            ]
        }
    }
    assert orcid_client._extract_doi(summary) == "10.1038/nature12373"


def test_extract_doi_returns_none_when_no_doi() -> None:
    summary = {
        "external-ids": {
            "external-id": [
                {"external-id-type": "pmid", "external-id-value": "12345"},
            ]
        }
    }
    assert orcid_client._extract_doi(summary) is None


def test_extract_doi_handles_missing_external_ids() -> None:
    assert orcid_client._extract_doi({}) is None
    assert orcid_client._extract_doi({"external-ids": None}) is None
    assert orcid_client._extract_doi({"external-ids": {"external-id": None}}) is None
