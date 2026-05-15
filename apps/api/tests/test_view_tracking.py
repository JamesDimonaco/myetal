"""Tests for the view tracking write path.

Per discovery ticket D3 + D3.1 + D-S-Iss3 + D-S-Iss8 + D-S-Iss10. The
service is best-effort (never raises) and the dedup channels are mutually
exclusive (CHECK constraint). Tests cover all three channels + the skip
predicates (owner self-view, bot UA, dedup hit).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import Share, ShareView
from myetal_api.schemas.share import ShareCreate, ShareItemCreate
from myetal_api.services import share as share_service
from myetal_api.services import share_view_dedup
from tests.conftest import auth_headers, make_user, signed_jwt


async def _make_user(db: AsyncSession, email: str = "researcher@example.com"):
    return await make_user(db, email=email, name="Researcher")


async def _make_share(db: AsyncSession, user) -> Share:
    share = await share_service.create_share(
        db, user.id, ShareCreate(name="x", items=[ShareItemCreate(title="a")])
    )
    # K3 fix-up: ``/public/c/{short_code}`` now requires
    # ``published_at IS NOT NULL`` so a draft can't leak. View-tracking
    # tests target the published path; publish here so the existing
    # assertions still hold.
    await share_service.publish_share(db, share)
    return share


async def _count_views(db: AsyncSession, share_id) -> int:
    rows = await db.scalars(select(ShareView).where(ShareView.share_id == share_id))
    return len(list(rows.all()))


async def test_anon_view_records_a_share_view_row(db_session: AsyncSession, api_client) -> None:
    """Plain GET /public/c/{short_code} from anon writes a share_views row."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 200

    assert await _count_views(db_session, share.id) == 1


async def test_anon_view_dedup_within_24h(db_session: AsyncSession, api_client) -> None:
    """Second GET from the same anon viewer within 24h does NOT add a row."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    r1 = api_client.get(f"/public/c/{share.short_code}")
    assert r1.status_code == 200
    r2 = api_client.get(f"/public/c/{share.short_code}")
    assert r2.status_code == 200

    assert await _count_views(db_session, share.id) == 1


async def test_owner_self_view_excluded(db_session: AsyncSession, api_client) -> None:
    """Owner viewing own share does NOT record (D-S-Iss3)."""
    share_view_dedup._reset_for_tests()
    user = await make_user(db_session, email="owner@example.com", name="Owner")
    share = await _make_share(db_session, user)

    r = api_client.get(
        f"/public/c/{share.short_code}",
        headers=auth_headers(user),
    )
    assert r.status_code == 200

    assert await _count_views(db_session, share.id) == 0


async def test_bot_ua_excluded(db_session: AsyncSession, api_client) -> None:
    """Known bot UAs (Twitterbot etc.) do NOT record views (D-S-Iss8)."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    r = api_client.get(
        f"/public/c/{share.short_code}",
        headers={"User-Agent": "Twitterbot/1.0"},
    )
    assert r.status_code == 200

    assert await _count_views(db_session, share.id) == 0


async def test_view_token_dedup_across_requests(db_session: AsyncSession, api_client) -> None:
    """Mobile X-View-Token header dedups across requests (D3.1)."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    headers = {"X-View-Token": "device-token-abc-123"}
    r1 = api_client.get(f"/public/c/{share.short_code}", headers=headers)
    assert r1.status_code == 200
    r2 = api_client.get(f"/public/c/{share.short_code}", headers=headers)
    assert r2.status_code == 200

    # Second view dedup'd via SQL lookback on view_token.
    assert await _count_views(db_session, share.id) == 1


async def test_different_view_tokens_count_separately(db_session: AsyncSession, api_client) -> None:
    """Two distinct mobile installs each get counted."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    api_client.get(f"/public/c/{share.short_code}", headers={"X-View-Token": "install-A"})
    api_client.get(f"/public/c/{share.short_code}", headers={"X-View-Token": "install-B"})

    assert await _count_views(db_session, share.id) == 2


async def test_logged_in_view_uses_viewer_user_id_not_token(
    db_session: AsyncSession, api_client
) -> None:
    """A logged-in user's view stores viewer_user_id (and view_token NULL)
    even if X-View-Token is also present — auth wins."""
    share_view_dedup._reset_for_tests()
    owner = await _make_user(db_session)
    share = await _make_share(db_session, owner)

    viewer = await make_user(db_session, email="viewer@example.com", name="Viewer")
    viewer_access = signed_jwt(viewer.id, email=viewer.email or "")

    r = api_client.get(
        f"/public/c/{share.short_code}",
        headers={
            "Authorization": f"Bearer {viewer_access}",
            "X-View-Token": "device-token-should-be-ignored",
        },
    )
    assert r.status_code == 200

    rows = await db_session.scalars(select(ShareView).where(ShareView.share_id == share.id))
    items = list(rows.all())
    assert len(items) == 1
    assert items[0].viewer_user_id == viewer.id
    assert items[0].view_token is None


async def test_tombstoned_share_returns_410_no_view_recorded(
    db_session: AsyncSession, api_client
) -> None:
    """Per D-BL2: tombstoned share → 410 Gone, and no view row written."""
    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)
    await share_service.tombstone_share(db_session, share)

    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 410

    assert await _count_views(db_session, share.id) == 0


async def test_nonexistent_short_code_returns_404(api_client) -> None:
    r = api_client.get("/public/c/nonexistent")
    assert r.status_code == 404


async def test_record_view_swallows_db_error_and_does_not_raise(
    db_session: AsyncSession,
) -> None:
    """``record_view`` is documented as best-effort — it must NEVER raise
    even if the DB layer is poisoned. A view-tracking failure must not
    block the share response. There's no other negative test for this
    contract today, hence this guard rail.
    """
    from unittest.mock import AsyncMock, MagicMock

    from myetal_api.services import share_view as share_view_service

    share_view_dedup._reset_for_tests()
    user = await _make_user(db_session)
    share = await _make_share(db_session, user)

    # Build a request stand-in with the headers/client our path reads.
    request = MagicMock()
    request.headers = {"user-agent": "Mozilla/5.0"}
    request.client = MagicMock()
    request.client.host = "1.2.3.4"

    # Poison the session: every query path explodes. The contract is that
    # record_view catches it, logs, and returns None.
    poisoned = MagicMock()
    poisoned.scalar = AsyncMock(side_effect=RuntimeError("db is gone"))
    poisoned.add = MagicMock(side_effect=RuntimeError("db is gone"))
    poisoned.commit = AsyncMock(side_effect=RuntimeError("db is gone"))

    # Should not raise.
    await share_view_service.record_view(poisoned, share, request)
