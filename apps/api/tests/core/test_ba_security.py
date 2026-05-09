"""Tests for the Better Auth JWT verifier (Phase 1 hardening).

Covers the three hardening items flagged by the Phase 0 review:

1. **Issuer pin** — ``iss`` claim must match
   ``settings.better_auth_issuer``; mismatch / missing rejected.
2. **Fail closed on missing kid** — header without ``kid`` rejected
   (no fallback to ``keys[0]``).
3. **Stale-if-error JWKS cache** — a JWKS fetch failure within the
   stale grace window serves the last-known-good document; beyond the
   window the failure propagates.

Plus the basics: valid Ed25519 verify, rejection of ``alg=none`` /
``alg=HS256`` / unknown ``kid`` / expired token.

Mocking: we monkeypatch ``ba_security.httpx.get`` rather than spinning
up a real HTTP server. Cleaner and keeps the test suite synchronous.
"""

from __future__ import annotations

import base64
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from myetal_api.core import ba_security
from myetal_api.core.ba_security import (
    BetterAuthTokenError,
    _reset_jwks_caches_for_tests,
    verify_better_auth_jwt,
)
from myetal_api.core.config import settings

# ---------------------------------------------------------------------------
# Test helpers — generate Ed25519 keypairs and build matching JWK / JWT pairs
# in-memory. PyJWT can sign with the raw PEM-encoded private key directly.
# ---------------------------------------------------------------------------


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _new_keypair(kid: str) -> tuple[bytes, dict[str, str]]:
    """Return (private_pem, jwk_dict) for an Ed25519 key with the given kid."""
    private = Ed25519PrivateKey.generate()
    private_pem = private.private_bytes(
        Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
    )
    raw_public = private.public_key().public_bytes(
        Encoding.Raw, PublicFormat.Raw
    )
    jwk = {
        "kty": "OKP",
        "crv": "Ed25519",
        "alg": "EdDSA",
        "kid": kid,
        "x": _b64url(raw_public),
    }
    return private_pem, jwk


def _sign_jwt(
    private_pem: bytes,
    *,
    kid: str | None,
    payload: dict[str, Any],
    alg: str = "EdDSA",
) -> str:
    """Sign a JWT, optionally including / omitting the kid header."""
    headers: dict[str, Any] = {}
    if kid is not None:
        headers["kid"] = kid
    return jwt.encode(payload, private_pem, algorithm=alg, headers=headers)


