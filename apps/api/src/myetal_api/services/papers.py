"""Paper-metadata lookups via Crossref (DOI) and OpenAlex (search).

Both upstreams are free, unauthenticated, and ask that you identify yourself
in the User-Agent / `mailto` querystring (the "polite pool"). We comply on
both fronts.

We never want to hammer either API during a single editing session, so each
client is wrapped in a `cachetools.TTLCache` keyed on the normalised input.
The cache is module-level, in-process, ~256 entries, 1h TTL — that's enough
to deduplicate the typical "user pastes the same DOI twice" pattern without
needing Redis.

Errors:
    PaperNotFound  → upstream returned 404 (or empty results for /lookup)
    PaperUpstreamError → upstream returned 5xx, timed out, or network died
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote, quote_plus

import httpx
from cachetools import TTLCache

from myetal_api.schemas.papers import PaperMetadata, PaperSearchResult

POLITE_EMAIL = "team@myetal.app"
USER_AGENT = f"MyEtalAPI/0.1 (mailto:{POLITE_EMAIL})"
TIMEOUT_SECONDS = 5.0

CROSSREF_URL = "https://api.crossref.org/works/{doi}"
OPENALEX_URL = "https://api.openalex.org/works"

# Module-level caches. Keep small — this is a write-heavy editing flow, not a
# public API; we only need to absorb obvious dedupes within an editing session.
_lookup_cache: TTLCache[str, PaperMetadata] = TTLCache(maxsize=256, ttl=3600)
_search_cache: TTLCache[tuple[str, int], list[PaperSearchResult]] = TTLCache(
    maxsize=256, ttl=3600
)

# Test-only injection point. When set to an httpx.MockTransport (or any other
# AsyncBaseTransport), every outbound client we construct routes through it.
# Routes never set this; only the test suite does, via `_set_transport`.
_test_transport: httpx.AsyncBaseTransport | None = None


def _new_client() -> httpx.AsyncClient:
    if _test_transport is not None:
        return httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=_test_transport)
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS)


def _set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    """Override the outbound transport for every subsequent client. Test-only."""
    global _test_transport
    _test_transport = transport

# Pattern for the bare-DOI shape Crossref returns. We never validate this hard
# at the boundary — Crossref is the source of truth. We only use this to
# extract a DOI from a doi.org URL or a `doi:` prefix.
_DOI_BARE_RE = re.compile(r"10\.\d{4,9}/\S+")


class PaperLookupError(Exception):
    """Base for the two outcomes a route turns into HTTP errors."""


class PaperNotFound(PaperLookupError):
    pass


class PaperUpstreamError(PaperLookupError):
    pass


# ---------- normalisation helpers ----------


def normalise_doi(raw: str) -> str:
    """Strip a DOI to its bare `10.x/y` form.

    Accepts:
        10.1038/nature12373
        doi:10.1038/nature12373
        https://doi.org/10.1038/nature12373
        http://dx.doi.org/10.1038/nature12373
        10.1038/nature12373/  (trailing slash trimmed)

    Raises ValueError if no DOI shape can be extracted.
    """
    s = raw.strip()
    if not s:
        raise ValueError("empty identifier")

    # `doi:` prefix
    if s.lower().startswith("doi:"):
        s = s[4:].strip()

    # URL form — pull whatever comes after the doi.org host
    lowered = s.lower()
    if lowered.startswith(("http://", "https://")):
        # Find the path after doi.org/
        match = re.search(r"doi\.org/(.+)$", s, flags=re.IGNORECASE)
        if match:
            s = match.group(1)

    s = s.rstrip("/")

    # Final shape check — must look like a DOI
    if not _DOI_BARE_RE.match(s):
        raise ValueError(f"not a DOI: {raw!r}")
    return s


def _scholar_url_for_doi(doi: str) -> str:
    return f"https://scholar.google.com/scholar?q={quote_plus(doi)}"


def _scholar_url_for_query(q: str) -> str:
    return f"https://scholar.google.com/scholar?q={quote_plus(q)}"


def _format_authors(authors: list[dict[str, Any]] | None) -> str | None:
    """Render an author list as `Smith J, Jones A, ...` capped at 6 + "et al.".

    Crossref shape: [{"family": "Smith", "given": "J."}, ...]
    OpenAlex shape: [{"author": {"display_name": "Jane Smith"}}, ...]
    """
    if not authors:
        return None

    names: list[str] = []
    for a in authors:
        # OpenAlex authorship object
        if "author" in a and isinstance(a["author"], dict):
            name = a["author"].get("display_name")
            if name:
                names.append(_compact_name(name))
            continue
        # Crossref author object
        family = a.get("family")
        given = a.get("given")
        if family and given:
            initials = "".join(part[0] for part in given.replace(".", "").split() if part)
            names.append(f"{family} {initials}".strip())
        elif family:
            names.append(family)
        elif given:
            names.append(given)
        # else: ignore — corporate authors come through as {"name": "..."}
        elif a.get("name"):
            names.append(str(a["name"]))

    if not names:
        return None

    if len(names) <= 6:
        return ", ".join(names)
    return ", ".join(names[:6]) + ", ... et al."


def _compact_name(display_name: str) -> str:
    """Turn "Jane Q. Smith" into "Smith J" — matches Crossref's terse style.

    Returns the input unchanged if we can't safely split it.
    """
    parts = [p for p in display_name.replace(".", "").split() if p]
    if len(parts) < 2:
        return display_name
    family = parts[-1]
    initials = "".join(p[0] for p in parts[:-1])
    return f"{family} {initials}"


# ---------- Crossref (DOI lookup) ----------


def _parse_crossref_work(work: dict[str, Any]) -> PaperMetadata:
    title_list = work.get("title") or []
    title = title_list[0] if title_list else "Untitled"
    doi = work.get("DOI")

    container_list = work.get("container-title") or []
    container = container_list[0] if container_list else None

    year: int | None = None
    issued = work.get("issued") or {}
    parts = issued.get("date-parts") or []
    if parts and parts[0]:
        try:
            year = int(parts[0][0])
        except (TypeError, ValueError):
            year = None

    return PaperMetadata(
        doi=doi,
        title=title,
        authors=_format_authors(work.get("author")),
        year=year,
        container=container,
        scholar_url=_scholar_url_for_doi(doi) if doi else None,
        source="crossref",
    )


async def lookup_doi(
    identifier: str, *, http_client: httpx.AsyncClient | None = None
) -> PaperMetadata:
    """Resolve a DOI (or DOI URL) to normalised paper metadata via Crossref.

    Raises:
        ValueError on a malformed identifier (route turns into 422)
        PaperNotFound on Crossref 404
        PaperUpstreamError on timeout / 5xx / network failure
    """
    doi = normalise_doi(identifier)

    cached = _lookup_cache.get(doi)
    if cached is not None:
        return cached

    url = CROSSREF_URL.format(doi=quote(doi, safe="/"))
    params = {"mailto": POLITE_EMAIL}

    owns_client = http_client is None
    client = http_client or _new_client()
    try:
        try:
            response = await client.get(
                url, params=params, headers={"User-Agent": USER_AGENT}
            )
        except httpx.HTTPError as exc:
            raise PaperUpstreamError(f"crossref network error: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    if response.status_code == 404:
        raise PaperNotFound(doi)
    if response.status_code >= 500:
        raise PaperUpstreamError(f"crossref {response.status_code}")
    if response.status_code != 200:
        raise PaperUpstreamError(f"crossref {response.status_code}: {response.text[:200]}")

    body = response.json()
    work = body.get("message")
    if not work:
        raise PaperNotFound(doi)

    metadata = _parse_crossref_work(work)
    _lookup_cache[doi] = metadata
    return metadata


# ---------- OpenAlex (title search) ----------


def _parse_openalex_work(work: dict[str, Any]) -> PaperSearchResult:
    title = work.get("display_name") or work.get("title") or "Untitled"
    doi_url = work.get("doi")  # OpenAlex returns a full https://doi.org/... URL
    doi: str | None = None
    if doi_url:
        try:
            doi = normalise_doi(doi_url)
        except ValueError:
            doi = None

    year = work.get("publication_year")
    if year is not None:
        try:
            year = int(year)
        except (TypeError, ValueError):
            year = None

    container = None
    primary_location = work.get("primary_location") or {}
    source_obj = primary_location.get("source") or {}
    if isinstance(source_obj, dict):
        container = source_obj.get("display_name")

    score = work.get("relevance_score")
    if score is None:
        score = 0.0
    else:
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0

    scholar_url = None
    if doi:
        scholar_url = _scholar_url_for_doi(doi)
    elif title:
        scholar_url = _scholar_url_for_query(title)

    return PaperSearchResult(
        doi=doi,
        title=title,
        authors=_format_authors(work.get("authorships")),
        year=year,
        container=container,
        scholar_url=scholar_url,
        source="openalex",
        score=score,
    )


async def search_papers(
    query: str,
    limit: int = 10,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> list[PaperSearchResult]:
    """Search OpenAlex by full-text relevance. Empty list on no matches.

    Raises:
        ValueError on empty query
        PaperUpstreamError on timeout / 5xx / network failure
    """
    q = query.strip()
    if not q:
        raise ValueError("empty query")
    limit = max(1, min(limit, 25))

    cache_key = (q.lower(), limit)
    cached = _search_cache.get(cache_key)
    if cached is not None:
        return cached

    params = {
        "search": q,
        "per_page": str(limit),
        "mailto": POLITE_EMAIL,
    }

    owns_client = http_client is None
    client = http_client or _new_client()
    try:
        try:
            response = await client.get(
                OPENALEX_URL, params=params, headers={"User-Agent": USER_AGENT}
            )
        except httpx.HTTPError as exc:
            raise PaperUpstreamError(f"openalex network error: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    if response.status_code >= 500:
        raise PaperUpstreamError(f"openalex {response.status_code}")
    if response.status_code != 200:
        raise PaperUpstreamError(f"openalex {response.status_code}: {response.text[:200]}")

    body = response.json()
    works = body.get("results") or []
    results = [_parse_openalex_work(w) for w in works]
    _search_cache[cache_key] = results
    return results


# ---------- test helpers ----------


def _reset_caches() -> None:
    """Clear the in-memory caches. Test-only — not exported in __all__."""
    _lookup_cache.clear()
    _search_cache.clear()


__all__ = [
    "PaperLookupError",
    "PaperNotFound",
    "PaperUpstreamError",
    "lookup_doi",
    "normalise_doi",
    "search_papers",
]
