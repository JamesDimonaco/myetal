"""FastAPI dependencies — calling-user resolution.

Identity is verified entirely from a Better Auth JWT (Ed25519 / EdDSA)
issued by the Next.js side and signed with the active key in the
``jwks`` table. The verifier is hardened in ``core/ba_security.py``:
issuer pinned, fail-closed on missing kid, stale-if-error JWKS cache,
algorithm pinned to EdDSA.

**The contract is Bearer-only.** JWT identity must arrive as
``Authorization: Bearer <jwt>``.

The ``myetal_session`` cookie is set by Better Auth for its own
session management on the Next.js side (it is a signed
``<token>.<hmac>`` pair, NOT a JWT) and cannot be used for FastAPI
auth. An earlier iteration of this dep accepted the cookie value and
fed it to PyJWT, which always failed with "malformed token" — every
request 401'd regardless of validity. The web layer mints a real JWT
via ``auth.api.getToken`` server-side and forwards it as Bearer (see
``apps/web/src/lib/server-api.ts`` and the
``app/api/proxy/[...path]/route.ts`` handler); the mobile layer sends
its stored JWT as Bearer directly.

Authorization (admin gating) checks ``user.email`` against
``settings.admin_emails`` (env-var allowlist), never the JWT claim. The
JWT carries ``is_admin`` as informational only — see ``require_admin``
below.

Generic 401 message: ``"Invalid or expired session"`` regardless of
which JWT-verification check fired. The verifier already records the
specific reason in logs; surfacing it on the wire is information
disclosure (issuer mismatch vs expired vs unknown kid leaks
implementation details to anyone probing the endpoint).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.ba_security import (
    BetterAuthTokenError,
    verify_better_auth_jwt,
)
from myetal_api.core.database import get_db
from myetal_api.models import User

_bearer = HTTPBearer(auto_error=False)

# Generic message — every verification failure reduces to "you need to
# sign in again". The verifier logs the specific reason internally.
_INVALID_SESSION_DETAIL = "Invalid or expired session"


def _extract_token(credentials: HTTPAuthorizationCredentials | None) -> str | None:
    """Return the BA JWT from the ``Authorization: Bearer`` header.

    Bearer is the only accepted source. The ``myetal_session`` cookie
    BA sets is NOT a JWT and is intentionally ignored here (see module
    docstring).
    """
    if credentials is not None:
        token = credentials.credentials.strip()
        if token:
            return token
    return None


def _user_id_from_payload(payload: dict[str, object]) -> uuid.UUID:
    """Return the ``sub`` claim as a UUID, or raise on shape errors."""
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise BetterAuthTokenError("missing sub")
    try:
        return uuid.UUID(sub)
    except ValueError as exc:
        raise BetterAuthTokenError("malformed sub") from exc


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    token = _extract_token(credentials)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_SESSION_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = verify_better_auth_jwt(token)
        user_id = _user_id_from_payload(payload)
    except BetterAuthTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_SESSION_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = await db.get(User, user_id)
    if user is None:
        # Token signature was valid but the user row is gone (admin
        # deleted, fresh-start cutover ran). Treat as 401, same generic
        # message — clients should treat it as "sign in again".
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_SESSION_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Stash on request.state so per-user rate-limit key_funcs can read it
    # without re-doing the JWT decode (see core.rate_limit.authed_user_key).
    request.state.user = user
    return user


async def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    """Like ``get_current_user`` but returns None for anon — never raises 401.

    For endpoints that are usable both signed-in and anon, e.g. take-down
    reports, public share view tracking, and any future "viewer if known"
    surfaces. The presence of a verifiable BA JWT resolves to the user;
    anything missing/invalid resolves to None silently.
    """
    token = _extract_token(credentials)
    if token is None:
        return None
    try:
        payload = verify_better_auth_jwt(token)
        user_id = _user_id_from_payload(payload)
    except BetterAuthTokenError:
        return None
    return await db.get(User, user_id)


async def require_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Gate the /admin/* endpoints behind an email allowlist.

    ``settings.admin_emails`` is a comma-separated env var of allowlisted
    emails. Match is case-insensitive on the user's row email, so
    ``James@Example.com`` granted via env matches ``james@example.com`` on
    the row. Returns 403 (not 401) when authenticated but not on the list
    — auth is fine, authz isn't.

    SECURITY: this dep checks ``user.email`` against ``settings.admin_emails``,
    NEVER the JWT ``is_admin`` claim. The JWT carries ``is_admin`` for the
    web app's UI hints only; trusting it for authorization would let a
    stale JWT (admin downgraded server-side, JWT still in client storage)
    keep elevated rights for up to the JWT TTL. Always read authorization
    from the source of truth.

    NOTE: the ``User.is_admin`` DB column exists (Better Auth additionalField)
    but is NOT consulted here yet — the env-var allowlist is the v1 contract
    because it's set per-deploy and changes require a redeploy, which is the
    same change-control envelope as toggling who's allowed in. If we ever
    want admin to be a runtime-grantable property (e.g. promote a user via
    SQL without a deploy), switch this dep to ``return user if user.is_admin
    else raise HTTPException(...)`` and stop reading ``settings.admin_emails``.
    """
    from myetal_api.core.config import settings

    allowed = {e.lower() for e in settings.admin_emails}
    user_email = (user.email or "").lower()
    if user_email not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin only",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]
AdminUser = Annotated[User, Depends(require_admin)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
