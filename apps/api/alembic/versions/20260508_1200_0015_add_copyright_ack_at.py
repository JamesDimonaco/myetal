"""add copyright_ack_at audit column on share_items

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-08 12:00:00.000000

PR-C fix-up (audit log): persist the wall-clock timestamp at which the
uploader acknowledged the copyright disclaimer (Q6 — "I have the right
to make this file public."). Required for takedown defensibility — if
a rights-holder issues a takedown notice we can show exactly when (and
by which authenticated user, via ``share.owner_user_id``) the upload
was attested.

Single nullable column on ``share_items``:

* ``copyright_ack_at TIMESTAMPTZ NULL`` — populated server-side by the
  ``record-pdf-upload`` route for every ``kind='pdf'`` row; NULL for
  paper / repo / link rows (which don't represent uploaded files).

Backfill is unnecessary: PR-C only just shipped and PDF uploads are
brand-new — there are no pre-existing rows to retroactively stamp.
The owner identity (sufficient for takedown) is already on
``shares.owner_user_id``; this column adds the ``when``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "share_items",
        sa.Column(
            "copyright_ack_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("share_items", "copyright_ack_at")
