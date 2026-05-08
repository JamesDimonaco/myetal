"""Better Auth JWT verification — Phase 0 spike helper.

This module is **deliberately additive**: it does not touch the legacy
`core/security.py` (HS256 / `decode_access_token`) or `api/deps.py::get_current_user`.
The single consumer right now is the throwaway `/healthz/ba-auth` route
that proves cross-stack identity (Better Auth on Next.js mints, FastAPI
verifies via JWKS). Phase 1+ will move `get_current_user` over and this
module becomes the canonical verifier.

Algorithm: EdDSA / Ed25519 (matches `apps/web/src/lib/auth.ts`).
JWKS source: `BETTER_AUTH_JWKS_URL` env var (e.g.
`http://localhost:3000/api/ba-auth/jwks` for the spike).

Cache: 10 minutes per JWKS document, with a forced refetch on `kid` miss
so that Better Auth's key rotation never causes a hard verification fail.
"""

from __future__ import annotations

from typing import Any

import httpx
import jwt
from cachetools import TTLCache  # type: ignore[import-untyped]
from jwt.algorithms import OKPAlgorithm

from myetal_api.core.config import settings

# 10-minute JWKS cache. Better Auth's gracePeriod default is 30 days, so
# stale keys are still verifiable for a long time after rotation; 10 min
# is a balance between staleness and load on /jwks.
_JWKS_TTL_SECONDS = 600
_jwks_cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=4, ttl=_JWKS_TTL_SECONDS)


class BetterAuthTokenError(Exception):
    """Raised when a Better Auth JWT fails verification.

    Distinct from the legacy `TokenError` in `core/security.py` so we can
    grep for either independently and so a future Phase 1 change to
    `get_current_user` can surface the right HTTP status / message.
    """


def _jwks_url() -> str:
    url = getattr(settings, "better_auth_jwks_url", "") or ""
    if not url:
        raise BetterAuthTokenError("BETTER_AUTH_JWKS_URL is not configured")
    return url


def _fetch_jwks(force: bool = False) -> dict[str, Any]:
    """Fetch the JWKS document, with a TTL cache.

    `force=True` bypasses the cache. Used after a `kid` miss so we can
    survive key rotation without a stale-cache 401 storm.
    """
    url = _jwks_url()
    if not force:
        cached = _jwks_cache.get(url)
        if cached is not None:
            return cached
    # `httpx.get` is synchronous on purpose — JWKS verification runs from
    # a sync code path inside the FastAPI dep, and the request is tiny.
    # If we ever hit perf trouble we can wrap in `asyncio.to_thread`.
    resp = httpx.get(url, timeout=5.0)
    resp.raise_for_status()
    doc = resp.json()
    if not isinstance(doc, dict) or "keys" not in doc:
        raise BetterAuthTokenError(f"malformed JWKS document at {url}")
    _jwks_cache[url] = doc
    return doc


def _key_for_kid(kid: str | None) -> Any:
    """Resolve a JWK -> a PyJWT-compatible verification key.

    Tries the cache first; if the kid isn't present, refetches once.
    Falls back to "first key in document" when the JWT has no `kid`,
    which matches PyJWKClient's behaviour for single-key JWKS.
    """
    for force in (False, True):
        doc = _fetch_jwks(force=force)
        keys = doc.get("keys") or []
        if kid is None and keys:
            return OKPAlgorithm.from_jwk(keys[0])
        for jwk in keys:
            if jwk.get("kid") == kid:
                return OKPAlgorithm.from_jwk(jwk)
    raise BetterAuthTokenError(f"no JWKS key matched kid={kid!r}")


def verify_better_auth_jwt(token: str) -> dict[str, Any]:
    """Verify a Better Auth Ed25519 JWT and return its decoded claims.

    Raises `BetterAuthTokenError` on any failure. The caller (the spike
    `/healthz/ba-auth` route) maps this to a 401.
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise BetterAuthTokenError(f"malformed token header: {exc}") from exc

    alg = unverified_header.get("alg")
    if alg != "EdDSA":
        raise BetterAuthTokenError(f"unexpected JWT alg {alg!r}; expected EdDSA")

    key = _key_for_kid(unverified_header.get("kid"))

    try:
        payload = jwt.decode(
            token,
            key=key,
            algorithms=["EdDSA"],
            # The BA JWT plugin sets `iss` to the baseURL by default.
            # Spike does not enforce issuer/audience — Phase 1 should.
            options={"require": ["exp", "sub"], "verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise BetterAuthTokenError(f"invalid token: {exc}") from exc

    if not isinstance(payload, dict):
        raise BetterAuthTokenError("decoded payload is not an object")
    return payload
