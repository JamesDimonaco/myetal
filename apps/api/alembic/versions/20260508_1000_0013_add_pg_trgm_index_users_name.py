"""add pg_trgm GIN index on users.name for user-search autocomplete

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-08 10:00:00.000000

Per feedback-round-2 §5 (PR-B): ``/public/search`` grows a ``users``
block returning up to 5 users matching the query. The match runs
``pg_trgm`` similarity over ``users.name`` so typos / partial names
hit. Without an index this is a sequential scan of every user; with
the GIN index it's a fast index-backed lookup.

The privacy default (only users with ≥1 published share) is enforced
at query time via an ``EXISTS`` subquery — that side is already
covered by the ``shares.owner_user_id`` index from the baseline.

pg_trgm was enabled in 0007 / 0012; we re-create defensively in case
this migration runs on a fresh database that skips ahead.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_users_name_trgm "
        "ON users USING gin (name gin_trgm_ops) "
        "WHERE name IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_users_name_trgm")
    # Don't drop the extension — other code (search, tags) uses it.
