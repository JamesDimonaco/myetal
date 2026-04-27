"""Best-effort Telegram notifications for user feedback.

Sends a formatted message to the configured Telegram chat whenever a user
submits feedback (feature request or bug report). If Telegram is not
configured or the request fails, the error is logged but never propagated
— the caller's request succeeds regardless.
"""

from __future__ import annotations

import logging
import uuid

import httpx

from myetal_api.core.config import settings
from myetal_api.models.feedback import FeedbackType

logger = logging.getLogger(__name__)


async def send_feedback_notification(
    *,
    feedback_id: uuid.UUID,
    feedback_type: str,
    title: str,
    description: str,
    user_name: str | None,
    user_email: str | None,
    reply_email: str | None,
) -> None:
    """Send a feedback notification to Telegram. Best-effort — never raises."""
    token = settings.telegram_bot_token
    chat_id = settings.telegram_chat_id

    if not token or not chat_id:
        logger.warning(
            "Telegram not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID empty); "
            "skipping feedback notification for %s",
            feedback_id,
        )
        return

    icon = "\U0001f4a1 Feature Request" if feedback_type == FeedbackType.FEATURE_REQUEST else "\U0001f41b Bug Report"

    if user_name and user_email:
        from_line = f"{user_name} ({user_email})"
    elif user_email:
        from_line = user_email
    else:
        from_line = "Anonymous"

    reply_line = reply_email if reply_email else "No email provided"

    text = (
        f"{icon}\n"
        f"\n"
        f"{title}\n"
        f"---\n"
        f"{description}\n"
        f"---\n"
        f"From: {from_line}\n"
        f"Reply-to: {reply_line}\n"
        f"ID: {feedback_id}"
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                url,
                json={"chat_id": chat_id, "text": text},
            )
            if response.status_code != 200:
                logger.error(
                    "Telegram sendMessage failed: status=%s body=%s",
                    response.status_code,
                    response.text[:500],
                )
    except Exception:
        logger.exception("Failed to send Telegram feedback notification for %s", feedback_id)
