"""Join row binding a paper to a share. Composite PK (share_id, paper_id)
enforces "one paper appears at most once in any given share."

`added_by` is the user who attached this paper to this share. Nullable +
ON DELETE SET NULL so deleting the user preserves the share's contents
(needed for editor-role collaboration in a future ticket — even though the
collab phase is deferred, the field is here to make later work additive).

Position is part of a single per-share namespace shared with `share_items`
(non-paper kinds). Reads merge-sort across both tables by `position` (W-BL2).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.paper import Paper
    from myetal_api.models.share import Share
    from myetal_api.models.better_auth import User


class SharePaper(Base):
    __tablename__ = "share_papers"

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("papers.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    share: Mapped[Share] = relationship(back_populates="papers")
    paper: Mapped[Paper] = relationship(back_populates="share_links")
    adder: Mapped[User | None] = relationship()

    __table_args__ = (
        # Common read pattern: the papers in this share, ordered.
        Index("ix_share_papers_share_position", "share_id", "position"),
        # Reverse lookup for "who else shares this paper" (D8 in discovery ticket).
        Index("ix_share_papers_paper_id", "paper_id"),
    )
