"""add last_orcid_sync_at column to users

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-07 11:00:00.000000

Tracks when the user last successfully imported their works from ORCID.
NULL until the first sync completes.  The web/mobile clients use this
together with ``orcid_id`` to decide whether to auto-fire the import on
first library visit (``orcid_id IS NOT NULL AND last_orcid_sync_at IS
NULL``).  Resetting ``orcid_id`` to a different value clears this column
back to NULL so the auto-import fires again for the new iD.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN last_orcid_sync_at TIMESTAMPTZ NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_orcid_sync_at")
