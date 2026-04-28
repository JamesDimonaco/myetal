"""add partial index on shares.published_at DESC for browse endpoint

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-27 15:00:00.000000

The browse page queries "recently published" shares ordered by
published_at DESC with the standard public/published/non-deleted
filter.  This partial B-tree index makes that query an index-only
scan.  Per browse-popular-collections ticket.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX ix_shares_published_at_desc
        ON shares (published_at DESC)
        WHERE is_public = true
          AND published_at IS NOT NULL
          AND deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_shares_published_at_desc")
