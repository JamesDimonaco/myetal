import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from myetal_api.models.auth_identity import AuthIdentity
    from myetal_api.models.share import Share


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    orcid_id: Mapped[str | None] = mapped_column(String(19), nullable=True, unique=True)
    # Stamped on the first/most-recent successful POST /me/works/sync-orcid.
    # NULL = never synced; clients use the (orcid_id, last_orcid_sync_at) pair
    # to decide whether to auto-fire the import on first library visit.
    last_orcid_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    auth_identities: Mapped[list["AuthIdentity"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    shares: Mapped[list["Share"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )
