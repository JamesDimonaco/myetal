"""rename share_type enum value 'poster' to 'bundle'

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-07 12:00:00.000000

User feedback (B2): the term "poster" was confusing because users expected a
PDF upload feature. The decision is to rebrand the existing curated-links
share type to "bundle" — same semantics (a curated collection of links),
clearer name. PDF upload as a separate item type is deferred to a later
ticket.

The ``share_type`` Postgres enum (created in 0001) currently has values
``paper, collection, poster, grant, project``. We rename ``poster`` →
``bundle`` in place using ``ALTER TYPE ... RENAME VALUE``. This is safe
because:

* It updates every existing row referencing the value atomically.
* The server_default on shares.type is ``paper`` (not ``poster``), so no
  default needs touching.
* Postgres allows enum value renames inside a transaction.

There are no users in the wild yet, so we don't worry about wire-format
compatibility — the API will return ``bundle`` immediately after this runs
and the web/mobile consumers are being updated in parallel.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE share_type RENAME VALUE 'poster' TO 'bundle'")


def downgrade() -> None:
    op.execute("ALTER TYPE share_type RENAME VALUE 'bundle' TO 'poster'")
