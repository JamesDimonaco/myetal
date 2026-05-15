"""User-submitted reports against published shares.

Per `docs/tickets/public-discovery-and-collaboration.md` D16 + D-S-Iss6.

Cheapest pre-launch design-it-now-don't-fight-it-at-midnight surface in
the discovery ticket. The second a publisher emails about a copyrighted
PDF, we want a row + a button + a tombstone instead of a 2 a.m. SQL session.

Reports go to the `open` queue. The dev (just James for now) reviews via
`/admin/reports`, picks `actioned` (the share got tombstoned, follow-up
done) or `dismissed` (false positive).

Uses TimestampMixin (D-S-Iss6) so created_at/updated_at match the rest of
the codebase rather than being hand-rolled.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from myetal_api.models.better_auth import User
    from myetal_api.models.share import Share


class ShareReportReason(enum.StrEnum):
    COPYRIGHT = "copyright"
    SPAM = "spam"
    ABUSE = "abuse"
    PII = "pii"
    OTHER = "other"


class ShareReportStatus(enum.StrEnum):
    OPEN = "open"
    ACTIONED = "actioned"
    DISMISSED = "dismissed"


class ShareReport(Base, TimestampMixin):
    __tablename__ = "share_reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
    )
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason: Mapped[ShareReportReason] = mapped_column(
        Enum(
            ShareReportReason,
            name="share_report_reason",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ShareReportStatus] = mapped_column(
        Enum(
            ShareReportStatus,
            name="share_report_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=ShareReportStatus.OPEN,
        server_default=ShareReportStatus.OPEN.value,
    )
    actioned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    actioned_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    share: Mapped[Share] = relationship()
    reporter: Mapped[User | None] = relationship(foreign_keys=[reporter_user_id])
    actioner: Mapped[User | None] = relationship(foreign_keys=[actioned_by])

    __table_args__ = (
        # Read pattern: admin queue — open reports newest first.
        Index("ix_share_reports_status_created", "status", "created_at"),
        # Read pattern: admin lookup — all reports for this share.
        Index("ix_share_reports_share_id", "share_id", "created_at"),
    )
