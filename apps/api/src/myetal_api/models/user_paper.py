"""A user's library entry for a paper. Composite PK (user_id, paper_id).

The library is the user's personal "I want this paper available when I
build a share" list. Distinct from `share_papers` (which records a
particular paper sitting in a particular share) because:

  - A user may want a paper in their library without putting it in any share.
  - Removing a paper from a share shouldn't necessarily remove it from
    the library (and vice versa).
  - Sync flows ORCID → library don't touch shares at all.

`hidden_at` is a soft-delete: the user can hide a paper from their library
view without losing the row, so future re-sync from ORCID doesn't keep
re-adding it. Sync upserts skip rows where hidden_at IS NOT NULL.
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.paper import Paper
    from myetal_api.models.better_auth import User


class UserPaperAddedVia(enum.StrEnum):
    """How a paper got into a user's library."""

    ORCID = "orcid"  # synced from ORCID /works
    MANUAL = "manual"  # user pasted a DOI
    SHARE = "share"  # auto-added when a paper was attached to one of their shares


class UserPaper(Base):
    __tablename__ = "user_papers"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("papers.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    added_via: Mapped[UserPaperAddedVia] = mapped_column(
        Enum(
            UserPaperAddedVia,
            name="user_paper_added_via",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        # Python-side default gives microsecond precision (vs server_default
        # `CURRENT_TIMESTAMP` which is second-precision on SQLite); this makes
        # back-to-back inserts strictly orderable by added_at, including in
        # tests against SQLite. server_default stays as a backstop for raw
        # SQL inserts (e.g. the works-library migration's data backfill).
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    user: Mapped[User] = relationship()
    paper: Mapped[Paper] = relationship(back_populates="library_entries")
