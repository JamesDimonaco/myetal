import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from myetal_api.models.share_paper import SharePaper
    from myetal_api.models.tag import Tag
    from myetal_api.models.user import User


class ShareType(enum.StrEnum):
    PAPER = "paper"
    COLLECTION = "collection"
    BUNDLE = "bundle"
    GRANT = "grant"
    PROJECT = "project"


class ItemKind(enum.StrEnum):
    PAPER = "paper"
    REPO = "repo"
    LINK = "link"


class Share(Base, TimestampMixin):
    __tablename__ = "shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    short_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[ShareType] = mapped_column(
        Enum(ShareType, name="share_type", values_callable=lambda e: [m.value for m in e]),
        default=ShareType.PAPER,
        server_default=ShareType.PAPER.value,
        nullable=False,
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Discovery opt-in: NULL = link-shareable only; non-null = appears in
    # discovery surfaces (sitemap, similar-shares, who-else-shares-this,
    # future trending). See discovery ticket D1.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # Tombstone for "soft" delete (D14). Set by DELETE /shares/{id};
    # excluded from public read paths; permanently dropped by a 30-day cron.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    owner: Mapped["User"] = relationship(back_populates="shares")
    items: Mapped[list["ShareItem"]] = relationship(
        back_populates="share",
        cascade="all, delete-orphan",
        order_by="ShareItem.position",
    )
    papers: Mapped[list["SharePaper"]] = relationship(
        back_populates="share",
        cascade="all, delete-orphan",
        order_by="SharePaper.position",
    )
    # Topical tags attached to this share (Q7-A join, Q10 cap of 5).
    # `selectin` so card-rendering paths get tags in one extra query
    # rather than N+1.
    tags: Mapped[list["Tag"]] = relationship(
        secondary="share_tags",
        lazy="selectin",
        order_by="Tag.label",
    )


class ShareItem(Base, TimestampMixin):
    __tablename__ = "share_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    kind: Mapped[ItemKind] = mapped_column(
        Enum(ItemKind, name="item_kind", values_callable=lambda e: [m.value for m in e]),
        default=ItemKind.PAPER,
        server_default=ItemKind.PAPER.value,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    scholar_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    authors: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    share: Mapped["Share"] = relationship(back_populates="items")
