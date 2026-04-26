"""Concrete OAuth provider configs (ORCID, Google, GitHub).

Each provider returns its own profile shape; we parse into the normalised
`ProviderUserInfo`. URLs are picked at module load time from settings so the
ORCID sandbox/production switch lives in one place.
"""

from typing import Any

from ceteris_api.core.config import settings
from ceteris_api.core.oauth import ProviderConfig, ProviderUserInfo
from ceteris_api.models import AuthProvider


def _parse_orcid(payload: dict[str, Any]) -> ProviderUserInfo:
    return ProviderUserInfo(
        subject=payload["sub"],  # ORCID iD via OIDC userinfo
        name=payload.get("name") or _stitch_name(payload),
        email=payload.get("email"),
        email_verified=bool(payload.get("email_verified", False)),
    )


def _parse_google(payload: dict[str, Any]) -> ProviderUserInfo:
    return ProviderUserInfo(
        subject=payload["sub"],
        name=payload.get("name"),
        email=payload.get("email"),
        email_verified=bool(payload.get("email_verified", False)),
    )


def _parse_github(payload: dict[str, Any]) -> ProviderUserInfo:
    # GitHub returns `id` (int), `login` (handle), `name` (display, may be null),
    # `email` (may be null when set to private). Email-verification status is not
    # exposed by /user — would need /user/emails to determine.
    return ProviderUserInfo(
        subject=str(payload["id"]),
        name=payload.get("name") or payload.get("login"),
        email=payload.get("email"),
        email_verified=False,
    )


def _stitch_name(payload: dict[str, Any]) -> str | None:
    parts = [payload.get("given_name"), payload.get("family_name")]
    joined = " ".join(p for p in parts if p)
    return joined or None


def _orcid_base() -> str:
    return "https://sandbox.orcid.org" if settings.orcid_use_sandbox else "https://orcid.org"


PROVIDERS: dict[AuthProvider, ProviderConfig] = {
    AuthProvider.ORCID: ProviderConfig(
        name=AuthProvider.ORCID,
        authorize_url=f"{_orcid_base()}/oauth/authorize",
        token_url=f"{_orcid_base()}/oauth/token",
        userinfo_url=f"{_orcid_base()}/oauth/userinfo",
        scopes=["openid"],
        parse_userinfo=_parse_orcid,
    ),
    AuthProvider.GOOGLE: ProviderConfig(
        name=AuthProvider.GOOGLE,
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
        scopes=["openid", "email", "profile"],
        parse_userinfo=_parse_google,
    ),
    AuthProvider.GITHUB: ProviderConfig(
        name=AuthProvider.GITHUB,
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        userinfo_url="https://api.github.com/user",
        scopes=["read:user", "user:email"],
        parse_userinfo=_parse_github,
    ),
}


class ProviderNotConfigured(Exception):
    """Provider is in PROVIDERS but its client credentials are not set in env."""


def get_provider(name: AuthProvider) -> ProviderConfig:
    if name not in PROVIDERS:
        raise KeyError(f"unknown provider: {name}")
    return PROVIDERS[name]


def credentials_for(name: AuthProvider) -> tuple[str, str]:
    """Returns (client_id, client_secret). Raises if not configured in env."""
    if name == AuthProvider.ORCID:
        cid, secret = settings.orcid_client_id, settings.orcid_client_secret.get_secret_value()
    elif name == AuthProvider.GOOGLE:
        cid, secret = settings.google_client_id, settings.google_client_secret.get_secret_value()
    elif name == AuthProvider.GITHUB:
        cid, secret = settings.github_client_id, settings.github_client_secret.get_secret_value()
    else:
        raise KeyError(f"no credential mapping for {name}")
    if not cid or not secret:
        raise ProviderNotConfigured(
            f"{name.value} client_id/secret not set; check {name.value.upper()}_CLIENT_ID env var"
        )
    return cid, secret
