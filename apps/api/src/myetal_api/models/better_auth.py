"""SQLAlchemy models for Better Auth's core schema.

These mirror the tables Better Auth's drizzle adapter (in ``apps/web``)
expects. Single source of truth for migrations is Alembic — the drizzle
schema in ``apps/web/src/lib/db-schema.ts`` is for Better Auth's runtime
introspection only and is kept in lockstep with these models by hand.

Naming convention:
* Python attributes are snake_case (Pythonic).
* DB columns are snake_case (configured via the ``schema:`` option on
  Better Auth's drizzle adapter and via the per-resource ``fields``
  mapping in ``apps/web/src/lib/auth.ts``).
* Better Auth's TS code keeps camelCase field names internally; the
  mapping is only at the DB boundary.

Tables:
* ``user`` — replaces the legacy ``users`` table. UUID PK preserved so
  every existing ``ForeignKey('users.id')`` keeps working post-cutover
  via the table-rename in Alembic 0016. We layer the MyEtAl domain
  columns (``is_admin``, ``avatar_url``, ``orcid_id``, ``last_orcid_sync_at``)
  on top of BA's core via Better Auth's ``additionalFields`` config.
* ``session``, ``account``, ``verification``, ``jwks`` — straight BA core.

The User model is the canonical user row; legacy ``models/user.py``
(a one-line shim) was removed in Phase 2. ``models/__init__.py``
re-exports ``User`` from here.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.share import Share


class User(Base):
    """Better Auth's user table, with MyEtAl ``additionalFields``.

    **Table name kept as ``users``** (plural) rather than Better Auth's
    default ``user``. Reasoning: every existing FK in the codebase
    (``shares.owner_user_id``, ``share_views.viewer_id``, …) references
    ``users.id``. Renaming the table would force a CASCADE rewrite of
    every FK constraint, which adds risk for zero benefit. Better Auth
    is told to use this table name via the ``modelName: 'users'``
    override on the user resource in ``apps/web/src/lib/auth.ts``.

    The MyEtAl domain columns (``is_admin``, ``avatar_url``,
    ``orcid_id``, ``last_orcid_sync_at``) sit alongside BA's core
    columns; BA's drizzle adapter sees them via the ``additionalFields``
    config and ignores them on its internal queries.
    """

    __tablename__ = "users"

    # Better Auth core columns ------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # NOTE: column-level ``unique=True`` is deliberately NOT set here —
    # the named unique constraint lives in the Alembic 0016 migration
    # (``uq_users_email``). Keeping it only there is the source of truth
    # and avoids an ad-hoc SQLAlchemy-emitted unique that drifts from
    # the migration-managed constraint name.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # New since cutover: BA tracks email-verification state.
    email_verified: Mapped[bool] = mapped_column(
        Boolean, server_default="false", default=False, nullable=False
    )
    # BA's core ``image`` column. We *also* keep ``avatar_url`` below as
    # an additionalField so the existing FastAPI selections / web /
    # mobile components keep working without a rename pass.
    image: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # MyEtAl additionalFields (preserved across cutover) ----------------------
    is_admin: Mapped[bool] = mapped_column(
        Boolean, server_default="false", default=False, nullable=False
    )
    avatar_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    orcid_id: Mapped[str | None] = mapped_column(String(19), nullable=True, unique=True)
    last_orcid_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Admin soft-delete (Stage 2 of `admin-analytics-dashboard.md`). NULL =
    # active. Flipping this excludes the user from search/list paths AND
    # tombstones every share they own in the same transaction. Reversible —
    # null it back to undo.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    # Relationships -----------------------------------------------------------
    # Federated identities + password rows live in Better Auth's
    # ``account`` table. We don't expose a SQLAlchemy back_populates for
    # it because nothing on the Python side reads them — sign-in is BA's
    # job, and FastAPI only sees the post-sign-in JWT. If a future
    # admin-side feature needs to read accounts, add an Account
    # relationship here at that point.
    shares: Mapped[list[Share]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )


class Session(Base):
    """Better Auth's ``session`` table.

    Replaces the legacy ``refresh_tokens`` table. Sessions are the
    long-lived state Better Auth holds; the short-lived JWT minted by
    the JWT plugin is what FastAPI verifies — it never reads this row
    directly.
    """

    __tablename__ = "session"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Account(Base):
    """Better Auth's ``account`` table — federated identities + password.

    Replaces the legacy ``auth_identities`` table. One row per provider
    identity (``providerId='google'`` etc.) plus one row per password
    user (``providerId='credential'`` with ``password`` set).
    """

    __tablename__ = "account"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    password: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Verification(Base):
    """Better Auth's ``verification`` table — email-verify / password-reset tokens."""

    __tablename__ = "verification"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    identifier: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Jwks(Base):
    """Better Auth's JWT-plugin ``jwks`` table — signing key material.

    Better Auth manages this row content (key generation, rotation,
    grace-period overlap). We only ensure the table shape exists.
    """

    __tablename__ = "jwks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    private_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
