"""Better Auth JWT verification.

Verifies an Ed25519-signed JWT minted by Better Auth's JWT plugin
against the JWKS document at ``settings.better_auth_jwks_url``. The
single consumer right now is the ``/healthz/ba-auth`` smoke route;
Phase 2 wires this into ``api/deps.py::get_current_user`` and the spike
route is deleted.

Security posture (Phase 1 hardening — see ticket):

* **Issuer pinned.** The decoded ``iss`` claim is required and must
  match ``settings.better_auth_issuer`` (defaults to
  ``BETTER_AUTH_URL``). Tokens minted by anything other than our own
  Better Auth instance are rejected.
* **Algorithm pinned to EdDSA.** Tokens claiming ``alg: none``,
  ``alg: HS*``, or any other family are rejected before the signature
  is even checked. Defends against the classic JWT alg-confusion
  attacks.
* **Fail closed on missing ``kid``.** Every Better Auth JWT carries a
  ``kid`` header that selects the JWK used for verification. A token
  with no ``kid`` is rejected — we never silently fall back to the
  first key in the JWKS.
* **Stale-if-error JWKS cache.** A successful JWKS fetch is cached for
  10 minutes. If a refresh fails (timeout, 5xx, network), we serve the
  most recent cached document for up to 30 minutes from the original
  fetch. This prevents a single transient JWKS outage from 401-storming
  every request. After 30 minutes of consecutive failures we surface
  the error.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
import jwt
from cachetools import TTLCache  # type: ignore[import-untyped]
from jwt.algorithms import OKPAlgorithm

from myetal_api.core.config import settings

# Successful-fetch cache TTL. After this expires we re-fetch on the next
# request; if the re-fetch succeeds we refresh the entry, if it fails we
# fall through to the stale-if-error path below.
_JWKS_FRESH_TTL_SECONDS = 600
# How long we will keep serving a stale (already-expired-from-fresh-cache)
# JWKS document while live fetches are failing. Beyond this we give up
# and propagate the fetch error.
_JWKS_STALE_GRACE_SECONDS = 30 * 60

# Fresh cache (TTL-bounded). On expiry the entry vanishes; a successful
# refetch repopulates it.
_jwks_fresh: TTLCache[str, dict[str, Any]] = TTLCache(
    maxsize=4, ttl=_JWKS_FRESH_TTL_SECONDS
)
# Long-lived "last-known-good" copy keyed by URL. Never auto-evicted —
# we explicitly check ``_jwks_last_fetched_at`` against the grace window
# at read time.
_jwks_last_known: dict[str, dict[str, Any]] = {}
_jwks_last_fetched_at: dict[str, float] = {}

_logger = logging.getLogger(__name__)


class BetterAuthTokenError(Exception):
    """Raised when a Better Auth JWT fails verification."""


def _jwks_url() -> str:
    url = getattr(settings, "better_auth_jwks_url", "") or ""
    if not url:
        raise BetterAuthTokenError("BETTER_AUTH_JWKS_URL is not configured")
    return url


def _expected_issuer() -> str | None:
    """Resolve the expected ``iss`` claim, or ``None`` if we don't pin.

    Pin order: explicit ``BETTER_AUTH_ISSUER`` if set, otherwise
    ``BETTER_AUTH_URL`` (Better Auth's JWT plugin uses the baseURL as
    the issuer by default). If neither is set we fall through with
    ``None`` and decoding will reject for missing iss because we mark
    iss as required.
    """
    explicit = getattr(settings, "better_auth_issuer", "") or ""
    if explicit:
        return explicit
    base = getattr(settings, "better_auth_url", "") or ""
    return base or None


def _fetch_jwks(force: bool = False) -> dict[str, Any]:
    """Return the JWKS document, with stale-if-error fallback.

    Resolution order on each call:
    1. If ``force=False`` and the fresh cache has the URL, return it.
    2. Otherwise hit the network. On 2xx, refresh both caches and
       return the new document.
    3. On any network error: if a last-known-good copy exists and is
       within ``_JWKS_STALE_GRACE_SECONDS`` of its original fetch,
       log a warning and return the stale copy. Otherwise propagate.
    """
    url = _jwks_url()
    if not force:
        cached = _jwks_fresh.get(url)
        if cached is not None:
            return cached

    try:
        # Synchronous on purpose — JWKS verification runs from a sync
        # FastAPI dep, and the JWKS request is tiny. Wrap in
        # asyncio.to_thread if perf ever bites.
        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        doc = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        last = _jwks_last_known.get(url)
        last_fetched = _jwks_last_fetched_at.get(url, 0.0)
        if last is not None and (time.monotonic() - last_fetched) <= _JWKS_STALE_GRACE_SECONDS:
            _logger.warning(
                "JWKS fetch failed (%s); serving stale-if-error copy "
                "(age=%.0fs, grace=%ds)",
                exc,
                time.monotonic() - last_fetched,
                _JWKS_STALE_GRACE_SECONDS,
            )
            return last
        raise BetterAuthTokenError(f"failed to fetch JWKS: {exc}") from exc

    if not isinstance(doc, dict) or "keys" not in doc:
        raise BetterAuthTokenError(f"malformed JWKS document at {url}")
    _jwks_fresh[url] = doc
    _jwks_last_known[url] = doc
    _jwks_last_fetched_at[url] = time.monotonic()
    return doc


def _key_for_kid(kid: str) -> Any:
    """Resolve a JWK -> a PyJWT verification key by ``kid``.

    Tries the cached document first; on miss, refetches once (which
    survives Better Auth's key rotation) and tries again. **Never**
    falls back to "first key in the document" — every BA JWT carries a
    ``kid`` and an unknown ``kid`` is a real failure, not something to
    paper over.
    """
    for force in (False, True):
        doc = _fetch_jwks(force=force)
        for jwk in doc.get("keys") or []:
            if jwk.get("kid") == kid:
                return OKPAlgorithm.from_jwk(jwk)
    raise BetterAuthTokenError(f"no JWKS key matched kid={kid!r}")


def verify_better_auth_jwt(token: str) -> dict[str, Any]:
    """Verify a Better Auth Ed25519 JWT and return its decoded claims.

    Hardening:
    * Algorithm must be EdDSA.
    * ``kid`` header must be present (we never trust ``keys[0]``).
    * Signing key resolved by ``kid`` from the JWKS (with stale-if-error
      fallback for transient JWKS fetch failures).
    * ``iss`` claim is verified against ``settings.better_auth_issuer``
      (defaulting to ``BETTER_AUTH_URL``).
    * ``exp`` and ``sub`` are required.

    Raises :class:`BetterAuthTokenError` on any failure.
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise BetterAuthTokenError(f"malformed token header: {exc}") from exc

    alg = unverified_header.get("alg")
    if alg != "EdDSA":
        raise BetterAuthTokenError(f"unexpected JWT alg {alg!r}; expected EdDSA")

    kid = unverified_header.get("kid")
    if not kid:
        # Fail closed: Better Auth always sets a kid; a missing kid is
        # either a malformed token or a malicious one. Either way we
        # reject — we never silently trust the first key in the JWKS.
        raise BetterAuthTokenError("JWT missing required 'kid' header")

    key = _key_for_kid(kid)

    expected_iss = _expected_issuer()

    try:
        payload = jwt.decode(
            token,
            key=key,
            algorithms=["EdDSA"],
            issuer=expected_iss,
            options={
                "require": ["exp", "sub", "iss"],
                "verify_aud": False,
            },
        )
    except jwt.PyJWTError as exc:
        raise BetterAuthTokenError(f"invalid token: {exc}") from exc

    if not isinstance(payload, dict):
        raise BetterAuthTokenError("decoded payload is not an object")
    return payload


# Test-support: clear all JWKS caches. Used by `tests/core/test_ba_security.py`
# between cases so cache state from one test does not leak into the next.
def _reset_jwks_caches_for_tests() -> None:
    _jwks_fresh.clear()
    _jwks_last_known.clear()
    _jwks_last_fetched_at.clear()
