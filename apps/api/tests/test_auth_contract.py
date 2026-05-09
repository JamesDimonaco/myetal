"""Auth contract — Bearer required, cookie rejected.

Locks the post-merge-fix invariant for ``api/deps.py::get_current_user``:

1. A valid BA-shape Ed25519 JWT in ``Authorization: Bearer`` → 200.
2. An invalid Bearer (gibberish, wrong key, expired) → 401.
3. No auth at all → 401.
4. A ``myetal_session`` cookie alone (no Bearer) → 401.

The cookie path was the source of the original bug: BA's session cookie
is a signed ``<token>.<hmac>`` pair, NOT a JWT, so feeding it to PyJWT
always 401'd. After the fix the cookie is intentionally ignored — the
contract is Bearer-only on FastAPI. The web layer mints a real JWT via
``auth.api.getToken`` and forwards it as Bearer; the mobile layer sends
its stored Bearer JWT directly.

Without a test like this, regressions to the cookie path slip through
because every other auth test in the suite uses the Bearer fixture
(``conftest.auth_headers``) and never exercises the cookie code path.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import auth_headers, make_user, signed_jwt


async def test_bearer_with_valid_jwt_returns_200(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """Happy path: BA-shape JWT in Authorization: Bearer → 200 + user payload."""
    user = await make_user(db_session, email="contract@example.com")
    response = api_client.get("/me", headers=auth_headers(user))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "contract@example.com"


def test_no_auth_returns_401(api_client: TestClient) -> None:
    """No Authorization header → 401."""
    response = api_client.get("/me")
    assert response.status_code == 401
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_invalid_bearer_returns_401(api_client: TestClient) -> None:
    """Gibberish that isn't even a JWT → 401 (verifier rejects malformed token)."""
    response = api_client.get(
        "/me", headers={"Authorization": "Bearer not-a-jwt-just-junk"}
    )
    assert response.status_code == 401
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_expired_bearer_returns_401(api_client: TestClient) -> None:
    """A correctly-signed but already-expired JWT → 401."""
    expired = signed_jwt(
        "00000000-0000-0000-0000-000000000001",
        expires_in=timedelta(minutes=-1),
    )
    response = api_client.get("/me", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_session_cookie_alone_is_rejected(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """Sending a ``myetal_session`` cookie WITHOUT a Bearer header → 401.

    Locks the contract: the cookie path is dropped. Even if we plant a
    valid-shape JWT *as* the cookie value, the server must not accept
    it — Bearer is the only accepted carrier. (Real BA cookies are
    ``<random>.<hmac>``, not JWTs; passing a JWT here is the strongest
    case for the cookie path being silently re-enabled, so we test
    that explicitly.)
    """
    # Give the cookie a real, signed JWT — if the cookie path comes back,
    # this is exactly what would let it through.
    user_jwt = signed_jwt("00000000-0000-0000-0000-000000000002")
    api_client.cookies.set("myetal_session", user_jwt)
    try:
        response = api_client.get("/me")
    finally:
        api_client.cookies.clear()
    assert response.status_code == 401
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_session_cookie_with_ba_shape_value_is_rejected(
    api_client: TestClient,
) -> None:
    """A realistic BA-shape session cookie value (``<random>.<hmac>``) → 401.

    This is exactly the byte-shape Better Auth's session cookie has on
    the wire. Feeding it to PyJWT was the original bug; feeding it to
    the dep now must 401, never silently succeed.
    """
    api_client.cookies.set(
        "myetal_session",
        "abc123randomtoken.MEUCIQDexamplehmacsignaturevalue",
    )
    try:
        response = api_client.get("/me")
    finally:
        api_client.cookies.clear()
    assert response.status_code == 401
