"""add 'pdf' to item_kind enum and PDF-upload columns on share_items

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-08 11:00:00.000000

Per feedback-round-2 §1 (PR-C): PDF upload as a Bundle item type. Two
additive changes:

1. Add ``'pdf'`` to the ``item_kind`` Postgres enum (created in 0001
   with values ``paper, repo, link``). Postgres 12+ allows
   ``ALTER TYPE ... ADD VALUE`` inside a transaction so long as the
   new value isn't *used* in the same transaction. We only declare it
   here — first usage happens at runtime via INSERTs — so the standard
   alembic transaction is fine.

2. Four nullable columns on ``share_items`` for PDF-only metadata:
   * ``file_url VARCHAR(2000)`` — R2 public URL of the stored PDF.
   * ``file_size_bytes INTEGER`` — actual byte size after upload (Q2
     enforces ≤ 25 MB at upload + record time).
   * ``file_mime VARCHAR(64)`` — server-validated MIME (always
     ``"application/pdf"`` in v1; column is wider so future kinds
     don't need a schema change).
   * ``thumbnail_url VARCHAR(2000)`` — R2 public URL of the
     first-page JPEG (Q5-B).

   All four are nullable so existing paper / repo / link rows keep
   working untouched.

``downgrade()`` is best-effort: Postgres can't drop an enum value
cleanly without rebuilding the type and rewriting every dependent
column. We drop the columns and leave the ``'pdf'`` enum value behind.
This is fine for forward-only ops — re-applying upgrade() is a no-op
thanks to the ``IF NOT EXISTS`` clauses.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add 'pdf' to the item_kind enum. Idempotent via IF NOT EXISTS so
    # repeat runs (or fresh DBs that get this migration alongside 0001)
    # don't blow up.
    op.execute("ALTER TYPE item_kind ADD VALUE IF NOT EXISTS 'pdf'")

    # PDF-only metadata on share_items. All nullable — populated only
    # for kind='pdf'. Other kinds leave them NULL.
    op.add_column(
        "share_items",
        sa.Column("file_url", sa.String(length=2000), nullable=True),
    )
    op.add_column(
        "share_items",
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "share_items",
        sa.Column("file_mime", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "share_items",
        sa.Column("thumbnail_url", sa.String(length=2000), nullable=True),
    )


def downgrade() -> None:
    # Drop the columns. The 'pdf' enum value stays behind — Postgres
    # has no clean DROP-VALUE primitive and rewriting the type would
    # require a full table rewrite of share_items. Acceptable since
    # 0014 is forward-only in practice.
    op.drop_column("share_items", "thumbnail_url")
    op.drop_column("share_items", "file_mime")
    op.drop_column("share_items", "file_size_bytes")
    op.drop_column("share_items", "file_url")
