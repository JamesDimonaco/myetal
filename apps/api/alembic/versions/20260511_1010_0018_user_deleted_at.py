"""users.deleted_at column for admin soft-delete

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-11 10:10:00.000000

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2.

Adds a nullable `users.deleted_at` column so admins can soft-delete an
abusive account without hard-removing rows (reversible via NULL flip).
The action also tombstones every share the user owns in the same
transaction (handled in `services/admin_users.py::soft_delete_user`).

NULL-default so the column is safe to add to a populated table without
a backfill — existing users remain active. Partial index limited to
soft-deleted rows so the "include deleted" admin filter is cheap
without bloating the index on the (much larger) live-user set.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Partial index — only soft-deleted rows. Postgres-specific syntax;
    # SQLite ignores the WHERE clause and creates a regular index.
    op.execute(
        "CREATE INDEX ix_users_deleted_at ON users (deleted_at) "
        "WHERE deleted_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_deleted_at")
    op.drop_column("users", "deleted_at")
