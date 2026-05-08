"""Better Auth cross-stack identity smoke route — Phase 0 spike.

This file exists ONLY to prove that a JWT minted by Better Auth on the
Next.js side verifies cleanly here on FastAPI via JWKS. It does not (and
must not) replace `api/deps.py::get_current_user`. Phase 1 of the
migration moves the real auth dependency over and deletes this route.

Endpoint:
    GET /healthz/ba-auth
    Authorization: Bearer <better-auth-jwt>
    -> 200 { sub, email, is_admin, ...rest of claims }
    -> 401 on any verification failure

The router is included in `main.py` next to the existing `health_routes`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from myetal_api.core.ba_security import (
    BetterAuthTokenError,
    verify_better_auth_jwt,
)

router = APIRouter(tags=["healthz-ba-auth"])

_bearer = HTTPBearer(auto_error=False)


@router.get("/healthz/ba-auth")
def ba_auth_smoke(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any]:
    """Verify a Better Auth JWT and echo the decoded claims.

    Spike-only. Do not wire any production code path through this route.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = verify_better_auth_jwt(credentials.credentials)
    except BetterAuthTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return {"ok": True, "claims": claims}
