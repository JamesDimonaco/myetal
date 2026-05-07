from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse

from myetal_api.api.deps import DbSession
from myetal_api.core.config import settings
from myetal_api.core.rate_limit import AUTH_LIMIT, limiter
from myetal_api.models import AuthProvider
from myetal_api.oauth_providers import ProviderNotConfigured
from myetal_api.services import oauth as oauth_service
from myetal_api.services.oauth import (
    OrcidIdAlreadyLinked,
    StateError,
    TokenExchangeFailed,
    UserinfoFailed,
)

router = APIRouter(tags=["oauth"])

ProviderName = Literal["orcid", "google", "github"]
PlatformName = Literal["web", "mobile", "devjson"]

# Schemes the OAuth callback is willing to bounce tokens to via mobile_redirect.
# Tokens land in the URL fragment, so the OS's deep-link binding is the only
# thing standing between us and a hostile app intercepting them — we accept the
# same trust model as Universal Links here. Add new schemes deliberately.
_ALLOWED_MOBILE_REDIRECT_SCHEMES = (
    "myetal://",
    "exp+myetal://",  # Expo Go dev client
    "exp://",  # Expo Go on the local LAN (dev only — gated below)
    "http://localhost",  # web fallback for local dev
)


@router.get("/auth/{provider}/start")
@limiter.limit(AUTH_LIMIT)
async def oauth_start(
    request: Request,
    provider: ProviderName,
    return_to: str = Query(default="/", description="Path on the web/mobile app to land on"),
    platform: PlatformName = Query(default="web"),
    mobile_redirect: str | None = Query(
        default=None,
        description=(
            "A deep-link URL the callback should bounce tokens to (in the URL "
            "fragment) instead of going through the web finish page. Must start "
            "with one of the app's registered schemes — see "
            "_ALLOWED_MOBILE_REDIRECT_SCHEMES. Used by the mobile app via "
            "expo-web-browser's openAuthSessionAsync."
        ),
    ),
) -> RedirectResponse:
    if platform == "devjson" and settings.env != "dev":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="devjson platform is only available when ENV=dev",
        )
    if mobile_redirect:
        if not mobile_redirect.startswith(_ALLOWED_MOBILE_REDIRECT_SCHEMES):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="mobile_redirect URL must use a registered app scheme",
            )
        # http://localhost is dev-only. exp:// schemes are allowed in all
        # environments since Expo dev builds legitimately generate them.
        if mobile_redirect.startswith("http://localhost") and settings.env != "dev":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="this mobile_redirect scheme is only available when ENV=dev",
            )

    try:
        url = oauth_service.start_oauth(
            AuthProvider(provider), return_to, platform, mobile_redirect=mobile_redirect
        )
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
        (
            user,
            access,
            refresh,
            return_to,
            platform,
            mobile_redirect,
        ) = await oauth_service.complete_oauth(db, AuthProvider(provider), code, state)
    except StateError as exc:
        return _bounce_failure(f"invalid state: {exc}")
    except TokenExchangeFailed as exc:
        return _bounce_failure(f"token exchange failed: {exc}")
    except UserinfoFailed as exc:
        return _bounce_failure(f"failed to load profile: {exc}")
    except OrcidIdAlreadyLinked:
        return _bounce_orcid_already_linked()
    except ProviderNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    # Dev-only: bounce tokens to a mobile deep link the app can intercept
    if mobile_redirect:
        fragment = urlencode(
            {"access_token": access, "refresh_token": refresh, "return_to": return_to}
        )
        sep = "&" if "#" in mobile_redirect else "#"
        return RedirectResponse(url=f"{mobile_redirect}{sep}{fragment}", status_code=302)

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


def _bounce_orcid_already_linked() -> RedirectResponse:
    """The ORCID iD on the OAuth subject is already linked to another user.
    Send the user to the sign-in page with a query-string error code so the
    web app can surface a useful message instead of dropping them on the
    silent /auth/finish bounce page."""
    base = settings.public_base_url.rstrip("/")
    return RedirectResponse(url=f"{base}/sign-in?error=orcid_already_linked", status_code=302)
