"""Tests for /admin/* — moderation queue.

Auth via the admin allowlist (settings.admin_emails). Tests cover:
- 403 for non-allowlisted users
- 401 for anon
- list filters by status
- action endpoint flips status, optionally tombstones the share
- 409 if report already actioned
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.models import (
    Share,
    ShareReport,
    ShareReportReason,
    ShareReportStatus,
)
from myetal_api.schemas.share import ShareCreate
from myetal_api.services import auth as auth_service
from myetal_api.services import share as share_service


@pytest.fixture(autouse=True)
def _admin_allowlist(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "admin_emails", ["admin@example.com"])
    yield


async def _make_user(db: AsyncSession, email: str) -> tuple:
    return await auth_service.register_with_password(db, email, "hunter22hunter22", email)


async def _seed_open_report(db: AsyncSession) -> tuple[Share, ShareReport]:
    """Create an owner + a published share + a report against it."""
    owner, _, _ = await _make_user(db, "owner@example.com")
    share = await share_service.create_share(db, owner.id, ShareCreate(name="x"))
    await share_service.publish_share(db, share)

    report = ShareReport(
        share_id=share.id,
        reason=ShareReportReason.COPYRIGHT,
        details="alleged",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    await db.refresh(share)
    return share, report


# ---------- auth gating ----------


async def test_admin_endpoints_require_auth(api_client: TestClient) -> None:
    r = api_client.get("/admin/reports")
    assert r.status_code == 401


async def test_admin_endpoints_require_allowlist(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """Authenticated but not on the allowlist → 403, not 401."""
    _, access, _ = await _make_user(db_session, "rando@example.com")
    r = api_client.get("/admin/reports", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 403


# ---------- GET /admin/reports ----------


async def test_list_reports_default_returns_open_only(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    await _seed_open_report(db_session)

    _, admin_access, _ = await _make_user(db_session, "admin@example.com")
    r = api_client.get("/admin/reports", headers={"Authorization": f"Bearer {admin_access}"})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["status"] == "open"
    assert body[0]["reason"] == "copyright"
    assert body[0]["share_name"] == "x"
    assert body[0]["share_short_code"]


async def test_list_reports_can_filter_by_status(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    share, report = await _seed_open_report(db_session)
    # Mark it dismissed.
    report.status = ShareReportStatus.DISMISSED
    await db_session.commit()

    _, admin_access, _ = await _make_user(db_session, "admin@example.com")
    headers = {"Authorization": f"Bearer {admin_access}"}

    open_r = api_client.get("/admin/reports?status=open", headers=headers)
    assert open_r.status_code == 200
    assert open_r.json() == []

    dismissed_r = api_client.get("/admin/reports?status=dismissed", headers=headers)
    assert dismissed_r.status_code == 200
    assert len(dismissed_r.json()) == 1


# ---------- POST /admin/reports/{id}/action ----------


async def test_action_dismiss_closes_report_no_tombstone(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    share, report = await _seed_open_report(db_session)
    admin, admin_access, _ = await _make_user(db_session, "admin@example.com")

    r = api_client.post(
        f"/admin/reports/{report.id}/action",
        headers={"Authorization": f"Bearer {admin_access}"},
        json={"decision": "dismissed", "tombstone_share": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "dismissed"
    assert body["actioned_by"] == str(admin.id)
    assert body["share_deleted_at"] is None  # share NOT tombstoned

    # Verify in DB
    refreshed_share = await db_session.scalar(select(Share).where(Share.id == share.id))
    assert refreshed_share is not None
    assert refreshed_share.deleted_at is None


async def test_action_with_tombstone_soft_deletes_share(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    share, report = await _seed_open_report(db_session)
    _, admin_access, _ = await _make_user(db_session, "admin@example.com")

    r = api_client.post(
        f"/admin/reports/{report.id}/action",
        headers={"Authorization": f"Bearer {admin_access}"},
        json={"decision": "actioned", "tombstone_share": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "actioned"
    assert body["share_deleted_at"] is not None

    refreshed_share = await db_session.scalar(select(Share).where(Share.id == share.id))
    assert refreshed_share is not None
    assert refreshed_share.deleted_at is not None


async def test_action_already_actioned_returns_409(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    _, report = await _seed_open_report(db_session)
    _, admin_access, _ = await _make_user(db_session, "admin@example.com")

    headers = {"Authorization": f"Bearer {admin_access}"}
    first = api_client.post(
        f"/admin/reports/{report.id}/action",
        headers=headers,
        json={"decision": "dismissed"},
    )
    assert first.status_code == 200

    again = api_client.post(
        f"/admin/reports/{report.id}/action",
        headers=headers,
        json={"decision": "dismissed"},
    )
    assert again.status_code == 409


async def test_action_invalid_decision_returns_422(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    _, report = await _seed_open_report(db_session)
    _, admin_access, _ = await _make_user(db_session, "admin@example.com")

    r = api_client.post(
        f"/admin/reports/{report.id}/action",
        headers={"Authorization": f"Bearer {admin_access}"},
        json={"decision": "wat"},
    )
    assert r.status_code == 422
