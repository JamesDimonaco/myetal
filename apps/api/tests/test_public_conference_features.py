"""Tests for the conference-core-simplification public endpoints.

Covers the A4 poster PDF, the anonymous "email me this collection"
endpoint (incl. the per-recipient / per-share rolling caps), the
researcher QR (`/public/u/{id}/qr.png`), and the schema additions
(`PublicShareResponse.owner_id`, `UserPublicOut.orcid_id`).
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import Share
from myetal_api.schemas.share import ShareCreate, ShareItemCreate
from myetal_api.services import email as email_service
from myetal_api.services import share as share_service
from tests.conftest import make_user


async def _make_share(db: AsyncSession, user, *, name: str = "x", publish: bool = True) -> Share:
    share = await share_service.create_share(
        db, user.id, ShareCreate(name=name, items=[ShareItemCreate(title="a")])
    )
    if publish:
        await share_service.publish_share(db, share)
    return share


@pytest.fixture(autouse=True)
def _reset_email_caps() -> None:
    email_service.reset_share_email_caps()
    yield
    email_service.reset_share_email_caps()


@pytest.fixture
def sent_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Capture send_share_link_email calls instead of hitting Resend."""
    calls: list[dict] = []

    async def _fake_send(*, to: str, share_name: str, short_code: str) -> None:
        calls.append({"to": to, "share_name": share_name, "short_code": short_code})

    monkeypatch.setattr(email_service, "send_share_link_email", _fake_send)
    return calls


# ---------------------------------------------------------------------------
# Poster PDF
# ---------------------------------------------------------------------------


async def test_poster_pdf_for_published_share(db_session: AsyncSession, api_client) -> None:
    user = await make_user(db_session, name="Alice Smith")
    share = await _make_share(db_session, user, name="My Conference Picks")

    r = api_client.get(f"/public/c/{share.short_code}/poster.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")
    assert r.headers["cache-control"] == "public, s-maxage=86400"
    assert f'{share.short_code}-poster.pdf"' in r.headers["content-disposition"]


async def test_poster_pdf_404_for_unpublished_draft(db_session: AsyncSession, api_client) -> None:
    user = await make_user(db_session)
    share = await _make_share(db_session, user, publish=False)

    r = api_client.get(f"/public/c/{share.short_code}/poster.pdf")
    assert r.status_code == 404


async def test_poster_pdf_404_for_nonexistent(api_client) -> None:
    r = api_client.get("/public/c/nope1234/poster.pdf")
    assert r.status_code == 404


async def test_poster_pdf_410_for_tombstoned(db_session: AsyncSession, api_client) -> None:
    user = await make_user(db_session)
    share = await _make_share(db_session, user)
    await share_service.tombstone_share(db_session, share)

    r = api_client.get(f"/public/c/{share.short_code}/poster.pdf")
    assert r.status_code == 410


async def test_poster_pdf_survives_non_latin_name(db_session: AsyncSession, api_client) -> None:
    """Built-in Type1 fonts are Latin-1 only — non-Latin titles degrade to
    replacement chars instead of raising (documented v1 limitation)."""
    user = await make_user(db_session, name="研究者")
    share = await _make_share(db_session, user, name="量子コンピューティング論文集 🚀")

    r = api_client.get(f"/public/c/{share.short_code}/poster.pdf")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# Email me this collection
# ---------------------------------------------------------------------------


async def test_email_share_link_sends(db_session: AsyncSession, api_client, sent_emails) -> None:
    user = await make_user(db_session)
    share = await _make_share(db_session, user, name="Poster Papers")

    r = api_client.post(
        f"/public/c/{share.short_code}/email",
        json={"email": "Visitor@Example.com"},
    )
    assert r.status_code == 204
    assert sent_emails == [
        {
            "to": "visitor@example.com",  # normalized
            "share_name": "Poster Papers",
            "short_code": share.short_code,
        }
    ]


async def test_email_share_link_404_and_410(db_session: AsyncSession, api_client, sent_emails):
    user = await make_user(db_session)
    draft = await _make_share(db_session, user, publish=False)
    gone = await _make_share(db_session, user)
    await share_service.tombstone_share(db_session, gone)

    body = {"email": "visitor@example.com"}
    assert api_client.post(f"/public/c/{draft.short_code}/email", json=body).status_code == 404
    assert api_client.post("/public/c/nope1234/email", json=body).status_code == 404
    assert api_client.post(f"/public/c/{gone.short_code}/email", json=body).status_code == 410
    assert sent_emails == []


async def test_email_share_link_rejects_invalid_email(
    db_session: AsyncSession, api_client, sent_emails
) -> None:
    user = await make_user(db_session)
    share = await _make_share(db_session, user)

    r = api_client.post(f"/public/c/{share.short_code}/email", json={"email": "not-an-email"})
    assert r.status_code == 422
    assert sent_emails == []


async def test_email_per_recipient_cap_is_silent(
    db_session: AsyncSession, api_client, sent_emails
) -> None:
    """4th send to the same recipient within 24h: still 204, but no send —
    the cap must not be observable from outside."""
    user = await make_user(db_session)
    shares = [await _make_share(db_session, user, name=f"s{i}") for i in range(4)]

    for share in shares:
        r = api_client.post(
            f"/public/c/{share.short_code}/email",
            json={"email": "same@example.com"},
        )
        assert r.status_code == 204

    assert len(sent_emails) == email_service.RECIPIENT_DAILY_CAP


async def test_email_per_share_cap_is_silent(
    db_session: AsyncSession, api_client, sent_emails, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(email_service, "SHARE_DAILY_CAP", 2)
    user = await make_user(db_session)
    share = await _make_share(db_session, user)

    for i in range(3):
        r = api_client.post(
            f"/public/c/{share.short_code}/email",
            json={"email": f"visitor{i}@example.com"},
        )
        assert r.status_code == 204

    assert len(sent_emails) == 2


def test_send_skips_without_api_key(caplog) -> None:
    """No RESEND_API_KEY configured (test default) → skip-and-log, no raise."""
    import asyncio

    with caplog.at_level("WARNING"):
        asyncio.run(
            email_service.send_share_link_email(
                to="v@example.com", share_name="n", short_code="abc"
            )
        )
    assert any("Resend not configured" in m for m in caplog.messages)


# ---------------------------------------------------------------------------
# Researcher QR
# ---------------------------------------------------------------------------


async def test_user_qr_png_for_existing_user(db_session: AsyncSession, api_client) -> None:
    """Resolves even with zero published shares — printed business cards
    must never dead-end (same posture as /public/browse?owner_id=)."""
    user = await make_user(db_session)

    r = api_client.get(f"/public/u/{user.id}/qr.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "public, max-age=86400"


async def test_user_qr_png_404_for_unknown_user(api_client) -> None:
    r = api_client.get(f"/public/u/{uuid.uuid4()}/qr.png")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Schema additions
# ---------------------------------------------------------------------------


async def test_public_share_exposes_owner_id(db_session: AsyncSession, api_client) -> None:
    user = await make_user(db_session)
    share = await _make_share(db_session, user)

    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 200
    assert r.json()["owner_id"] == str(user.id)


async def test_user_public_card_exposes_orcid_id(db_session: AsyncSession) -> None:
    """Service-level (the /public/browse route itself needs Postgres-only
    SQL the SQLite harness can't run — pre-existing limitation)."""
    user = await make_user(db_session, orcid_id="0000-0002-1825-0097")
    await _make_share(db_session, user)

    card = await share_service.get_user_public_card(db_session, user.id)
    assert card is not None
    assert card.orcid_id == "0000-0002-1825-0097"
