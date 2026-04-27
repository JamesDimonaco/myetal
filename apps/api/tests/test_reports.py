"""Tests for the take-down / abuse report submission endpoint.

Per discovery ticket D16. Anonymous and authenticated paths both work;
rate-limited per IP via slowapi (3/hour). Tombstoned and never-existed
shares both return 404 (no need to disambiguate for abuse reporters).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import ShareReport, ShareReportStatus
from myetal_api.schemas.share import ShareCreate
from myetal_api.services import auth as auth_service
from myetal_api.services import share as share_service


async def _make_user(db: AsyncSession, email: str = "researcher@example.com"):
    user, _, _ = await auth_service.register_with_password(db, email, "hunter22", "Researcher")
    return user


async def test_submit_report_anonymous(db_session: AsyncSession, api_client) -> None:
    """Anon report submission works; reporter_user_id is NULL on the row."""
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    r = api_client.post(
        f"/shares/{share.short_code}/report",
        json={"reason": "copyright", "details": "Hosted PDF infringes Smith 2024"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "open"

    rows = (await db_session.scalars(select(ShareReport))).all()
    assert len(rows) == 1
    assert rows[0].reporter_user_id is None
    assert rows[0].status == ShareReportStatus.OPEN
    assert rows[0].reason.value == "copyright"
    assert rows[0].details == "Hosted PDF infringes Smith 2024"


async def test_submit_report_authenticated(db_session: AsyncSession, api_client) -> None:
    """Auth'd report stores the reporter user id."""
    owner = await _make_user(db_session)
    share = await share_service.create_share(db_session, owner.id, ShareCreate(name="x"))

    reporter, access, _ = await auth_service.register_with_password(
        db_session, "reporter@example.com", "hunter22", "Reporter"
    )

    r = api_client.post(
        f"/shares/{share.short_code}/report",
        headers={"Authorization": f"Bearer {access}"},
        json={"reason": "spam"},
    )
    assert r.status_code == 201

    rows = (await db_session.scalars(select(ShareReport))).all()
    assert len(rows) == 1
    assert rows[0].reporter_user_id == reporter.id


async def test_submit_report_unknown_share_returns_404(api_client) -> None:
    r = api_client.post(
        "/shares/nonexistent/report",
        json={"reason": "spam"},
    )
    assert r.status_code == 404


async def test_submit_report_tombstoned_share_returns_404(
    db_session: AsyncSession, api_client
) -> None:
    """Tombstoned shares are functionally gone — no point reporting them."""
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))
    await share_service.tombstone_share(db_session, share)

    r = api_client.post(
        f"/shares/{share.short_code}/report",
        json={"reason": "abuse"},
    )
    assert r.status_code == 404


async def test_submit_report_invalid_reason_returns_422(
    db_session: AsyncSession, api_client
) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    r = api_client.post(
        f"/shares/{share.short_code}/report",
        json={"reason": "lol-not-a-real-reason"},
    )
    assert r.status_code == 422


async def test_submit_report_details_length_capped(db_session: AsyncSession, api_client) -> None:
    """details has a 2000-char cap to keep the admin queue readable."""
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    r = api_client.post(
        f"/shares/{share.short_code}/report",
        json={"reason": "other", "details": "a" * 2001},
    )
    assert r.status_code == 422
