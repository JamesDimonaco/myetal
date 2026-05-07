"""Generic OAuth flow.

Two phases:
- `start_oauth(...)`: build the provider's authorize URL with our state JWT
- `complete_oauth(...)`: exchange code for token, fetch userinfo, find-or-create
  user + auth_identity row, issue our JWT pair

The HTTP client is injectable so tests can stub without hitting real providers.
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.core.oauth import (
    Platform,
    ProviderUserInfo,
    StateError,
    decode_state,
    encode_state,
)
from myetal_api.models import AuthIdentity, AuthProvider, User
from myetal_api.oauth_providers import credentials_for, get_provider
from myetal_api.services.auth import _issue_token_pair


class OAuthError(Exception):
    pass


class TokenExchangeFailed(OAuthError):
    pass


class UserinfoFailed(OAuthError):
    pass


class OrcidIdAlreadyLinked(OAuthError):
    """The ORCID iD coming back from OAuth is already linked (manually or
    via OAuth) to another user. Phase A doesn't auto-link accounts, so we
    surface this clearly instead of silently creating a stub user."""


def _callback_url(provider: AuthProvider) -> str:
    return f"{settings.public_api_url.rstrip('/')}/auth/{provider.value}/callback"


def start_oauth(
    provider: AuthProvider,
    return_to: str,
    platform: Platform,
    mobile_redirect: str | None = None,
) -> str:
    config = get_provider(provider)
    client_id, _ = credentials_for(provider)
    state = encode_state(provider, return_to, platform, mobile_redirect=mobile_redirect)

    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": " ".join(config.scopes),
        "redirect_uri": _callback_url(provider),
        "state": state,
    }
    return f"{config.authorize_url}?{urlencode(params)}"


async def complete_oauth(
    db: AsyncSession,
    provider: AuthProvider,
    code: str,
    state: str,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> tuple[User, str, str, str, Platform, str | None]:
    """Returns (user, access_token, raw_refresh_token, return_to, platform,
    mobile_redirect). The trailing `mobile_redirect` is set when the original
    /start was called with that param (dev-only) — the callback honours it
    by 302-bouncing to that URL with tokens in the fragment."""

    state_payload = decode_state(state, expected_provider=provider)

    config = get_provider(provider)
    client_id, client_secret = credentials_for(provider)

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=10.0)
    try:
        access_token = await _exchange_code(
            client, config.token_url, code, client_id, client_secret, _callback_url(provider)
        )
        userinfo = await _fetch_userinfo(client, config.userinfo_url, access_token)
    finally:
        if owns_client:
            await client.aclose()

    parsed = config.parse_userinfo(userinfo)
    user = await _find_or_create_user(db, provider, parsed)

    access, raw_refresh, _ = await _issue_token_pair(db, user.id, family_id=None)
    await db.commit()

    return (
        user,
        access,
        raw_refresh,
        state_payload["return_to"],
        state_payload["platform"],
        state_payload.get("mobile_redirect"),
    )


# ---------- internals ----------


async def _exchange_code(
    client: httpx.AsyncClient,
    token_url: str,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> str:
    response = await client.post(
        token_url,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Accept": "application/json"},
    )
    if response.status_code != 200:
        raise TokenExchangeFailed(f"{response.status_code}: {response.text[:200]}")
    body = response.json()
    token = body.get("access_token")
    if not token:
        raise TokenExchangeFailed(f"no access_token in response: {body}")
    return token


async def _fetch_userinfo(client: httpx.AsyncClient, userinfo_url: str, access_token: str) -> dict:
    response = await client.get(
        userinfo_url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
    )
    if response.status_code != 200:
        raise UserinfoFailed(f"{response.status_code}: {response.text[:200]}")
    return response.json()


async def _orcid_id_taken(
    db: AsyncSession, orcid_id: str, *, exclude_user_id: object = None
) -> bool:
    stmt = select(User.id).where(User.orcid_id == orcid_id)
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return (await db.scalar(stmt)) is not None


async def _find_or_create_user(
    db: AsyncSession,
    provider: AuthProvider,
    info: ProviderUserInfo,
) -> User:
    """Look up existing identity by (provider, subject_id). If not found, create
    a fresh User + AuthIdentity. Deliberately does NOT auto-link by email — that
    would let a malicious provider claim someone else's account by returning the
    matching email. Account linking is a future explicit user action.
    """
    identity = await db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.subject_id == info.subject,
        )
    )
    if identity is not None:
        user = await db.get(User, identity.user_id)
        if user is not None:
            # Update avatar on subsequent logins — it may have changed.
            if info.avatar_url:
                user.avatar_url = info.avatar_url
            # Backfill orcid_id for users who signed in with ORCID before
            # the column existed (or had it skipped due to a prior collision
            # that has since been resolved).
            if provider == AuthProvider.ORCID and user.orcid_id is None:
                if not await _orcid_id_taken(db, info.subject, exclude_user_id=user.id):
                    user.orcid_id = info.subject
            return user

    # New user. Set orcid_id from the OAuth subject when signing in with ORCID,
    # but if another user already claimed that iD (manually or via OAuth) we
    # raise loudly rather than silently creating a stub user with no library
    # wiring — account linking is deferred to Phase B.
    orcid_id: str | None = None
    if provider == AuthProvider.ORCID:
        if await _orcid_id_taken(db, info.subject):
            raise OrcidIdAlreadyLinked(info.subject)
        orcid_id = info.subject

    user = User(
        name=info.name,
        email=info.email.lower() if info.email else None,
        avatar_url=info.avatar_url,
        orcid_id=orcid_id,
    )
    db.add(user)
    await db.flush()

    db.add(
        AuthIdentity(
            user_id=user.id,
            provider=provider,
            subject_id=info.subject,
        )
    )
    await db.flush()
    return user


# Re-export StateError so callers can catch it without importing from core.oauth
__all__ = [
    "OAuthError",
    "OrcidIdAlreadyLinked",
    "StateError",
    "TokenExchangeFailed",
    "UserinfoFailed",
    "complete_oauth",
    "start_oauth",
]
