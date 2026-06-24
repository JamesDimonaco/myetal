"""users.handle column for researcher-page identity polish

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-24 10:00:00.000000

Per `docs/tickets/conference-core-simplification` follow-up: a
human-readable identity slug surfaced at ``/u/{handle}``. Replaces the
UUID-only ``/u/{id}`` URL on shareable surfaces (business cards, slides)
without breaking the UUID URL — both routes keep resolving.

Format: ``^[a-z][a-z0-9_-]{2,29}$`` — start with a letter, lowercase
letters / digits / ``_`` / ``-`` only, length 3–30. The regex enforces
lowercase so a plain ``UNIQUE`` index is sufficient (no CITEXT, no
``LOWER(handle)`` functional index) — handles are stored exactly as the
user submits them, post-validation.

NULL-default: the column is safe to add to a populated table without a
backfill. Existing users land with ``handle IS NULL`` and keep using the
UUID route until they claim one.

Reserved handles are enforced at the application layer (see
``services/handles.py::RESERVED_HANDLES``) rather than via a CHECK
constraint — keeps the reserved list editable without a migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("handle", sa.String(length=30), nullable=True),
    )
    op.create_unique_constraint("uq_users_handle", "users", ["handle"])


def downgrade() -> None:
    op.drop_constraint("uq_users_handle", "users", type_="unique")
    op.drop_column("users", "handle")
