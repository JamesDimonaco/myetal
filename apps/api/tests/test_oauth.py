from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.core.oauth import (
    STATE_ALGORITHM,
    StateError,
    decode_state,
    encode_state,
)
from myetal_api.core.security import decode_access_token
from myetal_api.models import AuthIdentity, AuthProvider, User
from myetal_api.services import oauth as oauth_service

# ---------- state ----------


def test_state_round_trip() -> None:
    token = encode_state(AuthProvider.ORCID, "/dashboard", "web")
    payload = decode_state(token, AuthProvider.ORCID)
    assert payload["return_to"] == "/dashboard"
    assert payload["platform"] == "web"
    assert payload["provider"] == "orcid"


def test_state_provider_mismatch_rejected() -> None:
    token = encode_state(AuthProvider.ORCID, "/x", "web")
    with pytest.raises(StateError):
        decode_state(token, AuthProvider.GOOGLE)


def test_state_tampered_signature_rejected() -> None:
    token = encode_state(AuthProvider.ORCID, "/x", "web")
    with pytest.raises(StateError):
        decode_state(token + "x", AuthProvider.ORCID)


def test_state_expiry_rejected() -> None:
    expired_payload = {
        "provider": "orcid",
        "return_to": "/x",
        "platform": "web",
        "nonce": "abc",
        "iat": int(datetime.now(UTC).timestamp()) - 600,
        "exp": int((datetime.now(UTC) - timedelta(seconds=10)).timestamp()),
    }
    expired = jwt.encode(
        expired_payload,
        settings.secret_key.get_secret_value(),
        algorithm=STATE_ALGORITHM,
    )
    with pytest.raises(StateError):
        decode_state(expired, AuthProvider.ORCID)


# ---------- start_oauth ----------


def test_start_oauth_builds_orcid_authorize_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Pin PUBLIC_API_URL so this test isn't affected by a developer's .env
    # override (e.g. LAN IP for testing OAuth from a real phone).
    monkeypatch.setattr(settings, "public_api_url", "http://localhost:8000")
    url = oauth_service.start_oauth(AuthProvider.ORCID, "/dashboard", "web")
    assert "sandbox.orcid.org/oauth/authorize" in url
    assert "client_id=test-orcid-client-id" in url
    assert "response_type=code" in url
    assert "scope=openid" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fauth%2Forcid%2Fcallback" in url
    assert "state=" in url


def test_start_oauth_builds_google_authorize_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "public_api_url", "http://localhost:8000")
    url = oauth_service.start_oauth(AuthProvider.GOOGLE, "/x", "mobile")
    assert "accounts.google.com" in url
    assert "client_id=test-google-client-id" in url
    assert "scope=openid+email+profile" in url


# ---------- complete_oauth ----------


def _mock_transport(token_status: int = 200, userinfo: dict | None = None) -> httpx.MockTransport:
    userinfo = userinfo or {
        "sub": "0000-0001-2345-6789",
        "name": "Dr Test",
        "email": "test@example.com",
        "email_verified": True,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if "token" in str(request.url):
            return httpx.Response(token_status, json={"access_token": "mock-access"})
        if "userinfo" in str(request.url):
            return httpx.Response(200, json=userinfo)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_complete_oauth_creates_user_and_identity(db_session: AsyncSession) -> None:
    state = encode_state(AuthProvider.ORCID, "/dashboard", "web")

    async with httpx.AsyncClient(transport=_mock_transport()) as client:
        user, access, refresh, return_to, platform, _ = await oauth_service.complete_oauth(
            db_session,
            AuthProvider.ORCID,
            code="real-looking-code",
            state=state,
            http_client=client,
        )

    assert user.email == "test@example.com"
    assert user.name == "Dr Test"
    assert decode_access_token(access) == user.id
    assert refresh
    assert return_to == "/dashboard"
    assert platform == "web"

    identity = await db_session.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == AuthProvider.ORCID,
            AuthIdentity.subject_id == "0000-0001-2345-6789",
        )
    )
    assert identity is not None
    assert identity.user_id == user.id


async def test_complete_oauth_idempotent_for_same_subject(db_session: AsyncSession) -> None:
    """Signing in twice with the same ORCID iD must hit the same user — no dupes."""
    state1 = encode_state(AuthProvider.ORCID, "/", "web")
    state2 = encode_state(AuthProvider.ORCID, "/", "web")

    async with httpx.AsyncClient(transport=_mock_transport()) as client:
        user1, _, _, _, _, _ = await oauth_service.complete_oauth(
            db_session, AuthProvider.ORCID, "c1", state1, http_client=client
        )
        user2, _, _, _, _, _ = await oauth_service.complete_oauth(
            db_session, AuthProvider.ORCID, "c2", state2, http_client=client
        )

    assert user1.id == user2.id
    users = (await db_session.scalars(select(User))).all()
    assert len(users) == 1


async def test_complete_oauth_does_not_link_by_email(db_session: AsyncSession) -> None:
    """A new provider with the same email must NOT auto-link to an existing user.
    Auto-linking by email is a known account-takeover vector — we link only on
    explicit user action (not yet implemented)."""
    from myetal_api.services import auth as auth_service

    existing, _, _ = await auth_service.register_with_password(
        db_session, "test@example.com", "hunter22", "Existing User"
    )

    state = encode_state(AuthProvider.ORCID, "/", "web")
    async with httpx.AsyncClient(transport=_mock_transport()) as client:
        new_user, _, _, _, _, _ = await oauth_service.complete_oauth(
            db_session, AuthProvider.ORCID, "c", state, http_client=client
        )

    assert new_user.id != existing.id


async def test_complete_oauth_token_failure(db_session: AsyncSession) -> None:
    state = encode_state(AuthProvider.ORCID, "/", "web")
    async with httpx.AsyncClient(transport=_mock_transport(token_status=400)) as client:
        with pytest.raises(oauth_service.TokenExchangeFailed):
            await oauth_service.complete_oauth(
                db_session, AuthProvider.ORCID, "c", state, http_client=client
            )


async def test_complete_oauth_with_wrong_provider_state(db_session: AsyncSession) -> None:
    state = encode_state(AuthProvider.GOOGLE, "/", "web")
    async with httpx.AsyncClient(transport=_mock_transport()) as client:
        with pytest.raises(StateError):
            await oauth_service.complete_oauth(
                db_session, AuthProvider.ORCID, "c", state, http_client=client
            )


async def test_complete_oauth_orcid_with_only_sub(db_session: AsyncSession) -> None:
    """ORCID OIDC may return only `sub` if the user denied email scope.
    User should still be created, with name and email null."""
    state = encode_state(AuthProvider.ORCID, "/", "web")
    minimal_userinfo = {"sub": "0000-0002-1111-2222"}

    async with httpx.AsyncClient(transport=_mock_transport(userinfo=minimal_userinfo)) as client:
        user, _, _, _, _, _ = await oauth_service.complete_oauth(
            db_session, AuthProvider.ORCID, "c", state, http_client=client
        )

    assert user.email is None
    assert user.name is None
