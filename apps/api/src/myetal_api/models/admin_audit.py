"""Admin-action audit log — immutable record of "who did what when".

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2. Every
write action mounted under `/admin/*` records a row here in the same
transaction as the underlying business-side change. Read-only from the
admin UI; populated only by the `services/admin_audit.py::record_action`
helper.

Schema rationale:
* `admin_user_id` — the acting admin. NOT NULL because every write
  endpoint sits behind `require_admin`, so we always know who did it.
* `target_user_id` / `target_share_id` — both nullable because some
  actions target a user (force_sign_out, toggle_admin, soft_delete_user,
  verify_email, send_password_reset), some target a share (tombstone),
  and a few may target neither (future bulk operations).
* `action` — free-form short string. We don't constrain via PG enum
  because the action vocabulary will grow (Stage 3 adds share actions,
  Stage 4 adds operational actions) and an Alembic round-trip per new
  action label is wasteful.
* `details` — small free-form JSONB payload. Examples:
  - `{"to": true, "from": false}` for toggle_admin
  - `{"reason": "copyright takedown"}` for tombstone_share
  - `{"sessions_revoked": 3}` for force_sign_out

Retention: keep forever for v1 (ticket open Q4). Review when the table
hits ~100k rows; the read path is `WHERE target_user_id = ?` on the
detail page, which an index keeps cheap regardless of size.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.better_auth import User
    from myetal_api.models.share import Share


class AdminAudit(Base):
    """Immutable record of every admin write action.

    Rows are append-only. There is no UPDATE path; correcting a
    mis-recorded action would itself be a new row.
    """

    __tablename__ = "admin_audit"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_share_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # JSONB on Postgres, JSON on SQLite (tests). ``JSONB.with_variant``
    # gives us PG-native storage in prod while keeping SQLite tests
    # working without a separate type adapter.
    details: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    admin: Mapped[User] = relationship(foreign_keys=[admin_user_id])
    target_user: Mapped[User | None] = relationship(foreign_keys=[target_user_id])
    target_share: Mapped[Share | None] = relationship(foreign_keys=[target_share_id])

    __table_args__ = (
        # Read pattern on user detail page: "audit log for this user,
        # newest first." A composite index makes this an index-only scan.
        Index("ix_admin_audit_target_user_created", "target_user_id", "created_at"),
        # Read pattern on share detail page (Stage 3): same for shares.
        Index("ix_admin_audit_target_share_created", "target_share_id", "created_at"),
    )
