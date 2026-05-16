"""admin_audit table

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-11 10:00:00.000000

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2.

Single new append-only table recording every admin write action mounted
under `/admin/*`. The row + the underlying business-side change land in
the same transaction so audit completeness is a transactional guarantee
rather than an after-the-fact pruning concern.

Indexes chosen for the two read patterns we have in v1:
* user-detail page: "every audit row targeting this user, newest first"
* share-detail page (Stage 3): same shape but keyed on share

`details` is JSONB on Postgres (queryable + small) and falls back to JSON
on SQLite for tests. The SQLAlchemy model uses ``JSONB.with_variant``
which Alembic translates correctly into the right CREATE TABLE on each
dialect.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_audit",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "admin_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "target_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "target_share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("details", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_admin_audit_admin_user_id", "admin_audit", ["admin_user_id"])
    op.create_index("ix_admin_audit_target_user_id", "admin_audit", ["target_user_id"])
    op.create_index("ix_admin_audit_target_share_id", "admin_audit", ["target_share_id"])
    op.create_index("ix_admin_audit_action", "admin_audit", ["action"])
    op.create_index("ix_admin_audit_created_at", "admin_audit", ["created_at"])
    op.create_index(
        "ix_admin_audit_target_user_created",
        "admin_audit",
        ["target_user_id", "created_at"],
    )
    op.create_index(
        "ix_admin_audit_target_share_created",
        "admin_audit",
        ["target_share_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_admin_audit_target_share_created", table_name="admin_audit")
    op.drop_index("ix_admin_audit_target_user_created", table_name="admin_audit")
    op.drop_index("ix_admin_audit_created_at", table_name="admin_audit")
    op.drop_index("ix_admin_audit_action", table_name="admin_audit")
    op.drop_index("ix_admin_audit_target_share_id", table_name="admin_audit")
    op.drop_index("ix_admin_audit_target_user_id", table_name="admin_audit")
    op.drop_index("ix_admin_audit_admin_user_id", table_name="admin_audit")
    op.drop_table("admin_audit")
