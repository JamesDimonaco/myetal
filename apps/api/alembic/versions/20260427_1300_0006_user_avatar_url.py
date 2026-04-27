"""add avatar_url column to users table

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-27 13:00:00.000000

Stores the profile picture URL sourced from OAuth providers (GitHub
``avatar_url``, Google ``picture``).  Nullable — email/password users
and ORCID users will have NULL until they set one manually.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar_url", sa.String(2000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
