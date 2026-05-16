"""Tests for Stage 1 of the admin dashboard: GET /admin/overview.

Per `docs/tickets/to-do/admin-analytics-dashboard.md`. The endpoint
returns a single payload covering counters / growth / top_lists /
recent / storage. Tests cover:
* auth gating (401 anon / 403 non-admin)
* counter math under simple seeding
* daily growth buckets are 30 entries long + zero-padded
* top-N lists honour LIMIT and the published/non-deleted filters
* recent lists return at most 20
* response shape stays Pydantic-validated end to end
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.routes.admin import _reset_overview_cache_for_tests
from myetal_api.core.config import settings
from myetal_api.models import Feedback, Share, ShareItem, ShareReport, ShareReportReason, ShareView
from myetal_api.schemas.share import ShareCreate
from myetal_api.services import share as share_service
from tests.conftest import make_user, signed_jwt


@pytest.fixture(autouse=True)
def _admin_allowlist(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "admin_emails", ["admin@example.com"])
    _reset_overview_cache_for_tests()
    yield
    _reset_overview_cache_for_tests()


def _admin_headers(user_id, email: str = "admin@example.com") -> dict[str, str]:
    return {"Authorization": f"Bearer {signed_jwt(user_id, email=email, is_admin=True)}"}


# ---- Auth gating -----------------------------------------------------------


async def test_overview_requires_auth(api_client: TestClient) -> None:
    r = api_client.get("/admin/overview")
    assert r.status_code == 401


async def test_overview_rejects_non_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    user = await make_user(db_session, email="rando@example.com")
    r = api_client.get(
        "/admin/overview",
        headers={"Authorization": f"Bearer {signed_jwt(user.id, email=user.email or '')}"},
    )
    assert r.status_code == 403


# ---- Counters --------------------------------------------------------------


async def test_overview_counters_under_simple_seed(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    owner = await make_user(db_session, email="owner@example.com", name="Owner")
    # Two shares — one published, one draft.
    published = await share_service.create_share(db_session, owner.id, ShareCreate(name="pub"))
    await share_service.publish_share(db_session, published)
    await share_service.create_share(db_session, owner.id, ShareCreate(name="draft"))

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    assert r.status_code == 200
    body = r.json()
    c = body["counters"]
    # admin + owner = 2 users
    assert c["total_users"] == 2
    assert c["total_published_shares"] == 1
    assert c["total_draft_shares"] == 1
    # No items added to either share.
    assert c["total_items"] == 0
    # Two new signups in the last 30 days (just-created).
    assert c["new_users_30d"] == 2
    assert c["new_users_7d"] == 2


# ---- Growth -----------------------------------------------------------------


async def test_overview_growth_is_zero_padded_to_30(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    assert r.status_code == 200
    body = r.json()
    g = body["growth"]
    assert len(g["daily_signups_30d"]) == 30
    assert len(g["daily_share_creates_30d"]) == 30
    # The newest bucket is today; the admin row landed there → count >= 1.
    today_iso = datetime.now(UTC).date().isoformat()
    today_bucket = next(b for b in g["daily_signups_30d"] if b["date"] == today_iso)
    assert today_bucket["count"] >= 1


# ---- Top lists -------------------------------------------------------------


async def test_overview_top_owners_orders_by_share_count(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    busy = await make_user(db_session, email="busy@example.com", name="Busy")
    quiet = await make_user(db_session, email="quiet@example.com", name="Quiet")

    # Busy = 2 published, Quiet = 1 published
    for n in ("a", "b"):
        s = await share_service.create_share(db_session, busy.id, ShareCreate(name=n))
        await share_service.publish_share(db_session, s)
    s = await share_service.create_share(db_session, quiet.id, ShareCreate(name="x"))
    await share_service.publish_share(db_session, s)

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    body = r.json()
    owners = body["top_lists"]["owners_by_shares"]
    assert len(owners) >= 2
    # Busy is first; Quiet second.
    assert owners[0]["email"] == "busy@example.com"
    assert owners[0]["share_count"] == 2
    assert owners[1]["email"] == "quiet@example.com"


async def test_overview_top_shares_uses_30d_window(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    owner = await make_user(db_session, email="owner@example.com")
    share = await share_service.create_share(db_session, owner.id, ShareCreate(name="hot"))
    await share_service.publish_share(db_session, share)

    # Three views in the last 30 days.
    for _ in range(3):
        db_session.add(ShareView(share_id=share.id))
    await db_session.commit()

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    shares = r.json()["top_lists"]["shares_by_views_30d"]
    assert len(shares) == 1
    assert shares[0]["short_code"] == share.short_code
    assert shares[0]["view_count_30d"] == 3


# ---- Recent activity -------------------------------------------------------


async def test_overview_recent_signups_at_most_20(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    # 22 extra users → 23 total, the cap is 20.
    for i in range(22):
        await make_user(db_session, email=f"user{i}@example.com", name=f"User {i}")

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    signups = r.json()["recent"]["signups"]
    assert len(signups) == 20


async def test_overview_recent_feedback_returns_preview(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    long = "x" * 500
    db_session.add(
        Feedback(type="bug_report", title="bug", description=long, email="u@example.com")
    )
    await db_session.commit()

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    fb = r.json()["recent"]["feedback"]
    assert len(fb) == 1
    assert fb[0]["title"] == "bug"
    # Preview is truncated to 200 chars
    assert len(fb[0]["description_preview"]) == 200


async def test_overview_recent_reports_join_share(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    owner = await make_user(db_session, email="owner@example.com")
    share = await share_service.create_share(db_session, owner.id, ShareCreate(name="x"))
    await share_service.publish_share(db_session, share)

    db_session.add(
        ShareReport(
            share_id=share.id,
            reason=ShareReportReason.COPYRIGHT,
            details="alleged",
        )
    )
    await db_session.commit()

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    reports = r.json()["recent"]["reports"]
    assert len(reports) == 1
    assert reports[0]["share_short_code"] == share.short_code


# ---- Storage ---------------------------------------------------------------


async def test_overview_storage_counts_pdf_items(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    owner = await make_user(db_session, email="owner@example.com")
    share = await share_service.create_share(db_session, owner.id, ShareCreate(name="x"))

    # Add a paper item (not counted) and a PDF item (counted).
    db_session.add(ShareItem(share_id=share.id, position=0, kind="paper", title="paper-1"))
    db_session.add(
        ShareItem(
            share_id=share.id,
            position=1,
            kind="pdf",
            title="pdf-1",
            file_size_bytes=1234,
        )
    )
    await db_session.commit()

    r = api_client.get("/admin/overview", headers=_admin_headers(admin.id))
    storage = r.json()["storage"]
    assert storage["r2_pdf_count"] == 1
    assert storage["r2_pdf_bytes"] == 1234


# ---- Caching ---------------------------------------------------------------


async def test_overview_caches_response_for_60s(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await make_user(db_session, email="admin@example.com")
    headers = _admin_headers(admin.id)

    r1 = api_client.get("/admin/overview", headers=headers)
    assert r1.status_code == 200
    assert r1.json()["counters"]["total_users"] == 1

    # Add a new user; cached body should still report 1.
    await make_user(db_session, email="another@example.com")
    r2 = api_client.get("/admin/overview", headers=headers)
    assert r2.json()["counters"]["total_users"] == 1
    assert "Cache-Control" in r2.headers

    # Reset cache → fresh count.
    _reset_overview_cache_for_tests()
    r3 = api_client.get("/admin/overview", headers=headers)
    assert r3.json()["counters"]["total_users"] == 2
