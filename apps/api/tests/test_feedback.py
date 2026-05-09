"""Tests for POST /feedback — user feedback submission.

Covers anonymous and authenticated paths, validation, and email opt-out
behaviour. Telegram notification is mocked out since it's best-effort.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models.feedback import Feedback
from tests.conftest import make_user, signed_jwt


async def _make_user(db: AsyncSession, email: str = "researcher@example.com"):
    """BA-JWT replacement for the legacy register_with_password helper."""
    user = await make_user(db, email=email, name="Researcher")
    return user, signed_jwt(user.id, email=user.email or "")


# ---------- anonymous submission ----------


@patch("myetal_api.api.routes.feedback.send_feedback_notification", new_callable=AsyncMock)
async def test_feedback_submit_anonymous(
    mock_telegram: AsyncMock,
    db_session: AsyncSession,
    api_client,
) -> None:
    """Submit without auth, email=null → 201."""
    r = api_client.post(
        "/feedback",
        json={
            "type": "feature_request",
            "title": "Add dark mode",
            "description": "Would love dark mode support.",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert "id" in body
    assert body["message"] == "feedback received"

    # Verify in DB
    rows = (await db_session.scalars(select(Feedback))).all()
    assert len(rows) == 1
    assert rows[0].user_id is None
    assert rows[0].title == "Add dark mode"
    assert rows[0].email is None


# ---------- authenticated submission ----------


@patch("myetal_api.api.routes.feedback.send_feedback_notification", new_callable=AsyncMock)
async def test_feedback_submit_authenticated(
    mock_telegram: AsyncMock,
    db_session: AsyncSession,
    api_client,
) -> None:
    """Submit with auth + email → 201, user_id stored."""
    user, access = await _make_user(db_session)

    r = api_client.post(
        "/feedback",
        headers={"Authorization": f"Bearer {access}"},
        json={
            "type": "bug_report",
            "title": "Login broken",
            "description": "Cannot log in on Safari.",
            "email": "researcher@example.com",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert "id" in body

    rows = (await db_session.scalars(select(Feedback))).all()
    assert len(rows) == 1
    assert rows[0].user_id == user.id
    assert rows[0].email == "researcher@example.com"


# ---------- validation ----------


@patch("myetal_api.api.routes.feedback.send_feedback_notification", new_callable=AsyncMock)
async def test_feedback_submit_requires_title(
    mock_telegram: AsyncMock,
    api_client,
) -> None:
    """Empty title → 422."""
    r = api_client.post(
        "/feedback",
        json={
            "type": "feature_request",
            "title": "",
            "description": "Some description here.",
        },
    )
    assert r.status_code == 422


@patch("myetal_api.api.routes.feedback.send_feedback_notification", new_callable=AsyncMock)
async def test_feedback_submit_requires_description(
    mock_telegram: AsyncMock,
    api_client,
) -> None:
    """Empty description → 422."""
    r = api_client.post(
        "/feedback",
        json={
            "type": "bug_report",
            "title": "Something is wrong",
            "description": "",
        },
    )
    assert r.status_code == 422


# ---------- email opt-out ----------


@patch("myetal_api.api.routes.feedback.send_feedback_notification", new_callable=AsyncMock)
async def test_feedback_email_null_when_opted_out(
    mock_telegram: AsyncMock,
    db_session: AsyncSession,
    api_client,
) -> None:
    """Submit with email=null → saved with null email in the DB."""
    r = api_client.post(
        "/feedback",
        json={
            "type": "feature_request",
            "title": "Better search",
            "description": "Full-text search would be great.",
            "email": None,
        },
    )
    assert r.status_code == 201

    rows = (await db_session.scalars(select(Feedback))).all()
    assert len(rows) == 1
    assert rows[0].email is None