def _patch_jwks(monkeypatch: pytest.MonkeyPatch, jwks_doc: dict[str, Any]) -> MagicMock:
    """Patch ``ba_security.httpx.get`` to return ``jwks_doc``.

    Returns the mock so individual tests can assert call counts / re-target.
    """
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=jwks_doc)
    mock_get = MagicMock(return_value=response)
    monkeypatch.setattr(ba_security.httpx, "get", mock_get)
    return mock_get


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate_settings_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set deterministic JWKS URL / issuer and reset caches between tests."""
    monkeypatch.setattr(
        settings, "better_auth_jwks_url", "http://localhost:3000/api/auth/jwks"
    )
    monkeypatch.setattr(settings, "better_auth_url", "http://localhost:3000")
    monkeypatch.setattr(settings, "better_auth_issuer", "http://localhost:3000")
    _reset_jwks_caches_for_tests()


@pytest.fixture
def signing_key() -> tuple[bytes, dict[str, str]]:
    return _new_keypair(kid="key-alpha")


def _claims(
    *,
    sub: str = "u1",
    iss: str = "http://localhost:3000",
    exp_offset: int = 60,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(tz=UTC)
    base: dict[str, Any] = {
        "sub": sub,
        "iss": iss,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=exp_offset)).timestamp()),
    }
    if extra:
        base.update(extra)
    return base


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_valid_ed25519_token_verifies(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    token = _sign_jwt(
        private_pem,
        kid=jwk["kid"],
        payload=_claims(extra={"email": "a@b.com", "is_admin": False}),
    )
    claims = verify_better_auth_jwt(token)
    assert claims["sub"] == "u1"
    assert claims["email"] == "a@b.com"
    assert claims["is_admin"] is False


# ---------------------------------------------------------------------------
# Algorithm pinning
# ---------------------------------------------------------------------------


def test_alg_none_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    # Build a "alg=none" token by hand.
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "none", "kid": "anything"}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps(_claims()).encode()
    ).rstrip(b"=").decode()
    token = f"{header}.{payload}."
    _patch_jwks(monkeypatch, {"keys": []})

    with pytest.raises(BetterAuthTokenError, match="unexpected JWT alg"):
        verify_better_auth_jwt(token)


def test_alg_hs256_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    # PyJWT will happily encode HS256 if we hand it a string secret. The
    # verifier must refuse before even trying to verify. Use a 32-byte
    # secret so PyJWT does not emit InsecureKeyLengthWarning at encode time
    # (the bytes are irrelevant — the verifier rejects on alg, never reaches
    # the signature check).
    token = jwt.encode(_claims(), "x" * 32, algorithm="HS256",
                       headers={"kid": "anything"})
    _patch_jwks(monkeypatch, {"keys": []})

    with pytest.raises(BetterAuthTokenError, match="unexpected JWT alg"):
        verify_better_auth_jwt(token)


# ---------------------------------------------------------------------------
# kid handling
# ---------------------------------------------------------------------------


def test_missing_kid_rejected(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    token = _sign_jwt(private_pem, kid=None, payload=_claims())
    with pytest.raises(BetterAuthTokenError, match="missing required 'kid'"):
        verify_better_auth_jwt(token)


def test_unknown_kid_rejected(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    token = _sign_jwt(private_pem, kid="not-in-jwks", payload=_claims())
    with pytest.raises(BetterAuthTokenError, match="no JWKS key matched"):
        verify_better_auth_jwt(token)


# ---------------------------------------------------------------------------
# Issuer pinning
# ---------------------------------------------------------------------------


def test_issuer_mismatch_rejected(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    token = _sign_jwt(
        private_pem,
        kid=jwk["kid"],
        payload=_claims(iss="https://attacker.example"),
    )
    with pytest.raises(BetterAuthTokenError, match="invalid token"):
        verify_better_auth_jwt(token)


def test_missing_iss_rejected(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    payload = _claims()
    del payload["iss"]
    token = _sign_jwt(private_pem, kid=jwk["kid"], payload=payload)

    with pytest.raises(BetterAuthTokenError, match="invalid token"):
        verify_better_auth_jwt(token)


# ---------------------------------------------------------------------------
# Expiry
# ---------------------------------------------------------------------------


def test_expired_token_rejected(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})

    token = _sign_jwt(
        private_pem,
        kid=jwk["kid"],
        payload=_claims(exp_offset=-60),
    )
    with pytest.raises(BetterAuthTokenError, match="invalid token"):
        verify_better_auth_jwt(token)


# ---------------------------------------------------------------------------
# Stale-if-error JWKS cache
# ---------------------------------------------------------------------------


def test_jwks_stale_if_error_within_grace(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    """A failing JWKS fetch within the stale-grace window serves cache."""
    import httpx

    private_pem, jwk = signing_key
    # 1) First call succeeds and warms the last-known-good cache.
    _patch_jwks(monkeypatch, {"keys": [jwk]})
    token = _sign_jwt(
        private_pem, kid=jwk["kid"], payload=_claims()
    )
    verify_better_auth_jwt(token)

    # 2) Force the fresh cache to expire so the next call hits the network.
    ba_security._jwks_fresh.clear()

    # 3) Network now fails. We're well within the 30-min grace window.
    raise_get = MagicMock(side_effect=httpx.ConnectTimeout("boom"))
    monkeypatch.setattr(ba_security.httpx, "get", raise_get)

    claims = verify_better_auth_jwt(token)  # should still verify from stale
    assert claims["sub"] == "u1"
    assert raise_get.call_count >= 1


def test_jwks_fails_after_stale_grace(
    monkeypatch: pytest.MonkeyPatch,
    signing_key: tuple[bytes, dict[str, str]],
) -> None:
    """Beyond the 30-min grace window, JWKS fetch failures propagate."""
    import httpx

    private_pem, jwk = signing_key
    _patch_jwks(monkeypatch, {"keys": [jwk]})
    token = _sign_jwt(
        private_pem, kid=jwk["kid"], payload=_claims(exp_offset=3600)
    )
    verify_better_auth_jwt(token)  # warm cache

    # Backdate the last-known-good fetch to before the grace window.
    url = "http://localhost:3000/api/auth/jwks"
    ba_security._jwks_fresh.clear()
    ba_security._jwks_last_fetched_at[url] = (
        time.monotonic() - (ba_security._JWKS_STALE_GRACE_SECONDS + 60)
    )

    monkeypatch.setattr(
        ba_security.httpx,
        "get",
        MagicMock(side_effect=httpx.ConnectTimeout("boom")),
    )
    with pytest.raises(BetterAuthTokenError, match="failed to fetch JWKS"):
        verify_better_auth_jwt(token)


def test_jwks_no_cache_no_grace_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A first-ever fetch failure (no cache to fall back on) propagates."""
    import httpx

    monkeypatch.setattr(
        ba_security.httpx,
        "get",
        MagicMock(side_effect=httpx.ConnectTimeout("boom")),
    )
    # Build any token shape — we'll never reach decoding.
    private_pem, jwk = _new_keypair("key-x")
    token = _sign_jwt(private_pem, kid=jwk["kid"], payload=_claims())

    with pytest.raises(BetterAuthTokenError, match="failed to fetch JWKS"):
        verify_better_auth_jwt(token)
