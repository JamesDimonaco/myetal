"""Tests for Stage 3 of the admin dashboard: /admin/shares/*.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 3.

Coverage targets:
* auth gating (401 / 403 / 200 paths)
* list endpoint — search, filter chip, type/age filter, paginate
* detail endpoint — items + reports + audit + similar snapshot + 90d views
* every write endpoint:
    - tombstone (with REQUIRED reason)
    - restore
    - unpublish
    - rebuild-similar
* audit-log integrity — each write produces exactly one row
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.core.config import settings
from myetal_api.models import (
    AdminAudit,
    Paper,
    Share,
    SharePaper,
    ShareReport,
    ShareReportReason,
    ShareSimilar,
    ShareView,
    TrendingShare,
    User,
)
from myetal_api.schemas.share import ShareCreate, ShareItemCreate
from myetal_api.services import share as share_service
from myetal_api.services import tags as tags_service
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


async def _share_owned_by(
    db: AsyncSession,
    owner: User,
    *,
    name: str = "x",
    publish: bool = False,
    item_doi: str | None = None,
) -> Share:
    items: list[ShareItemCreate] = []
    if item_doi is not None:
        items.append(
            ShareItemCreate(
                kind="paper",
                title="A paper",
                doi=item_doi,
            )
        )
    share = await share_service.create_share(
        db, owner.id, ShareCreate(name=name, items=items)
    )
    if publish:
        await share_service.publish_share(db, share)
    return share


# ---- Auth gating -----------------------------------------------------------


async def test_shares_list_requires_auth(api_client: TestClient) -> None:
    r = api_client.get("/admin/shares")
    assert r.status_code == 401


async def test_shares_list_rejects_non_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    rando = await make_user(db_session, email="rando@example.com")
    r = api_client.get(
        "/admin/shares",
        headers={"Authorization": f"Bearer {signed_jwt(rando.id, email=rando.email or '')}"},
    )
    assert r.status_code == 403


async def test_shares_detail_requires_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    rando = await make_user(db_session, email="rando@example.com")
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner)
    r = api_client.get(
        f"/admin/shares/{share.id}",
        headers={"Authorization": f"Bearer {signed_jwt(rando.id, email=rando.email or '')}"},
    )
    assert r.status_code == 403


async def test_each_write_endpoint_requires_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    """Every Stage-3 write endpoint must 403 a non-admin caller."""
    rando = await make_user(db_session, email="rando@example.com")
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)
    headers = {
        "Authorization": f"Bearer {signed_jwt(rando.id, email=rando.email or '')}"
    }
    for path, body in (
        (f"/admin/shares/{share.id}/tombstone", {"reason": "abc"}),
        (f"/admin/shares/{share.id}/restore", None),
        (f"/admin/shares/{share.id}/unpublish", None),
        (f"/admin/shares/{share.id}/rebuild-similar", None),
    ):
        r = api_client.post(path, json=body, headers=headers)
        assert r.status_code == 403, path


# ---- List endpoint ---------------------------------------------------------


async def test_shares_list_returns_paginated(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    for i in range(3):
        await _share_owned_by(db_session, owner, name=f"share {i}")

    r = api_client.get("/admin/shares", headers=_admin_headers(admin))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    # Owner info is denormalised on the row.
    assert body["items"][0]["owner_email"] == "owner@example.com"


async def test_shares_list_search_by_short_code(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    target = await _share_owned_by(db_session, owner, name="findme")
    await _share_owned_by(db_session, owner, name="other")

    r = api_client.get(
        f"/admin/shares?q={target.short_code}",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["short_code"] == target.short_code


async def test_shares_list_search_by_name_prefix(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    await _share_owned_by(db_session, owner, name="virology review 2026")
    await _share_owned_by(db_session, owner, name="bacterial something")

    r = api_client.get(
        "/admin/shares?q=virology",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["name"].startswith("virology")


async def test_shares_list_search_by_owner_email_prefix(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    alice = await make_user(db_session, email="alice@example.com")
    bob = await make_user(db_session, email="bob@example.com")
    await _share_owned_by(db_session, alice, name="alice's share")
    await _share_owned_by(db_session, bob, name="bob's share")

    r = api_client.get(
        "/admin/shares?q=alic",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["owner_email"] == "alice@example.com"


async def test_shares_list_search_by_paper_doi(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    await _share_owned_by(
        db_session, owner, name="with doi", item_doi="10.1234/abc.xyz"
    )
    await _share_owned_by(db_session, owner, name="no doi")

    r = api_client.get(
        "/admin/shares?q=10.1234",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert len(body["items"]) == 1


async def test_shares_list_search_by_tag_slug(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    tagged = await _share_owned_by(db_session, owner, name="tagged share")
    await tags_service.set_share_tags(db_session, tagged.id, ["virology"])
    await _share_owned_by(db_session, owner, name="untagged share")

    r = api_client.get(
        "/admin/shares?q=virology",
        headers=_admin_headers(admin),
    )
    body = r.json()
    assert any(item["id"] == str(tagged.id) for item in body["items"])


async def test_shares_list_filter_published(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    pub = await _share_owned_by(db_session, owner, name="pub", publish=True)
    draft = await _share_owned_by(db_session, owner, name="draft")

    r = api_client.get(
        "/admin/shares?filter=published",
        headers=_admin_headers(admin),
    )
    body = r.json()
    ids = {item["id"] for item in body["items"]}
    assert str(pub.id) in ids
    assert str(draft.id) not in ids


async def test_shares_list_filter_tombstoned(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    pub = await _share_owned_by(db_session, owner, name="pub", publish=True)
    tombed = await _share_owned_by(db_session, owner, name="tombed", publish=True)
    tombed.deleted_at = datetime.now(UTC)
    await db_session.commit()

    r = api_client.get(
        "/admin/shares?filter=tombstoned",
        headers=_admin_headers(admin),
    )
    body = r.json()
    ids = {item["id"] for item in body["items"]}
    assert str(tombed.id) in ids
    assert str(pub.id) not in ids


# ---- Detail endpoint -------------------------------------------------------


async def test_shares_detail_404_when_missing(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.get(
        f"/admin/shares/{uuid.uuid4()}", headers=_admin_headers(admin)
    )
    assert r.status_code == 404


async def test_shares_detail_includes_items_reports_audit(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(
        db_session, owner, name="x", publish=True, item_doi="10.1/abc"
    )

    # Add a report against the share.
    db_session.add(
        ShareReport(
            share_id=share.id,
            reason=ShareReportReason.COPYRIGHT,
            details="dmca!",
        )
    )
    await db_session.commit()

    r = api_client.get(
        f"/admin/shares/{share.id}", headers=_admin_headers(admin)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["short_code"] == share.short_code
    assert body["owner_email"] == "owner@example.com"
    assert len(body["items"]) == 1
    assert body["items"][0]["doi"] == "10.1/abc"
    assert len(body["reports"]) == 1
    assert body["reports"][0]["reason"] == "copyright"
    # 90d view buckets are zero-padded.
    assert len(body["daily_views_90d"]) == 90


# ---- Tombstone -------------------------------------------------------------


async def test_tombstone_sets_deleted_at_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)

    r = api_client.post(
        f"/admin/shares/{share.id}/tombstone",
        json={"reason": "copyright takedown — DMCA 2026-05-11"},
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200
    await db_session.refresh(share)
    assert share.deleted_at is not None

    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert len(audit) == 1
    assert audit[0].action == "tombstone_share"
    assert audit[0].details["reason"].startswith("copyright takedown")


async def test_tombstone_requires_reason(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)

    # Missing reason — 422.
    r = api_client.post(
        f"/admin/shares/{share.id}/tombstone",
        json={},
        headers=_admin_headers(admin),
    )
    assert r.status_code == 422

    # Reason too short — 422.
    r = api_client.post(
        f"/admin/shares/{share.id}/tombstone",
        json={"reason": "x"},
        headers=_admin_headers(admin),
    )
    assert r.status_code == 422


async def test_tombstone_rejects_already_tombstoned(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)
    share.deleted_at = datetime.now(UTC)
    await db_session.commit()

    r = api_client.post(
        f"/admin/shares/{share.id}/tombstone",
        json={"reason": "a valid reason here"},
        headers=_admin_headers(admin),
    )
    assert r.status_code == 409


# ---- Restore ---------------------------------------------------------------


async def test_restore_unsets_deleted_at_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)
    share.deleted_at = datetime.now(UTC)
    await db_session.commit()

    r = api_client.post(
        f"/admin/shares/{share.id}/restore",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200
    await db_session.refresh(share)
    assert share.deleted_at is None
    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "restore_share" for a in audit)


async def test_restore_rejects_when_not_tombstoned(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)

    r = api_client.post(
        f"/admin/shares/{share.id}/restore",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 409


# ---- Unpublish -------------------------------------------------------------


async def test_unpublish_clears_published_at_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)
    assert share.published_at is not None

    r = api_client.post(
        f"/admin/shares/{share.id}/unpublish",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200
    await db_session.refresh(share)
    assert share.published_at is None
    # Tombstone NOT set — unpublish is distinct from delete.
    assert share.deleted_at is None
    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "unpublish_share" for a in audit)


async def test_unpublish_rejects_draft(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner)  # not published
    r = api_client.post(
        f"/admin/shares/{share.id}/unpublish",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 409


# ---- Rebuild similar -------------------------------------------------------


async def test_rebuild_similar_inserts_pairs_and_audits(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")

    # Create two shares with a paper in common.
    s1 = await _share_owned_by(db_session, owner, name="s1", publish=True)
    s2 = await _share_owned_by(db_session, owner, name="s2", publish=True)
    paper = Paper(doi="10.99/sim", title="P", source="manual")
    db_session.add(paper)
    await db_session.commit()
    await db_session.refresh(paper)
    db_session.add(SharePaper(share_id=s1.id, paper_id=paper.id, position=0))
    db_session.add(SharePaper(share_id=s2.id, paper_id=paper.id, position=0))
    await db_session.commit()

    r = api_client.post(
        f"/admin/shares/{s1.id}/rebuild-similar",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200

    # A canonical-ordered pair should now exist.
    pairs = (await db_session.scalars(select(ShareSimilar))).all()
    assert len(pairs) == 1
    audit = (await db_session.scalars(select(AdminAudit))).all()
    assert any(a.action == "rebuild_similar_for_share" for a in audit)


async def test_rebuild_trending_creates_row_when_views_present(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)

    # Add a view inside the 14-day window.
    db_session.add(
        ShareView(
            share_id=share.id,
            viewed_at=datetime.now(UTC) - timedelta(hours=1),
        )
    )
    await db_session.commit()

    r = api_client.post(
        f"/admin/shares/{share.id}/rebuild-similar",
        headers=_admin_headers(admin),
    )
    assert r.status_code == 200

    trending = await db_session.get(TrendingShare, share.id)
    assert trending is not None
    assert trending.score > 0


# ---- Audit integrity (every write produces exactly one row) ---------------


async def test_audit_integrity_one_row_per_write(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    owner = await make_user(db_session, email="owner@example.com")
    share = await _share_owned_by(db_session, owner, publish=True)

    # Tombstone
    api_client.post(
        f"/admin/shares/{share.id}/tombstone",
        json={"reason": "test reason length"},
        headers=_admin_headers(admin),
    )
    # Restore
    api_client.post(
        f"/admin/shares/{share.id}/restore",
        headers=_admin_headers(admin),
    )
    # Unpublish
    api_client.post(
        f"/admin/shares/{share.id}/unpublish",
        headers=_admin_headers(admin),
    )
    # Rebuild
    api_client.post(
        f"/admin/shares/{share.id}/rebuild-similar",
        headers=_admin_headers(admin),
    )

    audit = (await db_session.scalars(select(AdminAudit))).all()
    actions = [a.action for a in audit]
    assert actions.count("tombstone_share") == 1
    assert actions.count("restore_share") == 1
    assert actions.count("unpublish_share") == 1
    assert actions.count("rebuild_similar_for_share") == 1
    # All audit rows reference the same share.
    assert all(a.target_share_id == share.id for a in audit)
