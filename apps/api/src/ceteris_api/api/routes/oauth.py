from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse, RedirectResponse

from ceteris_api.api.deps import DbSession
from ceteris_api.core.config import settings
from ceteris_api.models import AuthProvider
from ceteris_api.oauth_providers import ProviderNotConfigured
from ceteris_api.services import oauth as oauth_service
from ceteris_api.services.oauth import StateError, TokenExchangeFailed, UserinfoFailed

router = APIRouter(tags=["oauth"])

ProviderName = Literal["orcid", "google", "github"]
PlatformName = Literal["web", "mobile", "devjson"]


@router.get("/auth/{provider}/start")
async def oauth_start(
    provider: ProviderName,
    return_to: str = Query(default="/", description="Path on the web/mobile app to land on"),
    platform: PlatformName = Query(default="web"),
) -> RedirectResponse:
    if platform == "devjson" and settings.env != "dev":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="devjson platform is only available when ENV=dev",
        )

    try:
        url = oauth_service.start_oauth(AuthProvider(provider), return_to, platform)
    except ProviderNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/auth/{provider}/callback", response_model=None)
async def oauth_callback(
    provider: ProviderName,
    db: DbSession,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
) -> RedirectResponse | JSONResponse:
    """OAuth provider redirects back here. We exchange the code, find/create the
    user, mint our JWT pair, then bounce to the web or mobile finish URL with
    the tokens in the URL fragment so they don't appear in server logs.

    Special case: if the original /start was called with platform=devjson, we
    return the tokens as JSON instead of redirecting — useful for testing
    OAuth end-to-end before the web/mobile finish screens exist. Gated on
    ENV=dev in /start; the callback honours whatever the state says.
    """
    if error:
        return _bounce_failure(error_description or error)

    if not code or not state:
        return _bounce_failure("missing code or state")

    try:
        user, access, refresh, return_to, platform = await oauth_service.complete_oauth(
            db, AuthProvider(provider), code, state
        )
    except StateError as exc:
        return _bounce_failure(f"invalid state: {exc}")
    except TokenExchangeFailed as exc:
        return _bounce_failure(f"token exchange failed: {exc}")
    except UserinfoFailed as exc:
        return _bounce_failure(f"failed to load profile: {exc}")
    except ProviderNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    if platform == "devjson":
        return JSONResponse(
            {
                "access_token": access,
                "refresh_token": refresh,
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "name": user.name,
                },
                "return_to": return_to,
                "note": "dev-only response. Real web flow sets cookies; mobile uses deep links.",
            }
        )

    return _bounce_success(access, refresh, return_to, platform)


def _bounce_success(access: str, refresh: str, return_to: str, platform: str) -> RedirectResponse:
    fragment = urlencode({"access_token": access, "refresh_token": refresh, "return_to": return_to})
    base = settings.public_base_url.rstrip("/")
    finish_path = "/auth/finish" if platform == "web" else "/auth/mobile-finish"
    return RedirectResponse(url=f"{base}{finish_path}#{fragment}", status_code=302)


def _bounce_failure(message: str) -> RedirectResponse:
    fragment = urlencode({"error": message})
    base = settings.public_base_url.rstrip("/")
    return RedirectResponse(url=f"{base}/auth/finish#{fragment}", status_code=302)
