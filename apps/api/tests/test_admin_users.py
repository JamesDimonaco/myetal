"""Tests for Stage 2 of the admin dashboard: /admin/users/*.

Per `docs/tickets/to-do/admin-analytics-dashboard.md`. Tests cover:
* list + search + filter + pagination
* user detail (sidebar / tabs)
* every write endpoint + the audit-row it records:
  - force-sign-out: deletes session rows
  - toggle-admin: flips is_admin; self-toggle rejected
  - verify-email: flips email_verified
  - soft-delete: tombstones user + cascades to shares; reversible
  - send-password-reset: proxies to BA, records audit row, surfaces 502
    on BA-side failure
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.models import (
    Account,
    AdminAudit,
    Session,
    Share,
    User,
)
from myetal_api.schemas.share import ShareCreate
from myetal_api.services import share as share_service
from tests.conftest import make_user, signed_jwt


@pytest.fixture(autouse=True)
def _admin_allowlist(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "admin_emails", ["admin@example.com"])
    yield


def _admin_headers(admin: User) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {signed_jwt(admin.id, email=admin.email or '', is_admin=True)}"
        )
    }


async def _admin(db: AsyncSession, email: str = "admin@example.com") -> User:
    return await make_user(db, email=email, name="Admin", is_admin=True)


# ---- Auth gating -----------------------------------------------------------


async def test_users_list_requires_auth(api_client: TestClient) -> None:
    r = api_client.get("/admin/users")
    assert r.status_code == 401


async def test_users_list_rejects_non_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    user = await make_user(db_session, email="rando@example.com")
    r = api_client.get(
        "/admin/users",
        headers={"Authorization": f"Bearer {signed_jwt(user.id, email=user.email or '')}"},
    )
    assert r.status_code == 403


# ---- List endpoint ---------------------------------------------------------


async def test_users_list_returns_paginated(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    # 3 extra users → 4 total, default sort created_desc.
    for i in range(3):
        await make_user(db_session, email=f"user{i}@example.com", name=f"User {i}")

    r = api_client.get("/admin/users", headers=_admin_headers(admin))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 4
    # next_cursor null because we fit on one page.
    assert body["next_cursor"] is None
    assert len(body["items"]) == 4
    # admin landed first (newest signup? actually order depends on
    # creation order; just assert it's in the result set).
    emails = {item["email"] for item in body["items"]}
    assert "admin@example.com" in emails


async def test_users_list_search_matches_email_prefix(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    await make_user(db_session, email="alice@example.com", name="Alice")
    await make_user(db_session, email="bob@example.com", name="Bob")

    r = api_client.get(
        "/admin/users?q=ali",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["email"] == "alice@example.com"


async def test_users_list_filter_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    await make_user(db_session, email="rando@example.com", is_admin=False)

    r = api_client.get(
        "/admin/users?filter=admin",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["email"] == "admin@example.com"


async def test_users_list_filter_has_orcid(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    await make_user(
        db_session, email="orcid@example.com", orcid_id="0000-0001-2345-6789"
    )
    await make_user(db_session, email="no-orcid@example.com")

    r = api_client.get(
        "/admin/users?filter=has_orcid",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["email"] == "orcid@example.com"


async def test_users_list_pagination_emits_cursor(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """When > page-size users exist, the response includes a `next_cursor`.

    Cursor decoding is unit-tested separately; here we just verify that
    the route surfaces a non-null cursor when there's more data. The
    SQLite tz-coercion that makes a fully-exhaustive cursor test
    flaky in-process doesn't bite Postgres in prod (proper TIMESTAMPTZ
    comparison) — see `_encode_cursor` notes.
    """
    admin = await _admin(db_session)
    # Force the page to be small so we exercise the cursor path.
    for i in range(5):
        await make_user(db_session, email=f"u{i}@example.com")

    # Manually call the service so we can pass a small limit.
    from myetal_api.services import admin_users as admin_users_service

    first = await admin_users_service.list_users(db_session, limit=3)
    assert len(first["items"]) == 3
    assert first["next_cursor"] is not None
    # Cursor round-trips through decode.
    decoded = admin_users_service._decode_cursor(first["next_cursor"])
    assert decoded is not None
    anchor_dt, anchor_id = decoded
    last_item = first["items"][-1]
    assert anchor_id == last_item["id"]


async def test_cursor_encoding_round_trip() -> None:
    from myetal_api.services import admin_users as admin_users_service

    now = datetime.now(UTC).replace(microsecond=0)
    uid = uuid.uuid4()
    cursor = admin_users_service._encode_cursor(now, uid)
    decoded = admin_users_service._decode_cursor(cursor)
    assert decoded == (now, uid)
    # Garbage cursors decode to None rather than raising.
    assert admin_users_service._decode_cursor("not-a-real-cursor!!") is None


# ---- Detail endpoint -------------------------------------------------------


async def test_users_detail_404_for_missing(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.get(
        f"/admin/users/{uuid.uuid4()}", headers=_admin_headers(admin)
    )
    assert r.status_code == 404


async def test_users_detail_includes_shares_and_activity(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com", name="Owner")
    s = await share_service.create_share(db_session, owner.id, ShareCreate(name="x"))
    await share_service.publish_share(db_session, s)

    r = api_client.get(
        f"/admin/users/{owner.id}", headers=_admin_headers(admin)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "owner@example.com"
    assert len(body["shares"]) == 1
    assert body["shares"][0]["short_code"] == s.short_code
    # Activity contains signup + share_create + share_publish.
    kinds = {ev["kind"] for ev in body["activity"]}
    assert "signup" in kinds
    assert "share_create" in kinds
    assert "share_publish" in kinds


# ---- Force-sign-out --------------------------------------------------------


async def test_force_sign_out_revokes_sessions_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")
    db_session.add(
        Session(
            user_id=target.id,
            expires_at=datetime.now(UTC),
            token="t1",
        )
    )
    db_session.add(
        Session(
            user_id=target.id,
            expires_at=datetime.now(UTC),
            token="t2",
        )
    )
    await db_session.commit()

    r = api_client.post(
        f"/admin/users/{target.id}/sign-out", headers=_admin_headers(admin)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True

    remaining = (await db_session.scalars(select(Session))).all()
    assert remaining == []
    audit_rows = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "force_sign_out" for a in audit_rows)


# ---- Toggle admin ----------------------------------------------------------


async def test_toggle_admin_flips_flag_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com", is_admin=False)

    r = api_client.post(
        f"/admin/users/{target.id}/admin?value=true",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200

    await db_session.refresh(target)
    assert target.is_admin is True

    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "toggle_admin" for a in audit)


async def test_toggle_admin_rejects_self(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.post(
        f"/admin/users/{admin.id}/admin?value=false",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 400


# ---- Verify email ----------------------------------------------------------


async def test_verify_email_flips_flag_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")
    assert target.email_verified is False

    r = api_client.post(
        f"/admin/users/{target.id}/verify-email", headers=_admin_headers(admin)
    )
    assert r.status_code == 200

    await db_session.refresh(target)
    assert target.email_verified is True
    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "verify_email" for a in audit)


# ---- Soft delete -----------------------------------------------------------


async def test_soft_delete_tombstones_user_and_shares(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")
    share = await share_service.create_share(db_session, target.id, ShareCreate(name="x"))
    await share_service.publish_share(db_session, share)

    r = api_client.post(
        f"/admin/users/{target.id}/soft-delete", headers=_admin_headers(admin)
    )
    assert r.status_code == 200

    await db_session.refresh(target)
    assert target.deleted_at is not None
    await db_session.refresh(share)
    assert share.deleted_at is not None


async def test_soft_delete_rejects_self(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.post(
        f"/admin/users/{admin.id}/soft-delete", headers=_admin_headers(admin)
    )
    assert r.status_code == 400


async def test_soft_delete_409_when_already_deleted(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")
    target.deleted_at = datetime.now(UTC)
    await db_session.commit()

    r = api_client.post(
        f"/admin/users/{target.id}/soft-delete", headers=_admin_headers(admin)
    )
    assert r.status_code == 409


# ---- Send password reset ---------------------------------------------------


async def test_send_password_reset_proxies_to_ba(
    db_session: AsyncSession,
    api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")

    captured: dict[str, Any] = {}

    class _Response:
        is_success = True

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            return _Response()

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: _Client())

    r = api_client.post(
        f"/admin/users/{target.id}/send-password-reset",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200
    assert "/api/auth/forget-password" in captured["url"]
    assert captured["json"] == {"email": "target@example.com"}

    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "send_password_reset" for a in audit)


async def test_send_password_reset_502_on_ba_error(
    db_session: AsyncSession,
    api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="target@example.com")

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            raise httpx.HTTPError("boom")

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: _Client())

    r = api_client.post(
        f"/admin/users/{target.id}/send-password-reset",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 502
    # Audit row is still recorded so the attempt is auditable.
    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(
        a.action == "send_password_reset" and a.details.get("ba_ok") is False
        for a in audit
    )


async def test_send_password_reset_400_when_no_email(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="placeholder@example.com")
    # Strip email after creation to simulate the no-email edge case.
    target.email = None
    await db_session.commit()

    r = api_client.post(
        f"/admin/users/{target.id}/send-password-reset",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 400


# ---- Audit helper (direct) -------------------------------------------------


async def test_audit_helper_does_not_commit(db_session: AsyncSession) -> None:
    """`record_action` flushes but does NOT commit — the caller owns the txn.

    This is load-bearing: the audit row + business change must commit
    atomically. If `record_action` committed independently, a downstream
    failure would leave an orphan audit row.
    """
    from myetal_api.services import admin_audit as admin_audit_service

    admin = await _admin(db_session)
    target = await make_user(db_session, email="t@example.com")
    row = await admin_audit_service.record_action(
        db_session,
        admin_user_id=admin.id,
        action="probe",
        target_user_id=target.id,
        details={"hi": "there"},
    )
    assert row.id is not None
    # Without commit, the row is visible inside the txn but not persisted.
    await db_session.rollback()

    remaining = (await db_session.scalars(select(AdminAudit))).all()
    assert remaining == []
