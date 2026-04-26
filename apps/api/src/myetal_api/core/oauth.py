"""OAuth provider abstraction.

Each provider is a `ProviderConfig` value: where to send the user, where to
exchange the code, where to fetch profile info, and how to parse that profile
into a normalised `ProviderUserInfo`. State is encoded as a short-lived JWT
signed with our SECRET_KEY so the OAuth-redirect bounce can carry our
context (which provider, which platform, where to go after success) without
trusting the client.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt

from myetal_api.core.config import settings
from myetal_api.models import AuthProvider

Platform = Literal["web", "mobile", "devjson"]
STATE_TTL = timedelta(minutes=5)
STATE_ALGORITHM = "HS256"


@dataclass(frozen=True)
class ProviderUserInfo:
    """Normalised view of an OAuth user across providers."""

    subject: str
    name: str | None = None
    email: str | None = None
    email_verified: bool = False


@dataclass(frozen=True)
class ProviderConfig:
    name: AuthProvider
    authorize_url: str
    token_url: str
    userinfo_url: str
    scopes: list[str] = field(default_factory=list)
    parse_userinfo: Callable[[dict[str, Any]], ProviderUserInfo] = field(
        default=lambda _: ProviderUserInfo(subject="")
    )
    # token_endpoint_auth_basic: GitHub wants client creds in body; ORCID/Google want them
    # in the body too via standard OAuth2 client_secret_post.
    token_endpoint_auth_basic: bool = False


# ---------- state ----------


class StateError(Exception):
    """State token failed to decode, expired, or did not match the expected provider."""


def encode_state(
    provider: AuthProvider,
    return_to: str,
    platform: Platform,
    mobile_redirect: str | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, str | int] = {
        "provider": provider.value,
        "return_to": return_to,
        "platform": platform,
        "nonce": secrets.token_urlsafe(12),
        "iat": int(now.timestamp()),
        "exp": int((now + STATE_TTL).timestamp()),
    }
    if mobile_redirect:
        payload["mobile_redirect"] = mobile_redirect
    return jwt.encode(
        payload,
        settings.secret_key.get_secret_value(),
        algorithm=STATE_ALGORITHM,
    )


def decode_state(state: str, expected_provider: AuthProvider) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            state,
            settings.secret_key.get_secret_value(),
            algorithms=[STATE_ALGORITHM],
        )
    except jwt.PyJWTError as exc:
        raise StateError(f"invalid state: {exc}") from exc

    if payload.get("provider") != expected_provider.value:
        raise StateError("state provider mismatch")
    return payload
