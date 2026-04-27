"""Precomputed "similar shares" pairs, populated nightly.

Per `docs/tickets/public-discovery-and-collaboration.md` D9 + D-S-Iss1.

We store **canonical-ordered pairs only** (`share_id_a < share_id_b`) to
halve storage and cron work. The read query unions both directions:

    SELECT similar_share_id, papers_in_common FROM (
      SELECT share_id_b AS similar_share_id, papers_in_common
        FROM share_similar WHERE share_id_a = :id
      UNION ALL
      SELECT share_id_a AS similar_share_id, papers_in_common
        FROM share_similar WHERE share_id_b = :id
    ) ORDER BY papers_in_common DESC LIMIT 5;

The cron is truncate-then-rebuild — fine because reads are tolerant of a
brief empty window during the swap (the panel just shows nothing for the
fraction of a second that the cron runs). For a real concurrency story,
we'd build into a staging table and rename. Premature for v1.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from myetal_api.models.base import Base


class ShareSimilar(Base):
    __tablename__ = "share_similar"

    share_id_a: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
    )
    share_id_b: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
    )
    papers_in_common: Mapped[int] = mapped_column(Integer, nullable=False)
    refreshed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        PrimaryKeyConstraint("share_id_a", "share_id_b", name="pk_share_similar"),
        # Canonical ordering — enforced so the cron and the read query agree.
        CheckConstraint("share_id_a < share_id_b", name="chk_share_similar_canonical"),
        # Both indexes needed because the read unions both directions.
        Index("ix_share_similar_a_score", "share_id_a", "papers_in_common"),
        Index("ix_share_similar_b_score", "share_id_b", "papers_in_common"),
    )
