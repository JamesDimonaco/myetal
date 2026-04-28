"""User-submitted feedback: feature requests and bug reports.

Per `docs/tickets/user-feedback-system.md`. Feedback is stored in the DB for
record-keeping and also pushed to Telegram for instant notification to James.

user_id is nullable — anonymous submissions are allowed. email is a separate
nullable column so anon users can optionally leave a reply-to address.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from myetal_api.models.base import Base


class FeedbackType(enum.StrEnum):
    FEATURE_REQUEST = "feature_request"
    BUG_REPORT = "bug_report"


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
