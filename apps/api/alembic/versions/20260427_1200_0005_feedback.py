"""feedback table for feature requests and bug reports

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-27 12:00:00.000000

Per `docs/tickets/user-feedback-system.md`. Simple feedback table — user_id
is nullable (anonymous submissions allowed), email is a separate nullable
column for reply-to addresses from anon users.

No FK on user_id (unlike share_reports) — the table is intentionally
lightweight and does not need cascading deletes since feedback survives
even if the user account is later removed.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # Optional index for admin lookups — newest first.
    op.create_index(
        "ix_feedback_created_at",
        "feedback",
        [sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_created_at", table_name="feedback")
    op.drop_table("feedback")
