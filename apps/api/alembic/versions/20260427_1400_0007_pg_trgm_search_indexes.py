"""enable pg_trgm extension and create trigram search indexes on shares

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-27 14:00:00.000000

Adds partial GiST indexes on shares.name and shares.description for
trigram similarity search.  Only published, public, non-deleted shares
are indexed, keeping the index small and fast.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("""
        CREATE INDEX ix_shares_name_trgm ON shares USING gist (name gist_trgm_ops)
        WHERE is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_shares_description_trgm ON shares USING gist (description gist_trgm_ops)
        WHERE is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_shares_description_trgm")
    op.execute("DROP INDEX IF EXISTS ix_shares_name_trgm")
    # Don't drop the extension — other things might use it
