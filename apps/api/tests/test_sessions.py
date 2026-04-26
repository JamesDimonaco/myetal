"""GET /auth/me/sessions and POST /auth/me/sessions/{id}/revoke."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import RefreshToken
from myetal_api.services import auth as auth_service


async def _register(api_client: TestClient, email: str) -> tuple[str, str]:
    """Register through the HTTP route and return (access, refresh)."""
    r = api_client.post(
        "/auth/register",
        json={"email": email, "password": "hunter22a"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["access_token"], body["refresh_token"]


async def test_list_sessions_omits_token_hash(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    access, _ = await _register(api_client, "alice@example.com")

    r = api_client.get("/auth/me/sessions", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    # Public fields only — never the hash.
    assert set(row.keys()) == {"id", "issued_at", "expires_at", "revoked"}
    assert row["revoked"] is False


async def test_revoke_own_session_returns_204_and_marks_revoked(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    access, _ = await _register(api_client, "bob@example.com")

    rows = api_client.get("/auth/me/sessions", headers={"Authorization": f"Bearer {access}"}).json()
    session_id = rows[0]["id"]

    r = api_client.post(
        f"/auth/me/sessions/{session_id}/revoke",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 204

    # Confirm in the DB.
    rt = await db_session.scalar(
        select(RefreshToken).where(RefreshToken.id == uuid.UUID(session_id))
    )
    assert rt is not None
    assert rt.revoked is True


async def test_revoke_unknown_session_returns_404(api_client: TestClient) -> None:
    access, _ = await _register(api_client, "carol@example.com")

    fake_id = uuid.uuid4()
    r = api_client.post(
        f"/auth/me/sessions/{fake_id}/revoke",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 404


async def test_revoke_other_users_session_returns_404(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """A user must not be able to revoke another user's session — and we
    deliberately return 404, not 403, so foreign session ids aren't enumerable."""
    # User A registers via HTTP, gets back tokens
    access_a, _ = await _register(api_client, "a@example.com")

    # User B registers directly via the service (different user, different session)
    user_b, _, _ = await auth_service.register_with_password(
        db_session, "b@example.com", "hunter22a", None
    )
    b_session = await db_session.scalar(
        select(RefreshToken).where(RefreshToken.user_id == user_b.id)
    )
    assert b_session is not None

    r = api_client.post(
        f"/auth/me/sessions/{b_session.id}/revoke",
        headers={"Authorization": f"Bearer {access_a}"},
    )
    assert r.status_code == 404

    # And B's session must NOT have been touched.
    await db_session.refresh(b_session)
    assert b_session.revoked is False
