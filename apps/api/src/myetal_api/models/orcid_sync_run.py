"""Audit/status table for ORCID sync runs.

Per W-S3, ORCID sync is async — the sync endpoint returns 202 with a
sync-run id, the work happens in a background task, and the client polls
GET /me/works/sync-runs/{id} for status.

Statuses progress: pending → running → (completed | failed). `error` holds
the failure message when status=failed. The counts (added/updated/unchanged)
populate as the run progresses, so a polling client gets a live view.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.better_auth import User


class OrcidSyncStatus(enum.StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class OrcidSyncRun(Base):
    __tablename__ = "orcid_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[OrcidSyncStatus] = mapped_column(
        Enum(
            OrcidSyncStatus,
            name="orcid_sync_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=OrcidSyncStatus.PENDING,
        server_default=OrcidSyncStatus.PENDING.value,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    added: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    unchanged: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship()
