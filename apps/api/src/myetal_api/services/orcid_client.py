"""ORCID Public API client — read-only.

Two responsibilities:

1. Maintain a cached read-public client-credentials access token. ORCID's
   Public API uses 2-legged OAuth (separate from the user's OAuth tokens)
   and a single token can read any user's *public* record. Per ORCID
   docs the token lasts ~20 years; we cache forever in process memory
   and refresh on 401.

2. Fetch a user's public works summary list and surface the bits we need
   (DOI, title, year, journal). External-id parsing prefers ``doi`` and
   ignores everything else (PMID/ISBN/arXiv) — those need a different
   dedup story; see Phase A.6.

The HTTP client is injectable so tests stub the network with
``httpx.MockTransport``. Mirrors the pattern in ``services/oauth.py``
and ``services/papers.py``.

Sandbox vs production base URL is driven by ``settings.orcid_use_sandbox``,
matching the OAuth flow toggle in ``oauth_providers._orcid_base()``.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from myetal_api import __version__
from myetal_api.core.config import settings

logger = logging.getLogger(__name__)


class OrcidClientNotConfigured(Exception):
    """ORCID client_id/secret not set in env. Routes map this to 503."""


def _orcid_credentials() -> tuple[str, str]:
    """Return (client_id, client_secret) for the ORCID Public API.

    The OAuth user-flow side of ORCID is now owned by Better Auth on
    Next.js, but the read-public 2-legged client-credentials grant still
    runs from FastAPI (used by the works-sync worker). The two flows
    use the same registered application credentials, so we read them
    directly from settings here.
    """
    cid = settings.orcid_client_id
    secret = settings.orcid_client_secret.get_secret_value()
    if not cid or not secret:
        raise OrcidClientNotConfigured(
            "orcid client_id/secret not set; check ORCID_CLIENT_ID env var"
        )
    return cid, secret


# Polite-pool style User-Agent so ORCID sysadmins can identify our traffic.
# Mirrors the pattern in services/papers.py (Crossref/OpenAlex).
_USER_AGENT = f"myetal/{__version__} (+https://myetal.app)"

# Defence-in-depth ORCID iD shape check at the fetch_works boundary. The
# schema layer (schemas/user.py) already gates user input, but fetch_works
# is a public surface and a future caller could bypass that. Keep this
# consistent with schemas/user.py:_ORCID_ID_RE.
_ORCID_ID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


class UpstreamError(Exception):
    """ORCID is unreachable / returned a 5xx. The route maps this to 503."""


@dataclass(frozen=True)
class OrcidWorkSummary:
    """A single ``work-summary`` item from ORCID's grouped /works response.

    DOI is the only id we currently dedup on — other identifiers (PMID,
    ISBN, arXiv) are intentionally out of scope for this PR.
    """

    title: str | None
    doi: str | None
    publication_year: int | None
    journal: str | None


# ---------- base URLs ----------


def _orcid_oauth_base() -> str:
    """Token URL host. Sandbox vs prod toggled via settings.orcid_use_sandbox."""
    return "https://sandbox.orcid.org" if settings.orcid_use_sandbox else "https://orcid.org"


def _orcid_pub_base() -> str:
    """Public API host. Sandbox vs prod toggled via settings.orcid_use_sandbox."""
    return (
        "https://pub.sandbox.orcid.org" if settings.orcid_use_sandbox else "https://pub.orcid.org"
    )


# ---------- token cache ----------

# Module-level cached access token. ORCID's read-public token is documented
# as ~20-year-lived, so we cache it for the lifetime of the process and
# only refresh on 401 (see _request_with_token_retry). Single-worker prod
# constraint already holds — no shared-cache concerns.
_cached_token: str | None = None

# Serialise concurrent first-time token fetches. Without this, two
# simultaneous syncs both see the cache empty and both POST /oauth/token,
# which is wasteful (not data-corrupting). The lock keeps the cache check
# and the fetch atomic — the second waiter sees the populated cache and
# returns immediately.
_token_lock = asyncio.Lock()


def _reset_token_cache() -> None:
    """Clear the cached token. Test-only."""
    global _cached_token
    _cached_token = None


async def _fetch_new_token(http: httpx.AsyncClient) -> str:
    """POST {orcid_base}/oauth/token with grant_type=client_credentials."""
    client_id, client_secret = _orcid_credentials()
    url = f"{_orcid_oauth_base()}/oauth/token"
    try:
        response = await http.post(
            url,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
                "scope": "/read-public",
            },
            headers={
                "Accept": "application/json",
                "User-Agent": _USER_AGENT,
            },
        )
    except httpx.HTTPError as exc:
        raise UpstreamError(f"orcid token network error: {exc}") from exc

    if response.status_code >= 500:
        # Don't echo the response body in the user-facing exception — log it
        # separately at warning level for ops debugging. Defence-in-depth
        # against accidental secret leakage in error paths.
        logger.warning(
            "orcid token fetch failed status=%s body=%s",
            response.status_code,
            response.text[:200],
        )
        raise UpstreamError(f"orcid token fetch failed (status {response.status_code})")
    if response.status_code != 200:
        logger.warning(
            "orcid token fetch failed status=%s body=%s",
            response.status_code,
            response.text[:200],
        )
        raise UpstreamError(f"orcid token fetch failed (status {response.status_code})")
    body = response.json()
    token = body.get("access_token")
    if not token:
        # Body shape problem rather than a status problem — log + raise a
        # stable message; the body itself stays out of the exception text.
        logger.warning("orcid token response missing access_token: %s", body)
        raise UpstreamError("orcid token response missing access_token")
    return str(token)


async def get_read_public_token(http: httpx.AsyncClient) -> str:
    """Return a cached read-public token, fetching one if the cache is empty.

    Wrapped in an ``asyncio.Lock`` so two concurrent first-time syncs don't
    both fire a token POST. The second waiter sees the populated cache and
    returns immediately.
    """
    global _cached_token
    # Fast path: no lock needed if the cache is already warm.
    if _cached_token is not None:
        return _cached_token
    async with _token_lock:
        # Re-check inside the lock — another coroutine may have populated
        # the cache while we were waiting.
        if _cached_token is not None:
            return _cached_token
        _cached_token = await _fetch_new_token(http)
        return _cached_token


# ---------- works fetch ----------


async def fetch_works(
    orcid_id: str,
    *,
    http: httpx.AsyncClient | None = None,
) -> list[OrcidWorkSummary]:
    """Return the user's public works summary list.

    Walks ``response['group'][i]['work-summary'][0]`` — ORCID groups
    works that share an external-id and the first summary is the
    canonical one. Skips empty groups defensively.

    Raises ``ValueError`` if ``orcid_id`` doesn't match the canonical
    16-digit ORCID iD shape — defence-in-depth against bypassing the
    schema-layer validation. Raises ``UpstreamError`` on token-fetch
    failure, network error, or a 5xx response. Routes turn the latter
    into HTTP 503.
    """
    if not _ORCID_ID_RE.match(orcid_id):
        raise ValueError("invalid ORCID iD format")
    owns_client = http is None
    client = http or httpx.AsyncClient(timeout=10.0)
    try:
        token = await get_read_public_token(client)
        response = await _get_works_with_retry(client, orcid_id, token)
    finally:
        if owns_client:
            await client.aclose()

    body = response.json()
    return _parse_works_response(body)


async def _get_works_with_retry(
    http: httpx.AsyncClient, orcid_id: str, token: str
) -> httpx.Response:
    """GET /v3.0/{id}/works. On 401, refresh the token once and retry."""
    global _cached_token
    url = f"{_orcid_pub_base()}/v3.0/{orcid_id}/works"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": _USER_AGENT,
    }
    try:
        response = await http.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"orcid works network error: {exc}") from exc

    if response.status_code == 401:
        # Stale token — invalidate and try once more with a fresh one.
        _cached_token = None
        new_token = await _fetch_new_token(http)
        _cached_token = new_token
        try:
            response = await http.get(
                url,
                headers={
                    "Authorization": f"Bearer {new_token}",
                    "Accept": "application/json",
                    "User-Agent": _USER_AGENT,
                },
            )
        except httpx.HTTPError as exc:
            raise UpstreamError(f"orcid works network error: {exc}") from exc

    if response.status_code >= 500:
        raise UpstreamError(f"orcid works {response.status_code}")
    if response.status_code != 200:
        raise UpstreamError(f"orcid works {response.status_code}: {response.text[:200]}")
    return response


def _parse_works_response(body: dict[str, Any]) -> list[OrcidWorkSummary]:
    out: list[OrcidWorkSummary] = []
    for group in body.get("group") or []:
        if not isinstance(group, dict):
            continue
        summaries = group.get("work-summary") or []
        if not summaries:
            continue
        primary = summaries[0]
        if not isinstance(primary, dict):
            continue
        out.append(_parse_work_summary(primary))
    return out


def _parse_work_summary(summary: dict[str, Any]) -> OrcidWorkSummary:
    title_obj = (summary.get("title") or {}).get("title") or {}
    title = title_obj.get("value") if isinstance(title_obj, dict) else None

    journal_obj = summary.get("journal-title") or {}
    journal = journal_obj.get("value") if isinstance(journal_obj, dict) else None

    year: int | None = None
    pub_date = summary.get("publication-date") or {}
    if isinstance(pub_date, dict):
        year_obj = pub_date.get("year") or {}
        if isinstance(year_obj, dict):
            year_val = year_obj.get("value")
            if year_val is not None:
                try:
                    year = int(year_val)
                except (TypeError, ValueError):
                    year = None

    return OrcidWorkSummary(
        title=title,
        doi=_extract_doi(summary),
        publication_year=year,
        journal=journal,
    )


def _extract_doi(summary: dict[str, Any]) -> str | None:
    ext_ids_root = summary.get("external-ids") or {}
    if not isinstance(ext_ids_root, dict):
        return None
    ext_ids = ext_ids_root.get("external-id") or []
    if not isinstance(ext_ids, list):
        return None
    for ext_id in ext_ids:
        if not isinstance(ext_id, dict):
            continue
        id_type = ext_id.get("external-id-type")
        if isinstance(id_type, str) and id_type.lower() == "doi":
            value = ext_id.get("external-id-value")
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


__all__ = [
    "OrcidWorkSummary",
    "UpstreamError",
    "fetch_works",
    "get_read_public_token",
]
