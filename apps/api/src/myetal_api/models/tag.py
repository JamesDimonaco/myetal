"""Tag and ShareTag models — topical labels attached to shares for
discovery filtering.

Per feedback-round-2 §2 (Q7-A: separate join table; Q8-A: lowercased +
trimmed canonicalisation only; Q9-C: hybrid curated + free-form;
Q10: max 5 tags per share).

`tags.slug` is the canonical lowercased form; `tags.label` is the
human-readable display label (title-case derived from the slug, but
free-form so seeded labels can include ad-hoc capitalisation like
"NLP" or "AI Ethics").

`tags.usage_count` is denormalised for fast top-N queries on the
home/discover tag-chip rows. Maintained by the tags service whenever
share-tag attachments change.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from myetal_api.models.base import Base


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class ShareTag(Base):
    __tablename__ = "share_tags"

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
