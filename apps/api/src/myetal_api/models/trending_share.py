"""Per-share trending score, populated nightly by a separate cron.

Per `docs/tickets/public-discovery-and-collaboration.md` D2 + D6.

In option 2 the table is **created and populated** by the cron, but no UI
reads from it yet. It exists so that when the trending homepage UI ships
(follow-up ticket), there's history to render rather than a cold start.

The score is a time-decayed sum of view events:

    score = SUM(EXP(-Δt_seconds / 259200.0))
            -- τ = 259200s = 72h time constant (~50h half-life)

over the last 14 days of `share_views`, with `(s.is_public, s.published_at,
s.deleted_at)` filters applied. Cron uses INSERT ... ON CONFLICT DO UPDATE
so the table is idempotent under repeated runs.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.share import Share


class TrendingShare(Base):
    __tablename__ = "trending_shares"

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        primary_key=True,
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    view_count_7d: Mapped[int] = mapped_column(Integer, nullable=False)
    refreshed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    share: Mapped[Share] = relationship()

    __table_args__ = (
        # Read pattern: top N by score (the future trending UI).
        Index("ix_trending_shares_score", "score"),
    )
