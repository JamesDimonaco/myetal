"""add orcid_id column to users

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-07 10:00:00.000000

Stores the user's ORCID iD (e.g. ``0000-0002-1825-0097``).  Auto-set when
they sign in with ORCID; manually set via PATCH /auth/me by users who
signed up via Google/GitHub but want to use ORCID-backed features (works
import).  NULL until claimed.  Postgres treats NULLs as distinct under
UNIQUE, so multiple unset rows coexist while any claimed iD must be
unique across the table.  Per orcid-integration-and-account-linking
ticket, Phase A step 2.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN orcid_id VARCHAR(19) NULL")
    op.execute("ALTER TABLE users ADD CONSTRAINT uq_users_orcid_id UNIQUE (orcid_id)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_orcid_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS orcid_id")
